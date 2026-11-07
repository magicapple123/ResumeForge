# SPDX-License-Identifier: Apache-2.0
"""只读错误诊断工具（T31）：把最近一段时间的异常信号聚合成可操作的诊断清单。

四个数据源按优先级合并（同一类信号在界面上已经各有一套诊断入口，这里只做汇总）：

1. ``ai_task``：后台 AI 任务失败 / 取消——**只取 kind 与 status 枚举**，不读 ``error``
   自由文本（那里面可能有模型原文或用户输入）；
2. ``apply_task_item``：投递失败——只取 ``failure_category`` 等稳定枚举、时间与关联 id，
   不读 ``failure_detail``（含页面标题/URL 等现场自由文本）；
3. ``web_form_fill_record``：网申填充失败/未核对——只用计数列与 item 的 *状态枚举*，
   不读 ``items`` 里的填写值、页面快照或 URL；
4. ``logs/backend.log``：见 ``error_diagnosis_logs``——只抽时间/级别/logger/异常类名/
   HTTP 状态/路由模板/request_id，**绝不返回日志 message 原文、traceback、请求体**。

安全口径（为什么值得单独一个工具）：这些信号本来分散在本机各处，用户口述"刚才那个操作
失败了"时模型既看不到日志也不该看到。这里给模型的是一份**白名单字段 + 固定枚举说明**的
汇总：错误类名/HTTP 状态按常量表映射成中文说明与建议动作；所有字符串再过
``redact_sensitive_text``（兜底脱敏）与 ``[A-Za-z0-9_.:/-]`` 字符白名单。日志缺失、
文件日志关闭或格式不符时返回「日志不可用」而不是抛错——诊断工具自己不能成为新的报错源。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...config import get_settings
from ...models.ai_task import (
    AI_TASK_KIND_WEBFORM_FILL,
    AI_TASK_STATUS_CANCELED,
    AI_TASK_STATUS_FAILED,
    AiTask,
)
from ...models.apply import FAILURE_CATEGORY_LABELS, ApplyTaskItem
from ...models.profile import utcnow
from ...models.web_form_record import WebFormFillRecord
from .. import trash
from ._types import ToolResult
from .error_diagnosis_logs import (
    collect_log_entries,
    safe_field,
)

DEFAULT_SINCE_MINUTES = 60
MAX_SINCE_MINUTES = 7 * 24 * 60
DEFAULT_LIMIT = 10
MAX_LIMIT = 50
MAX_RESULT_CHARS = 6_000
# 每个 DB 源最多扫多少行：诊断看最近一批就够，不把大表全量拉进内存。
MAX_ROWS_PER_SOURCE = 300

SCOPES = ("all", "apply", "export", "assistant", "webform")

# 固定中文说明 + 建议动作（代码常量表）：错误类名/HTTP 状态 → 人话。
ERROR_CLASS_NOTES: dict[str, tuple[str, str]] = {
    "ValidationError": ("参数校验失败", "按接口字段约束修正请求后重试；日志里不保留请求原文"),
    "HTTPException": ("接口返回了错误状态", "按 http_status 与 request_id 对照接口文档排查"),
    "TimeoutError": ("操作超时", "稍后重试；反复超时请检查网络与模型服务"),
    "ConnectionError": ("网络连接失败", "检查网络与目标服务可达性后重试"),
    "LLMError": ("模型调用失败", "检查模型配置、配额与网络后重试"),
    "StoreError": ("本地数据写入失败", "先备份数据，再检查磁盘空间与目录权限后重试"),
    "ValueError": ("输入或状态不合法", "按 request_id 检索日志上下文并核对调用参数"),
    "RuntimeError": ("运行时异常", "按 request_id 检索日志上下文定位；反复出现请反馈"),
    "task_failed": ("后台任务失败", "到任务面板重试该任务；反复失败时带上 request_id 反馈"),
    "task_canceled": ("后台任务被取消", "需要的话到任务面板重新发起"),
    "webform_failed": ("网申填充失败", "到网申填表页核对失败字段后重新填充"),
    "webform_unverified": ("网申填充未核对", "到网申填表页人工确认后再继续"),
}
DEFAULT_ERROR_NOTE = ("未归类的错误", "记录 request_id / 时间后在本机日志里检索上下文")

HTTP_STATUS_NOTES: dict[int, tuple[str, str]] = {
    400: ("请求格式不正确", "按接口文档核对请求体后重试"),
    401: ("未授权", "检查本机凭据或重新登录后再试"),
    403: ("被拒绝访问", "检查访问边界（本机/跨站限制）后重试"),
    404: ("目标不存在或已删除", "先刷新列表确认对象还在，再重试"),
    409: ("状态冲突", "刷新到最新状态后再操作"),
    422: ("参数校验失败", "按接口字段约束修正请求后重试"),
    429: ("请求过于频繁", "稍等后再试；检查是否触发了频率限制"),
    500: ("服务内部错误", "按 request_id 检索本机日志定位；反复出现请反馈"),
    502: ("上游服务返回异常", "稍后重试；检查模型服务或搜索服务状态"),
    503: ("服务暂不可用", "稍后重试；检查上游服务是否在运行"),
    504: ("上游服务超时", "稍后重试；检查网络与上游服务负载"),
}

# ai_task 的 kind → scope：只有明确归到某条业务线的才参与 scoped 查询，其余只在 all 出现。
_AI_TASK_SCOPE = {AI_TASK_KIND_WEBFORM_FILL: "webform"}

# 投递失败分类（复用 models.apply 的唯一中文标签表，不另写一份）。
_APPLY_ACTIONS = {
    "selector_invalid": "页面结构可能变了：到投递台查看失败诊断，必要时手动投递",
    "login_required": "先到投递台重新登录招聘网站，再重试",
    "captcha_required": "需要人工过验证码：到投递台手动完成该岗位",
    "greeting_missing": "补充该岗位招呼语后重试",
    "network_timeout": "检查网络后重试",
    "file_upload_failed": "检查简历文件是否可正常预览后重试",
    "site_unsupported": "该岗位来源不支持自动投递，请手动投递",
    "profile_insufficient": "先补齐简历/网申资料再重试",
    "unconfirmed": "到浏览器核对是否已投递，避免重复投递",
    "unknown": "到投递台查看失败诊断；反复出现请反馈",
}
DEFAULT_APPLY_ACTION = "到投递台查看失败诊断并按提示处理"


def _int_argument(arguments: dict, key: str, default: int, minimum: int, maximum: int) -> int:
    """工具参数是模型生成的 JSON：数字可能给成字符串，非法值退回默认（不抛）。"""
    try:
        value = int(arguments.get(key, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _scope_argument(arguments: dict) -> str:
    scope = str(arguments.get("scope") or "all").strip().lower()
    return scope if scope in SCOPES else "all"


def _log_file_path() -> Path:
    """日志路径与 ``application.attach_file_log_handler`` 同一处推导（DATA_DIR/logs）。"""
    from ...config import DATA_DIR

    return DATA_DIR / "logs" / "backend.log"


def _log_file_enabled() -> bool:
    """文件日志开关；测试与「关闭日志」场景下返回 False → 工具报「日志不可用」。"""
    try:
        return bool(get_settings().log_file_enabled)
    except Exception:  # noqa: BLE001 - 配置读不出来时按不可用处理，不抛
        return False


def _entry(
    *,
    ts: datetime | None,
    level: str,
    logger: str,
    error_class: str,
    source: str,
    count: int,
    http_status: int | None = None,
    route_template: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    """一条白名单记录（聚合前的中间形态，``__parsed_ts`` 在合并后丢弃）。"""
    return {
        "ts": safe_field(ts.strftime("%Y-%m-%dT%H:%M:%S") if ts else "", 40),
        "level": safe_field(level, 16),
        "logger": safe_field(logger, 120),
        "error_class": safe_field(error_class, 80),
        "http_status": http_status,
        "route_template": safe_field(route_template, 120),
        "request_id": safe_field(request_id, 64),
        "source": source,
        "count": max(1, int(count)),
        "__parsed_ts": ts,
    }


def _collect_ai_task_signals(db: Session, cutoff: datetime, scope: str) -> list[dict[str, Any]]:
    """后台 AI 任务失败/取消：只读 kind/status，不读 error 自由文本。"""
    rows = (
        db.query(AiTask)
        .filter(
            or_(AiTask.created_at >= cutoff, AiTask.finished_at >= cutoff),
            AiTask.status.in_((AI_TASK_STATUS_FAILED, AI_TASK_STATUS_CANCELED)),
        )
        .order_by(AiTask.id.desc())
        .limit(MAX_ROWS_PER_SOURCE)
        .all()
    )
    signals: list[dict[str, Any]] = []
    for row in rows:
        kind_scope = _AI_TASK_SCOPE.get(row.kind)
        if scope != "all" and kind_scope != scope:
            continue
        failed = row.status == AI_TASK_STATUS_FAILED
        signals.append(
            _entry(
                ts=row.finished_at or row.created_at,
                level="error" if failed else "warning",
                logger="ai_task" + (f".{safe_field(row.kind, 32)}" if row.kind else ""),
                error_class="task_failed" if failed else "task_canceled",
                source="ai_task",
                count=1,
            )
        )
    return signals


def _collect_apply_signals(db: Session, cutoff: datetime, scope: str) -> list[dict[str, Any]]:
    """投递失败：只读失败分类枚举、时间与关联 id，不读 failure_detail 自由文本。"""
    if scope not in ("all", "apply"):
        return []
    rows = (
        db.query(ApplyTaskItem)
        .filter(
            ApplyTaskItem.created_at >= cutoff,
            trash.live_only(ApplyTaskItem),
            or_(ApplyTaskItem.failure_category != "", ApplyTaskItem.status == "failed"),
        )
        .order_by(ApplyTaskItem.id.desc())
        .limit(MAX_ROWS_PER_SOURCE)
        .all()
    )
    signals: list[dict[str, Any]] = []
    for row in rows:
        category = safe_field(row.failure_category, 40) or "unknown"
        step = safe_field(row.failure_step, 30)
        signals.append(
            _entry(
                ts=row.finished_at or row.created_at,
                level="error",
                logger="apply_task_item" + (f".{step}" if step else ""),
                error_class=category,
                source="apply_record",
                count=1,
            )
        )
    return signals


def _collect_webform_signals(db: Session, cutoff: datetime, scope: str) -> list[dict[str, Any]]:
    """网申填充失败/未核对：只用计数列归类，不读 items 里的填写值与页面快照。"""
    if scope not in ("all", "webform"):
        return []
    rows = (
        db.query(WebFormFillRecord)
        .filter(
            WebFormFillRecord.created_at >= cutoff,
            trash.live_only(WebFormFillRecord),
            or_(WebFormFillRecord.failed > 0, WebFormFillRecord.unverified > 0),
        )
        .order_by(WebFormFillRecord.id.desc())
        .limit(MAX_ROWS_PER_SOURCE)
        .all()
    )
    signals: list[dict[str, Any]] = []
    for row in rows:
        if int(row.failed or 0) > 0:
            signals.append(
                _entry(
                    ts=row.created_at,
                    level="error",
                    logger="webform_fill_record",
                    error_class="webform_failed",
                    source="web_form_record",
                    count=int(row.failed),
                )
            )
        if int(row.unverified or 0) > 0:
            signals.append(
                _entry(
                    ts=row.created_at,
                    level="warning",
                    logger="webform_fill_record",
                    error_class="webform_unverified",
                    source="web_form_record",
                    count=int(row.unverified),
                )
            )
    return signals


def _collect_log_signals(scope: str, since_minutes: int) -> tuple[str, list[dict[str, Any]]]:
    """日志源：不可用时返回状态串 + 空列表（绝不抛错）。"""
    cutoff = datetime.now() - timedelta(minutes=since_minutes)
    return collect_log_entries(
        _log_file_path(),
        enabled=_log_file_enabled(),
        scope=scope,
        cutoff=cutoff,
    )


def _error_guide(entry: dict[str, Any]) -> tuple[str, str]:
    """错误类名 / HTTP 状态 → 固定中文说明与建议动作（只查常量表）。"""
    error_class = str(entry.get("error_class") or "")
    note, action = ERROR_CLASS_NOTES.get(error_class, DEFAULT_ERROR_NOTE)
    if error_class in FAILURE_CATEGORY_LABELS:
        # 投递失败分类的中文标签复用 models.apply 的唯一词表，不另写一份。
        note = FAILURE_CATEGORY_LABELS[error_class]
        action = _APPLY_ACTIONS.get(error_class, DEFAULT_APPLY_ACTION)
    http_status = entry.get("http_status")
    if http_status in HTTP_STATUS_NOTES:
        http_note, http_action = HTTP_STATUS_NOTES[http_status]
        if error_class not in ERROR_CLASS_NOTES:
            note, action = http_note, http_action
        else:
            note = f"{note}（HTTP {http_status}）"
    return note, action


def _merge_signals(signals: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """同一 (source, level, logger, 错误类, HTTP 状态, 路由模板) 合并计数，按时间倒序。"""
    groups: dict[tuple, dict[str, Any]] = {}
    for item in signals:
        parsed_ts = item.pop("__parsed_ts", None)
        key = (
            item["source"],
            item["level"],
            item["logger"],
            item.get("error_class") or "",
            item.get("http_status") or 0,
            item.get("route_template") or "",
        )
        bucket = groups.get(key)
        if bucket is None:
            groups[key] = {**item, "__parsed_ts": parsed_ts}
            continue
        bucket["count"] += int(item.get("count") or 1)
        if parsed_ts is not None and (
            bucket["__parsed_ts"] is None or parsed_ts > bucket["__parsed_ts"]
        ):
            bucket["__parsed_ts"] = parsed_ts
            bucket["ts"] = item["ts"]
            bucket["request_id"] = item.get("request_id") or bucket.get("request_id") or ""
    ordered = sorted(
        groups.values(),
        key=lambda item: item["__parsed_ts"] or datetime.min,
        reverse=True,
    )[:limit]
    entries: list[dict[str, Any]] = []
    for item in ordered:
        item.pop("__parsed_ts", None)
        note, action = _error_guide(item)
        entries.append({**item, "error_note": note, "next_action": action})
    return entries


def _tool_diagnose_recent_errors(db: Session, arguments: dict) -> ToolResult:
    """诊断最近一段时间的异常信号（只读；不读日志原文与任何用户数据）。"""
    since_minutes = _int_argument(
        arguments, "since_minutes", DEFAULT_SINCE_MINUTES, 1, MAX_SINCE_MINUTES
    )
    scope = _scope_argument(arguments)
    limit = _int_argument(arguments, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)
    cutoff = utcnow() - timedelta(minutes=since_minutes)
    signals = (
        _collect_ai_task_signals(db, cutoff, scope)
        + _collect_apply_signals(db, cutoff, scope)
        + _collect_webform_signals(db, cutoff, scope)
    )
    log_status, log_signals = _collect_log_signals(scope, since_minutes)
    signals += log_signals
    source_counts: dict[str, int] = {}
    for item in signals:
        source_counts[item["source"]] = source_counts.get(item["source"], 0) + int(item["count"])
    entries = _merge_signals(signals, limit)
    total_groups = len(
        {
            (
                item["source"],
                item["level"],
                item["logger"],
                item.get("error_class") or "",
                item.get("http_status") or 0,
                item.get("route_template") or "",
            )
            for item in signals
        }
    )
    reading = (
        f"最近 {since_minutes} 分钟（范围 {scope}）共 {total_groups} 组异常信号，"
        f"日志状态：{log_status}"
    )
    payload = {
        "since_minutes": since_minutes,
        "scope": scope,
        "limit": limit,
        "log_status": log_status,
        "sources": source_counts,
        "entries": entries,
        "total_groups": total_groups,
        "truncated": total_groups > len(entries),
        "reading": reading,
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"诊断了最近 {since_minutes} 分钟的异常：{len(entries)} 组信号",
        link="/settings",
    )


__all__ = [
    "DEFAULT_LIMIT",
    "DEFAULT_SINCE_MINUTES",
    "ERROR_CLASS_NOTES",
    "HTTP_STATUS_NOTES",
    "SCOPES",
    "_tool_diagnose_recent_errors",
]

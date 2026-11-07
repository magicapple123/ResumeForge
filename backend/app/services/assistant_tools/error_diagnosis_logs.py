# SPDX-License-Identifier: Apache-2.0
"""错误诊断的日志尾部解析（T31）：只抽白名单字段，绝不返回日志 message 原文。

**为什么单独一个模块**：日志解析有格式判定的独立性（文本行 / JSON 行两种形态、多行
traceback、缺失与格式不符的降级），放进工具编排里会把「取数策略」和「日志格式知识」
搅在一起，各自都难测。这里只做纯函数 + 一个 ``collect_log_entries`` 入口：

- 输入：数据目录下的 ``logs/backend.log``（真实格式见 ``application._LOG_FORMAT``）；
- 输出：``(log_status, records)``。``log_status == "ok"`` 时 records 是**已脱敏、已按字符
  白名单过滤**的结构化记录；日志缺失 / 文件日志关闭 / 格式不符时返回「日志不可用…」
  状态串且 records 为空——**任何情况都不抛异常**；
- 从日志里只允许取出：时间、级别、logger 名、异常类名（traceback 里的类，不带消息）、
  HTTP 状态码（``status=NNN``）、路由模板、request_id。message 原文只用于提取上述枚举，
  绝不出现在返回值里。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from ...runtime.log_redact import redact_sensitive_text

# 日志不可用时的状态串（工具结果里会原样出现，便于模型如实回答）。
LOG_OK = "ok"
LOG_UNAVAILABLE_MISSING = "日志不可用（日志文件不存在）"
LOG_UNAVAILABLE_DISABLED = "日志不可用（文件日志已关闭）"
LOG_UNAVAILABLE_BROKEN = "日志不可用（格式不符，没有可解析的日志行）"

# 只读尾部：日志可能到 5MB×5，全量读没有意义，排障看最近一段就够。
LOG_TAIL_BYTES = 1_024 * 1_024
# 单次最多解析多少行（与尾部字节数一起构成防御上限）。
MAX_LOG_LINES = 5_000

_TEXT_LINE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) "
    r"(?P<level>[A-Z]+) \[(?P<logger>[^\]]+)\] "
    r"\[request_id=(?P<rid>[^\]]*)\] (?P<message>.*)$"
)
# traceback 里的异常类名行：``SomeError: message`` / ``mod.sub.SomeError: message``。只取类名。
_EXC_CLASS_RE = re.compile(
    r"^(?P<cls>[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Failure|Exit|Interrupt))(?::|$)"
)
_HTTP_STATUS_RE = re.compile(r"(?:status|http_status|status_code)\s*[=:]\s*(\d{3})\b")
_PATH_RE = re.compile(r"(?:path|route|url)\s*[=:]\s*([^\s,;]+)")
# 白名单字符（任务书要求）：其余字符一律丢弃。
_SAFE_CHARS_RE = re.compile(r"[^A-Za-z0-9_.:/-]")
# 噪声 logger：高流量、与「哪个操作失败」无关（字体裁剪/迁移/HTTP 客户端）。
_NOISY_LOGGER_PREFIXES = ("fontTools", "alembic", "httpx", "PIL", "asyncio", "urllib3")

# 跨业务线的 logger 前缀：全局 422 参数校验 handler 挂在 ``app.application`` 上，它不属于
# 任何一条业务线，却对每条业务线都有诊断价值——「导不出 PDF」「投不出去」很多时候就死在这里
# 的参数校验上。因此这些前缀下的日志在每个 scope 里都放行，scope 判断只约束业务线自己的 logger。
_CROSS_SCOPE_LOGGER_PREFIXES = ("app.application",)

# scope → logger 前缀（只在日志源里用；DB 源的 scope 过滤在 error_diagnosis 里做）。
SCOPE_LOGGER_PREFIXES: dict[str, tuple[str, ...]] = {
    "apply": ("app.services.apply", "app.api.apply"),
    "export": (
        "app.services.export",
        "app.services.resume.export",
        "app.services.pdf_exporter",
        "app.services.docx_exporter",
        "app.api.export",
    ),
    "assistant": (
        "app.api.assistant",
        "app.services.assistant",
        "app.services.llm",
        "app.services.search",
        "app.services.skill",
    ),
    "webform": ("app.services.webform", "app.api.webform"),
}


def safe_field(value: object, limit: int = 120) -> str:
    """兜底脱敏 + 字符白名单过滤 + 截断：任何写进结果的字符串都必须过这一道。

    ``redact_sensitive_text`` 遮掉 Pydantic ``input_value``、``sk-`` Key、Bearer 凭证、
    照片 data URL 与 password/token 赋值；然后只保留 ``[A-Za-z0-9_.:/-]``（路由模板里的
    动态段统一记成 ``:id``，见 ``route_template``），最后按字段预算截断。
    """
    text = redact_sensitive_text(str(value or ""))
    return _SAFE_CHARS_RE.sub("", text)[:limit]


def route_template(raw: str) -> str:
    """把日志里出现的具体 URL/path 收敛成**模板**：去掉域名与查询串、动态段换成 :id。

    只回模板不回原路径，是为了避免把具体 id（甚至误拼进去的手机号）带进对话上下文。
    例：``/api/resumes/123/versions/456/compare/789`` → ``/api/resumes/:id/versions/:id/compare/:id``。
    """
    text = str(raw or "").strip()
    if "://" in text:
        text = text.split("://", 1)[1]
        text = text.split("/", 1)[1] if "/" in text else ""
    for mark in ("?", "#"):
        if mark in text:
            text = text.split(mark, 1)[0]
    segments: list[str] = []
    for segment in text.split("/"):
        if not segment:
            continue
        if re.fullmatch(r"\d+", segment) or re.fullmatch(r"[0-9a-fA-F-]{16,}", segment):
            segments.append(":id")
        else:
            segments.append(_SAFE_CHARS_RE.sub("", segment)[:40])
    if not segments:
        return ""
    template = "/" + "/".join(segments)
    return template[:120]


def _parse_text_time(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S,%f")
    except (TypeError, ValueError):
        return None


def _parse_json_time(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _iter_text_records(lines: list[str]):
    """把文本日志行切成「记录 + 后续 traceback 行」；非日志行跳过（格式不符时不抛）。"""
    current: dict[str, Any] | None = None
    for line in lines:
        match = _TEXT_LINE_RE.match(line)
        if match is not None:
            if current is not None:
                yield current
            current = {
                "ts": match.group("ts"),
                "level": match.group("level"),
                "logger": match.group("logger"),
                "rid": match.group("rid"),
                "message": match.group("message"),
                "tail": [],
                "__parsed_ts": _parse_text_time(match.group("ts")),
            }
        elif current is not None:
            current["tail"].append(line)
    if current is not None:
        yield current


def _iter_json_records(lines: list[str]):
    """JSON 行日志（``LOG_JSON_FORMAT=true``）的解析；坏行跳过。"""
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        yield {
            "ts": str(payload.get("time") or ""),
            "level": str(payload.get("level") or ""),
            "logger": str(payload.get("logger") or ""),
            "rid": str(payload.get("request_id") or "-"),
            "message": str(payload.get("message") or ""),
            "tail": [str(payload.get("exc") or "")],
            "__parsed_ts": _parse_json_time(payload.get("time")),
        }


def _error_class(record: dict[str, Any]) -> str:
    """从 traceback 行里取**异常类名**（不带冒号后的消息原文）。"""
    for line in record["tail"]:
        for candidate in line.splitlines():
            match = _EXC_CLASS_RE.match(candidate.strip())
            if match is not None:
                # traceback 可能写全限定名（pydantic_core._pydantic_core.ValidationError）；
                # 只保留类名，模块路径不进入结果。
                return match.group("cls").rsplit(".", 1)[-1]
    return ""


def _http_status(message: str) -> int | None:
    match = _HTTP_STATUS_RE.search(message)
    if match is None:
        return None
    value = int(match.group(1))
    return value if 100 <= value <= 599 else None


def _route_template(message: str) -> str:
    match = _PATH_RE.search(message)
    return route_template(match.group(1)) if match is not None else ""


def _record_to_entry(record: dict[str, Any]) -> dict[str, Any]:
    """把一条解析记录收成白名单字段；message 原文在这里被丢弃。"""
    return {
        "ts": safe_field(record["ts"], 40),
        "level": safe_field(record["level"], 16),
        "logger": safe_field(record["logger"], 120),
        "error_class": safe_field(_error_class(record), 80),
        "http_status": _http_status(str(record["message"])),
        "route_template": _route_template(str(record["message"])),
        "request_id": safe_field(record["rid"], 64),
        "source": "logs",
        "count": 1,
        "__parsed_ts": record["__parsed_ts"],
    }


def _read_log_tail(path: Path) -> str | None:
    """读尾部日志；文件不存在/不可读返回 None（由调用方转成「日志不可用」）。"""
    try:
        with path.open("rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            handle.seek(max(0, size - LOG_TAIL_BYTES))
            raw = handle.read()
    except OSError:
        return None
    return raw.decode("utf-8", errors="replace")


def collect_log_entries(
    path: Path,
    *,
    enabled: bool,
    scope: str,
    cutoff: datetime,
) -> tuple[str, list[dict[str, Any]]]:
    """读日志尾部并返回 ``(log_status, entries)``；任何异常形态都降级为「日志不可用」。

    返回的 entries 已过 :func:`_record_to_entry`（白名单字段 + 脱敏 + 字符过滤），
    但可能包含 ``__parsed_ts`` 内部键，由调用方聚合后丢弃。
    """
    if not enabled:
        return LOG_UNAVAILABLE_DISABLED, []
    text = _read_log_tail(path)
    if text is None:
        return LOG_UNAVAILABLE_MISSING, []
    lines = text.splitlines()[-MAX_LOG_LINES:]
    if not lines:
        return LOG_UNAVAILABLE_BROKEN, []
    # 格式判定：首个非空行以 { 开头按 JSON 行日志解析，否则按默认文本格式。
    first = next((line for line in lines if line.strip()), "")
    iterator = (
        _iter_json_records(lines) if first.lstrip().startswith("{") else _iter_text_records(lines)
    )
    prefixes = SCOPE_LOGGER_PREFIXES.get(scope)
    entries: list[dict[str, Any]] = []
    parsed_any = False
    for record in iterator:
        parsed_any = True
        parsed_ts = record.get("__parsed_ts")
        if parsed_ts is None or parsed_ts < cutoff:
            continue
        if record["level"] not in {"WARNING", "ERROR", "CRITICAL"}:
            continue
        logger_name = record["logger"]
        if logger_name.startswith(_NOISY_LOGGER_PREFIXES):
            continue
        # 业务线 scope 只认自己那批 logger；跨业务线的通用日志（全局 422 handler）一律放行。
        if prefixes is not None and not logger_name.startswith(
            prefixes + _CROSS_SCOPE_LOGGER_PREFIXES
        ):
            continue
        entries.append(_record_to_entry(record))
    if not parsed_any:
        return LOG_UNAVAILABLE_BROKEN, []
    return LOG_OK, entries


__all__ = [
    "LOG_OK",
    "LOG_UNAVAILABLE_BROKEN",
    "LOG_UNAVAILABLE_DISABLED",
    "LOG_UNAVAILABLE_MISSING",
    "SCOPE_LOGGER_PREFIXES",
    "collect_log_entries",
    "route_template",
    "safe_field",
]

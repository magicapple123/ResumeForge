# SPDX-License-Identifier: Apache-2.0
"""长任务工具（18A）：把跨轮批量活交给现有 agent_task 体系。

为什么需要这三条工具：单轮工具循环有轮次上限（#5 抬到 30 轮仍只是止痛），100 条简历、
几十个岗位的批量活放在对话里必然要用户反复说"继续"。agent_task 本来就有"多步计划 +
每步状态 + 暂停/恢复 + 重启恢复"的完整状态机（T19/T20），缺的只是让助手**建计划**的入口。

边界（刻意收窄，不在这里实现执行器）：

- 本模块只负责"把用户的一句话翻译成一张可执行的任务卡"：建计划、写清楚 N 条 / M 步、
  批准前给预览。真正的步骤推进仍走既有 /api/agent-tasks 的 REST 状态机与恢复逻辑，
  **不新增调度器、不在对话回合里偷偷跑批**。
- task_create 的参数一律先**在库里核对**再定 N：简历条目数从 v2 文档现读、岗位 id 逐条
  验存在。模型说什么不算数——预览卡上的"N 条"必须是当前数据集的真实数字。
- 与"直接做"的分工写进系统提示（assistant_task_rules.TASK_RULES_BLOCK）：一轮内能完成
  就直接做；只有跨轮批量且预计工具调用 >20 次才建任务；只改一个字段**不得**建任务。
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeRecord
from .. import agent_task_service, trash
from ..resume import document_io
from ._shared import int_argument
from ._types import ToolResult
from .authorization import FieldChange, WritePreview

#: 助手建的任务的来源标签（与 models/agent_task 的开放来源标签同一约定：1–32 字）。
ASSISTANT_TASK_SOURCE = "assistant"
#: 任务卡在首页「任务」区；工具结果里的「查看」指向首页。
TASK_LINK = "/"
#: 一次任务能规划的条数上限（与 job_import 的 200 条/次硬上限一致）。
MAX_TASK_ITEMS = 200
#: 批量匹配 / 批量打招呼一次最多几个岗位（与既有批量匹配的入口上限同一量级）。
MAX_JOB_BATCH = 50
#: 任务步骤上限（服务层 MAX_AGENT_TASK_STEPS = 50，这里只声明自己生成的上限）。
MAX_PLAN_STEPS = 6


@dataclass(frozen=True)
class TaskPlan:
    """一次任务规划：预览卡与建任务共用同一份（两处各算一遍必然漂移）。"""

    kind: str
    label: str
    item_count: int
    items_label: str
    steps: tuple[tuple[str, str], ...]
    title: str
    goal: str


def _text_argument(arguments: dict[str, Any], key: str, error: str, *, max_chars: int) -> str:
    value = str(arguments.get(key) or "").strip()
    if not value:
        raise ValueError(error)
    if len(value) > max_chars:
        raise ValueError(f"{error}（不能超过 {max_chars} 字）")
    return value


def _int_list_argument(
    arguments: dict[str, Any], key: str, error: str, *, maximum: int
) -> list[int]:
    """把 id 列表收成"去重、保序"的正整数；空列表/非法项都显式报错。"""
    raw = arguments.get(key)
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ValueError(error)
    cleaned: list[int] = []
    for item in raw:
        try:
            value = int(item)
        except (TypeError, ValueError):
            raise ValueError(error) from None
        if value < 1:
            raise ValueError(error)
        if value not in cleaned:
            cleaned.append(value)
    if len(cleaned) > maximum:
        raise ValueError(f"{error}（一次最多 {maximum} 个）")
    return cleaned


def _live_job_ids(db: Session, job_ids: Iterable[int]) -> list[int]:
    ids = sorted(set(job_ids))
    rows = db.query(Job.id).filter(Job.id.in_(ids), trash.live_only(Job)).all()
    return sorted(int(row[0]) for row in rows)


def _require_live_jobs(db: Session, job_ids: list[int]) -> list[int]:
    """核对岗位 id：不存在的如实点名，不把 N 算成模型给的数量。"""
    live = set(_live_job_ids(db, job_ids))
    missing = [job_id for job_id in job_ids if job_id not in live]
    if missing:
        names = "、".join(str(job_id) for job_id in missing[:10])
        raise ValueError(f"这些岗位不存在或已被删除：{names}（可以先用 list_jobs 查）")
    return job_ids


def _entry_count(db: Session, record: ResumeRecord, section: str) -> tuple[int, str]:
    """数这份简历里可改写的条目：section 为空 = 全部 entries 板块之和。

    走 v2 文档读侧（document_io.document_for_record，只读、不写库），与助手其它
    简历工具同一份数据源；板块名对不上时如实报错，不把 0 条说成"已完成"。
    """
    document, _report = document_io.document_for_record(db, record)
    total = 0
    matched = ""
    for raw in document.get("sections") or []:
        if not isinstance(raw, dict) or raw.get("kind") != "entries":
            continue
        key = str(raw.get("key") or "")
        if section and key != section:
            continue
        entries = [item for item in (raw.get("entries") or []) if isinstance(item, dict)]
        if section:
            matched = str(raw.get("title") or key)
            total = len(entries)
            break
        total += len(entries)
    if section and not matched:
        raise ValueError(
            f"这份简历里没有叫「{section}」的条目板块（可以先用 get_resume 查板块 key）"
        )
    return total, matched or section


def _plan_resume_batch_edit(db: Session, params: dict[str, Any]) -> TaskPlan:
    resume_id = int_argument(
        params, "resume_id", "resume_batch_edit 需要提供 resume_id（可以先用 list_resumes 查）"
    )
    record = trash.get_live(db, ResumeRecord, resume_id)
    if record is None:
        raise ValueError(f"简历 {resume_id} 不存在或已被删除")
    instruction = _text_argument(
        params, "instruction", "resume_batch_edit 需要提供改写要求", max_chars=500
    )
    section = str(params.get("section") or "").strip()
    count, section_label = _entry_count(db, record, section)
    if count == 0:
        raise ValueError("这份简历没有可批量改写的条目，不需要建任务")
    scope = f"「{section_label}」" if section else "全部条目"
    title = f"批量改写简历《{record.title or resume_id}》的 {count} 条内容"
    return TaskPlan(
        kind="resume_batch_edit",
        label="批量改写简历",
        item_count=count,
        items_label=f"{count} 条{scope}",
        steps=(
            ("读取简历并确认目标条目", "read"),
            (f"逐条改写 {count} 条内容（要求：{instruction[:80]}）", "edit"),
            ("保存并自动留下撤销点", "save"),
        ),
        title=title,
        goal=instruction,
    )


def _plan_job_import(_db: Session, params: dict[str, Any]) -> TaskPlan:
    url = _text_argument(params, "url", "job_import 需要提供要抓取的链接", max_chars=2_000)
    if not url.startswith(("http://", "https://")):
        raise ValueError("job_import 的 url 必须是 http(s) 开头的网页链接")
    limit = int_argument(params, "limit", "job_import 需要提供最多抓取几条（1–200）")
    if not 1 <= limit <= MAX_TASK_ITEMS:
        raise ValueError(f"job_import 的 limit 必须在 1–{MAX_TASK_ITEMS} 之间")
    return TaskPlan(
        kind="job_import",
        label="从链接导入岗位",
        item_count=limit,
        items_label=f"最多 {limit} 条岗位",
        steps=(
            (f"打开链接并解析岗位列表（最多 {limit} 条）", "fetch"),
            ("逐条补全详情（同域限速，失败如实记录）", "detail"),
            ("去重后写入岗位广场（不自动入队、不投递）", "import"),
        ),
        title=f"从链接导入岗位（最多 {limit} 条）",
        goal=url,
    )


def _plan_match_batch(db: Session, params: dict[str, Any]) -> TaskPlan:
    job_ids = _int_list_argument(
        params, "job_ids", "match_batch 需要提供 job_ids（至少 1 个岗位）", maximum=MAX_JOB_BATCH
    )
    _require_live_jobs(db, job_ids)
    count = len(job_ids)
    return TaskPlan(
        kind="match_batch",
        label="批量匹配",
        item_count=count,
        items_label=f"{count} 个岗位",
        steps=(
            (f"读取本人资料与 {count} 个目标岗位", "read"),
            (f"逐个计算匹配结论与关键词覆盖（{count} 个）", "match"),
            ("汇总结果并按参考分排序", "report"),
        ),
        title=f"批量匹配 {count} 个岗位",
        goal="逐个给出五类匹配结论与参考分，不做投递",
    )


def _plan_greeting_batch(db: Session, params: dict[str, Any]) -> TaskPlan:
    job_ids = _int_list_argument(
        params,
        "job_ids",
        "greeting_batch 需要提供 job_ids（至少 1 个岗位）",
        maximum=MAX_JOB_BATCH,
    )
    _require_live_jobs(db, job_ids)
    template = str(params.get("template") or "").strip()
    if len(template) > 500:
        raise ValueError("greeting_batch 的 template 不能超过 500 字")
    count = len(job_ids)
    return TaskPlan(
        kind="greeting_batch",
        label="批量生成打招呼语",
        item_count=count,
        items_label=f"{count} 个岗位",
        steps=(
            (f"读取岗位信息与话术模板（{count} 个）", "read"),
            (f"逐个生成打招呼语（{count} 条，不自动发送）", "generate"),
            ("结果放进投递台，由用户自己确认发送", "handoff"),
        ),
        title=f"为 {count} 个岗位生成打招呼语",
        goal=template or "按岗位分别生成打招呼语",
    )


_PLANNERS = {
    "resume_batch_edit": _plan_resume_batch_edit,
    "job_import": _plan_job_import,
    "match_batch": _plan_match_batch,
    "greeting_batch": _plan_greeting_batch,
}
TASK_KINDS = tuple(_PLANNERS)


def build_task_plan(db: Session, kind: str | None, params: dict[str, Any] | None) -> TaskPlan:
    """把 (kind, params) 变成一个真实数字的规划；非法参数一律 ValueError（中文可读）。

    ``kind`` 允许 ``None``：工具参数由模型给，缺 key 是常态，这里统一按「未知类型」
    报错（错误文案里会带上原值），而不是让 ``TypeError`` 冒到执行层。
    """
    planner = _PLANNERS.get(str(kind or "").strip())
    if planner is None:
        allowed = " / ".join(TASK_KINDS)
        raise ValueError(f"未知的任务类型：{kind}；可用类型：{allowed}")
    payload = params if isinstance(params, dict) else {}
    return planner(db, payload)


def _execution_params(kind: str, raw: Any) -> dict[str, Any]:
    """把 planner 已校验的参数裁成执行器要的最小输入（写进 agent_task.params）。

    只落白名单键：正文/隐私/长文本不进任务行；种类本身也写进 params.kind，
    执行器据此查 HANDLERS（AgentTask 没有单独的 kind 列，工单只加 params 一列）。
    """
    payload = raw if isinstance(raw, dict) else {}
    params: dict[str, Any] = {"kind": kind}
    if kind == "resume_batch_edit":
        params["resume_id"] = int(payload.get("resume_id") or 0)
        params["section"] = str(payload.get("section") or "").strip()[:64]
        params["instruction"] = str(payload.get("instruction") or "").strip()[:500]
    elif kind == "job_import":
        params["url"] = str(payload.get("url") or "").strip()[:2000]
        params["limit"] = int(payload.get("limit") or 0)
    elif kind in ("match_batch", "greeting_batch"):
        raw_ids = payload.get("job_ids") or []
        params["job_ids"] = [int(item) for item in raw_ids][:MAX_JOB_BATCH]
        if kind == "greeting_batch":
            params["template"] = str(payload.get("template") or "").strip()[:500]
    return params


def _summarize_task(task: Any) -> dict[str, Any]:
    """任务 → 给模型/前端的紧凑快照（只给进度与当前步，不塞全部步骤正文）。"""
    steps = list(task.steps)
    cursor = min(int(task.resume_cursor or 0), len(steps))
    current = steps[cursor].title if cursor < len(steps) else ""
    return {
        "task_id": int(task.id),
        "title": task.title,
        "status": task.status,
        "progress": {"done": cursor, "total": len(steps)},
        "current_step": current,
    }


def _tool_task_create(db: Session, arguments: dict[str, Any]) -> ToolResult:
    """建一张 Agent 任务卡（写；未确认写入时由执行层转成提案卡）。"""
    plan = build_task_plan(db, arguments.get("kind"), arguments.get("params"))
    task = agent_task_service.create_task(
        db,
        title=plan.title,
        steps=[{"title": title, "kind": step_kind} for title, step_kind in plan.steps],
        goal=plan.goal,
        source=ASSISTANT_TASK_SOURCE,
        params=_execution_params(plan.kind, arguments.get("params")),
    )
    summary = f"创建任务「{plan.title}」（{plan.item_count} 条 / {len(plan.steps)} 步）"
    return ToolResult(
        text=json.dumps(
            {
                "ok": True,
                "summary": summary,
                "task_id": int(task.id),
                "title": task.title,
                "status": task.status,
                "item_count": plan.item_count,
                "step_count": len(plan.steps),
                "next": (
                    "任务卡已创建，用户可在首页「任务」区开始 / 暂停 / 取消；"
                    "不要在同一轮里反复推进它。"
                ),
            },
            ensure_ascii=False,
        ),
        summary=summary,
        link=TASK_LINK,
        changed=True,
    )


def _tool_task_status(db: Session, arguments: dict[str, Any]) -> ToolResult:
    task_id = int_argument(
        arguments, "task_id", "需要提供任务 id（可以先用 task_create 或任务卡查看）"
    )
    try:
        task = agent_task_service.get_task(db, task_id)
    except agent_task_service.AgentTaskNotFound as exc:
        raise ValueError(f"任务 {task_id} 不存在或不属于当前数据集") from exc
    snapshot = _summarize_task(task)
    done, total = snapshot["progress"]["done"], snapshot["progress"]["total"]
    return ToolResult(
        text=json.dumps({"ok": True, **snapshot}, ensure_ascii=False),
        summary=f"任务 {task_id}：{task.status}（{done}/{total} 步）",
        link=TASK_LINK,
        changed=False,
    )


def _tool_task_cancel(db: Session, arguments: dict[str, Any]) -> ToolResult:
    task_id = int_argument(arguments, "task_id", "需要提供任务 id（可以先用 task_status 查）")
    try:
        task = agent_task_service.cancel(db, task_id)
    except agent_task_service.AgentTaskNotFound as exc:
        raise ValueError(f"任务 {task_id} 不存在或不属于当前数据集") from exc
    snapshot = _summarize_task(task)
    done, total = snapshot["progress"]["done"], snapshot["progress"]["total"]
    return ToolResult(
        text=json.dumps(
            {
                "ok": True,
                **snapshot,
                "note": f"任务已取消：已完成的 {done} 步保留，未完成的 {total - done} 步不再执行。",
            },
            ensure_ascii=False,
        ),
        summary=f"取消任务「{task.title}」（保留已完成的 {done}/{total} 步）",
        link=TASK_LINK,
        changed=True,
    )


# ===== 写入预览（RF-01：未确认写入时只跑预览，不执行 handler）=====


def _preview_task_create(db: Session, arguments: dict[str, Any]) -> WritePreview:
    """预览必须写明"将处理 N 条、预计 M 步"——这是提案卡上用户唯一能核对的内容。"""
    plan = build_task_plan(db, arguments.get("kind"), arguments.get("params"))
    changes = [
        FieldChange(field="任务标题", before=None, after=plan.title),
        FieldChange(
            field="将处理", before=None, after=f"{plan.item_count} 条（{plan.items_label}）"
        ),
        FieldChange(field="预计步骤", before=None, after=f"{len(plan.steps)} 步"),
    ]
    for index, (title, _kind) in enumerate(plan.steps, start=1):
        changes.append(FieldChange(field=f"步骤 {index}", before=None, after=title))
    return WritePreview(
        target=f"新建 Agent 任务「{plan.title}」",
        scope=(
            f"确认后创建任务卡：将处理 {plan.item_count} 条（{plan.items_label}）、"
            f"预计 {len(plan.steps)} 步；创建后可在任务卡开始 / 暂停 / 取消，"
            "执行进度按步骤落库、应用重启后仍能查到。"
        ),
        changes=changes,
    )


def _preview_task_cancel(db: Session, arguments: dict[str, Any]) -> WritePreview:
    task_id = int_argument(arguments, "task_id", "需要提供任务 id（可以先用 task_status 查）")
    try:
        task = agent_task_service.get_task(db, task_id)
    except agent_task_service.AgentTaskNotFound:
        return WritePreview(
            target=f"取消任务 #{task_id}",
            scope="目标可能不存在：当前数据集里查不到这个任务（可能已被删除）。",
            changes=[FieldChange(field="状态", before="未知", after="已取消")],
        )
    snapshot = _summarize_task(task)
    done, total = snapshot["progress"]["done"], snapshot["progress"]["total"]
    return WritePreview(
        target=f"取消 Agent 任务「{task.title}」（#{task_id}）",
        scope=(
            f"取消后：已完成的 {done}/{total} 步保留，未完成的 {total - done} 步不再执行；"
            "任务进入终态，不能恢复为进行中。"
        ),
        changes=[FieldChange(field="状态", before=task.status, after="已取消")],
    )


__all__ = [
    "ASSISTANT_TASK_SOURCE",
    "MAX_JOB_BATCH",
    "MAX_PLAN_STEPS",
    "MAX_TASK_ITEMS",
    "TASK_KINDS",
    "TASK_LINK",
    "TaskPlan",
    "_preview_task_cancel",
    "_preview_task_create",
    "_tool_task_cancel",
    "_tool_task_create",
    "_tool_task_status",
    "build_task_plan",
]

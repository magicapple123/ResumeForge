# SPDX-License-Identifier: Apache-2.0
"""投递队列（apply queue）域的 action 契约（#15F 对话式投递军师）。

三个工具，**全部是工具专属动作（``http=None``）**：队列的读与改已有既有路由
（``GET /api/apply/queue`` / ``PATCH /api/apply/queue/reorder``，由 ``api/apply_queue.py``
直接注册），而"助手视图"（按状态/关键词筛选、只回一段摘要）与"提案确认后才执行"的
投递入口都没有等价的 HTTP 语义；硬给它们编一条路由只会让同一份能力长出两套契约。

- ``queue_list``（READ_ONLY）：按状态/关键词筛选投递队列，只读、不写库。
- ``queue_update_priority``（REVERSIBLE_WRITE）：按给定 id 顺序重排队列；可撤销
  （把顺序再调回去），写前有结构化预览。
- ``apply_start``（EXTERNAL_SIDE_EFFECT）：**真的**向招聘平台提交投递。

**为什么 apply_start 破例定级 EXTERNAL_SIDE_EFFECT（全项目唯一例外）**：
它触发的是**系统之外**的真实动作——后端驱动受控浏览器在招聘平台上点击"发送"，本地没有
任何撤销手段（平台侧不提供撤回接口）。因此它必须同时满足三条：

1. **永远走提案卡**：名字登记在 ``assistant_tools.policy.ALWAYS_PROPOSAL_TOOLS``，
   即使 write_full（``writable=True``）也不直接执行；``run`` 只在用户确认后的批准
   路径上被调用一次，且 ``preview`` 必须写明"不可撤销"。
2. **不可撤销、不自动重试**：``run`` 只调用一次 ``create_apply_task``，不轮询、不重放、
   不捕获后重试；失败如实回给用户。
3. **不提供"整队列海投"**：必须逐条给定队列条目 id（1..50 条），且只接受
   ``pending``（待投递）状态；已投递 / 已移出的条目一律拒绝。

行为委托（不复制业务逻辑）：``queue_list`` → ``apply._queue.list_queue``；
``queue_update_priority`` → ``apply._queue.reorder_queue``；``apply_start`` →
``apply._tasks.create_apply_task``（它本来就会把批次交给单例 runner 开始投递，
所以只能在这里、只能在提案确认之后调用）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.apply import ApplyQueueItemOut, ApplyTaskCreate
from ..legacy import preview_runner
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ....models.apply import ApplyQueueItem
    from ...apply._base import ApplyServiceError

# 队列列表的默认条数（与既有 list_apply_queue 的工具默认值同口径）。
_DEFAULT_QUEUE_LIMIT = 20
# 一次最多开始投递多少条：外部副作用按"批"放量，超过这个量必须分几次确认。
MAX_APPLY_START = 50
# 只有"待投递"的条目可以开始投递；done（已投递）与 skipped（已移出）都不行。
_APPLICABLE_STATUSES: tuple[str, ...] = ("pending",)
# ApplyServiceError.status_code → 契约层错误码（投递域把 HTTP 状态码写在自己的异常里）。
_APPLY_STATUS_CODES: dict[int, str] = {
    400: "invalid_request",
    404: "not_found",
    409: "conflict",
    503: "unavailable",
}


class QueueListInput(BaseModel):
    """queue_list 入参：只看队列，不写任何东西。"""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(
        default=_DEFAULT_QUEUE_LIMIT,
        ge=1,
        le=500,
        description="可选，最多返回多少条，默认 20",
    )
    # 取值来自 models.apply 的真实队列状态（pending 待投递 / skipped 已移出 / done 已投递）。
    # 空串 = 全部。用 Literal 是为了让模型在 schema 里直接看到合法取值，而不是靠猜。
    status: Literal["", "pending", "skipped", "done"] = Field(
        default="", description="可选：pending 待投递 / skipped 已移出 / done 已投递；空=全部"
    )
    keyword: str = Field(default="", description="可选，按岗位名称或公司筛选（不区分大小写）")


class QueueUpdatePriorityInput(BaseModel):
    """queue_update_priority 入参：完整的 id 顺序（从最优先到最后）。"""

    model_config = ConfigDict(extra="forbid")

    order: list[int] = Field(
        description="队列条目 id，按新优先级从前往后排列（只影响顺序，不投递）",
    )


class ApplyStartInput(BaseModel):
    """apply_start 入参：必须逐条点名队列条目 id（必填），最多 50 条。"""

    model_config = ConfigDict(extra="forbid")

    queue_ids: list[int] = Field(
        description="要开始投递的队列条目 id（必填，1-50 条，必须是待投递状态）",
    )


def _queue_brief(row: ApplyQueueItemOut) -> dict[str, Any]:
    """队列条目在工具文本里的摘要形状（id 一定要给：下一步操作全靠它）。"""
    return {
        "队列条目id": row.id,
        "岗位": row.job_title,
        "公司": row.company,
        "状态": row.status,
        "简历": row.resume_title,
        "可自动投递": row.apply_supported,
        "准入": row.admission,
        "需逐条确认": row.requires_confirm,
        "参考分": row.match_score,
    }


def _order_entry(row: ApplyQueueItemOut) -> dict[str, Any]:
    """重排结果的一条（列表越靠前 = 越优先）。"""
    return {
        "队列条目id": row.id,
        "岗位": row.job_title,
        "公司": row.company,
        "状态": row.status,
        "排序值": row.sort_order,
    }


def _as_action_error(exc: ApplyServiceError) -> ActionError:
    """把投递域异常映射成契约层错误（同一份 detail 文案，换成稳定 error token）。"""
    code = _APPLY_STATUS_CODES.get(int(getattr(exc, "status_code", 0) or 0), "internal")
    detail = getattr(exc, "detail", None)
    if isinstance(detail, str):
        message = detail
    elif isinstance(detail, dict):
        message = str(detail.get("message") or "")
    else:
        message = ""
    return ActionError(code, message or str(exc))  # type: ignore[arg-type]


def _run_queue_list(db: Session, payload: QueueListInput) -> ActionOutcome:
    from ...apply._queue import MAX_QUEUE_LIST, list_queue

    rows = list_queue(db, limit=MAX_QUEUE_LIST)
    keyword = payload.keyword.strip().casefold()
    matched = [
        row
        for row in rows
        if (not payload.status or row.status == payload.status)
        and (
            not keyword
            or keyword in (row.job_title or "").casefold()
            or keyword in (row.company or "").casefold()
        )
    ]
    limited = matched[: payload.limit]
    return ActionOutcome(
        summary=f"查看了 {len(limited)} 条队列",
        text=json.dumps(
            {
                "返回": len(limited),
                "匹配总数": len(matched),
                "投递队列": [_queue_brief(row) for row in limited],
            },
            ensure_ascii=False,
        ),
        link="/apply",
        data=limited,
    )


def _run_queue_update_priority(db: Session, payload: QueueUpdatePriorityInput) -> ActionOutcome:
    from ....models.apply import ApplyQueueItem
    from ...apply._queue import reorder_queue

    order = [int(value) for value in payload.order]
    if not order:
        raise ActionError("invalid_input", "顺序不能为空：请给出队列条目 id 的新顺序")
    duplicates = sorted({item_id for item_id in order if order.count(item_id) > 1})
    if duplicates:
        raise ActionError("invalid_input", f"顺序里有重复的队列条目 id：{duplicates}")
    # 既有 reorder_queue 对不存在的 id 是静默跳过（它服务界面拖拽，跳过的行前端看得见）。
    # 工具侧不能静默：模型会据此认为"已经排好了"。先查一遍，缺谁就点名谁。
    existing = {
        row[0] for row in db.query(ApplyQueueItem.id).filter(ApplyQueueItem.id.in_(order)).all()
    }
    missing = [item_id for item_id in order if item_id not in existing]
    if missing:
        raise ActionError("invalid_input", f"投递队列里没有这些条目：{missing}")
    rows = reorder_queue(db, order)
    head = rows[:_DEFAULT_QUEUE_LIMIT]
    return ActionOutcome(
        changed=True,
        summary=f"调整了 {len(order)} 条队列的优先级",
        text=json.dumps(
            {"新的顺序": [_order_entry(row) for row in head], "返回": len(head)},
            ensure_ascii=False,
        ),
        link="/apply",
        data=rows,
    )


def _load_queue_items(db: Session, ids: list[int]) -> list[ApplyQueueItem]:
    """按给定顺序取队列条目，并逐条做"能不能投"的检查。

    缺 id → ``not_found``（这些 id 已经不存在了，应当重新读一次队列）；
    状态不是待投递 → ``conflict``（状态冲突，不是参数写错）；岗位已删除 → ``not_found``。
    """
    from ....models.apply import ApplyQueueItem

    rows = db.query(ApplyQueueItem).filter(ApplyQueueItem.id.in_(ids)).all()
    by_id = {row.id: row for row in rows}
    missing = [item_id for item_id in ids if item_id not in by_id]
    if missing:
        raise ActionError("not_found", f"投递队列里没有这些条目：{missing}")
    items: list[ApplyQueueItem] = []
    for item_id in ids:
        item = by_id[item_id]
        if item.status not in _APPLICABLE_STATUSES:
            raise ActionError(
                "conflict",
                f"「{item.job_title or '该岗位'}」当前状态是 {item.status}，"
                "只有待投递（pending）的条目可以开始投递",
            )
        if item.job_id is None:
            raise ActionError(
                "not_found", f"「{item.job_title or '该岗位'}」对应的岗位已被删除，无法投递"
            )
        items.append(item)
    return items


def _run_apply_start(db: Session, payload: ApplyStartInput) -> ActionOutcome:
    """真的开始投递：只接受待投递条目，只调用一次 create_apply_task（不可撤销）。"""
    from ...apply._base import ApplyServiceError
    from ...apply._tasks import create_apply_task

    ids = list(dict.fromkeys(int(value) for value in payload.queue_ids))
    if not ids:
        raise ActionError("invalid_input", "请先指定要投递的队列条目（queue_ids 不能为空）")
    if len(ids) > MAX_APPLY_START:
        raise ActionError(
            "invalid_input",
            f"一次最多开始投递 {MAX_APPLY_START} 条（当前 {len(ids)} 条）："
            "外部投递不可撤销，请分批让用户确认。",
        )
    # job_id 已由 _load_queue_items 逐条校验非空（None 会在那里提前抛 not_found），
    # 这里的过滤只是为了把类型从 int|None 收敛成 int，不会真的跳过任何一条。
    job_ids = [int(item.job_id) for item in _load_queue_items(db, ids) if item.job_id is not None]
    try:
        # 这一句之后投递就真的开始了（create_apply_task 会把批次交给单例 runner）。
        # 只调一次：失败不重试、不轮询——外部副作用不允许自动重放。
        task = create_apply_task(db, ApplyTaskCreate(job_ids=job_ids, use_queue=False))
    except ApplyServiceError as exc:
        raise _as_action_error(exc) from exc
    return ActionOutcome(
        changed=True,
        summary=f"已开始投递 {len(job_ids)} 条（不可撤销）",
        text=json.dumps(
            {
                "批次id": task.id,
                "开始投递": len(job_ids),
                "岗位id": job_ids,
                "说明": "投递已交给投递台执行，**不可撤销**；失败不会自动重试。",
            },
            ensure_ascii=False,
        ),
        link="/apply",
        data={"task_id": task.id, "job_ids": job_ids},
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def apply_queue_actions() -> dict[str, ActionSpec]:
    """构建（并注册）投递队列域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # permission_enum 可能触发工具声明模块重入本构建器
        return _ACTIONS
    queue_list = define_action(
        ActionSpec(
            name="queue_list",
            description=(
                "查看投递队列（投递台里排队等着投的岗位）：队列条目 id、岗位、公司、状态、"
                "用哪份简历、能不能自动投递、准入结论与参考分。可按状态或关键词筛选。"
                "用户问「队列里还有什么」「有哪些待投的」时用它。**只读，不投递**。"
            ),
            input_model=QueueListInput,
            permission=Permission.READ_ONLY,
            run=_run_queue_list,
            service_entry="apply._queue.list_queue",
        )
    )
    queue_update_priority = define_action(
        ActionSpec(
            name="queue_update_priority",
            description=(
                "按给定顺序重排投递队列（order 是队列条目 id，从最优先到最后）。"
                "只改顺序，**不投递**；写前会生成确认预览，用户确认后才生效。"
                "用户说「把这几条排前面」时用它，id 先用 queue_list 查。"
            ),
            input_model=QueueUpdatePriorityInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_queue_update_priority,
            preview=preview_runner(
                "app.services.assistant_tools.previews_apply", "preview_queue_update_priority"
            ),
            service_entry="apply._queue.reorder_queue",
        )
    )
    apply_start = define_action(
        ActionSpec(
            name="apply_start",
            description=(
                "按队列条目 id 开始自动投递。**会真实提交投递，不可撤销**"
                "（招聘平台侧没有撤回接口）；失败不自动重试。"
                "**仅在用户明确确认后调用**：必须先由提案卡让用户看清「哪几条、用哪份简历」，"
                "用户确认后才会执行。**不要替用户批量海投**——一次最多 50 条，"
                "且只接受待投递（pending）的队列条目。"
            ),
            input_model=ApplyStartInput,
            permission=Permission.EXTERNAL_SIDE_EFFECT,
            run=_run_apply_start,
            preview=preview_runner(
                "app.services.assistant_tools.previews_apply", "preview_apply_start"
            ),
            service_entry="apply._tasks.create_apply_task",
        )
    )
    _ACTIONS = {spec.name: spec for spec in (queue_list, queue_update_priority, apply_start)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return apply_queue_actions()


__all__ = [
    "ApplyStartInput",
    "MAX_APPLY_START",
    "QueueListInput",
    "QueueUpdatePriorityInput",
    "actions",
    "apply_queue_actions",
]

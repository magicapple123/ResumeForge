# SPDX-License-Identifier: Apache-2.0
"""reminders 域的 action 契约（T28 Batch B：report 类域）。

迁移对（工具 ↔ 路由，真实成对存在）：

- list_reminders  ↔ GET   /api/reminders（只读；limit 默认 200，工具默认 20 用 tool_defaults）
- update_reminder ↔ PATCH /api/reminders/{reminder_id}（可逆写，带 preview）

create_reminder 已在 T27 试点迁移（pilots.py），本模块不重复。

行为差异（已记录）：update_reminder 旧工具只允许改 status，旧路由 PATCH 接受 ReminderUpdate
全部字段；契约层以路由的完整字段集为 input_model（single source），工具 schema 因此多了可选
字段（能力扩展）。空 PATCH 在路由侧一直是 200 no-op，这里保持 no-op；tool_defaults 不适用于
本动作（工具没有历史默认值）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.reminder import ReminderListItemOut, ReminderOut, ReminderUpdate
from ..registry import define_action
from ..spec import ActionError, ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ...assistant_tools.authorization import WritePreview

_DEFAULT_TOOL_LIST_LIMIT = 20
_STATUS_LABELS = {"pending": "待办", "done": "已完成", "dismissed": "已忽略"}


class ListRemindersInput(BaseModel):
    """list_reminders 两侧共用入参（路由 GET 查询参数与工具 JSON 参数）。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["interview", "assessment_deadline", "hr_reply", "other", ""] = Field(
        default="", description="可选，提醒类型"
    )
    status: Literal["pending", "done", "dismissed", ""] = Field(
        default="", description="可选，提醒状态（pending 待办）"
    )
    limit: int = Field(default=200, ge=1, le=500, description="可选，最多返回多少条，默认 20")


class UpdateReminderInput(ReminderUpdate):
    """update_reminder 两侧共用入参：reminder_id 在路由侧来自路径、工具侧来自 JSON。"""

    model_config = ConfigDict(extra="forbid")

    reminder_id: int = Field(ge=1, description="提醒 id")


def _run_list_reminders(db: Session, payload: ListRemindersInput) -> ActionOutcome:
    from ...assistant_tools.report_tools import _tool_list_reminders
    from ...reminder_service import reminder_list_items_out

    # 路由返回体走列表专属回显（补 urgency / days_until）；工具侧只吃 text/summary，
    # ``data`` 对它不生效（见 tool_adapter.handler），所以两侧仍是同一份筛选与文案。
    rows = reminder_list_items_out(
        db, kind=payload.kind, status=payload.status, limit=payload.limit
    )
    legacy = _tool_list_reminders(
        db,
        {"kind": payload.kind, "status": payload.status, "limit": payload.limit},
    )
    return ActionOutcome(
        summary=legacy.summary,
        text=legacy.text,
        link=legacy.link,
        data=rows,
    )


def _preview_update_reminder(db: Session, payload: UpdateReminderInput) -> WritePreview:
    from ...assistant_tools.previews import preview_update_reminder

    arguments = payload.model_dump(exclude_unset=True, mode="json")
    return preview_update_reminder(db, arguments)


def _run_update_reminder(db: Session, payload: UpdateReminderInput) -> ActionOutcome:
    from ...reminder_service import reminder_or_none, update_reminder

    reminder = reminder_or_none(db, payload.reminder_id)
    if reminder is None:
        raise ActionError("not_found", f"提醒 {payload.reminder_id} 不存在")
    fields = payload.model_dump(exclude={"reminder_id"}, exclude_unset=True, mode="json")
    if not fields:
        # 旧 PATCH 空 body 是 200 no-op；两侧统一成同一结果（工具侧历史会报错，已记录差异）。
        return ActionOutcome(
            summary=f"未修改提醒「{reminder.title}」（没有给出要改的字段）",
            text=json.dumps({"id": reminder.id, "updated": []}, ensure_ascii=False),
            link="/tracker",
            changed=False,
            data=reminder,
        )
    update_payload = ReminderUpdate.model_validate(fields)
    updated = update_reminder(db, reminder, update_payload)
    if "status" in fields:
        summary = (
            f"把提醒「{updated.title}」标记为{_STATUS_LABELS.get(updated.status, updated.status)}"
        )
    else:
        summary = f"更新了提醒「{updated.title}」"
    return ActionOutcome(
        summary=summary,
        text=json.dumps(
            {"id": updated.id, "title": updated.title, "status": updated.status},
            ensure_ascii=False,
        ),
        link="/tracker",
        changed=True,
        data=updated,
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def reminder_actions() -> dict[str, ActionSpec]:
    """构建（并注册）reminders 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    list_reminders = define_action(
        ActionSpec(
            name="list_reminders",
            description=(
                "列出日历提醒（面试、测评截止、催 HR 回复、其他），可按类型或状态筛选。"
                "用户问「我接下来要做什么」「我有几个提醒」时用它。"
            ),
            input_model=ListRemindersInput,
            permission=Permission.READ_ONLY,
            run=_run_list_reminders,
            service_entry="reminder_service.list_reminders",
            tool_defaults=(("limit", _DEFAULT_TOOL_LIST_LIMIT),),
            http=HttpRoute(
                "GET", "/api/reminders", list[ReminderListItemOut], tags=("reminders",)
            ),
        )
    )
    update_reminder = define_action(
        ActionSpec(
            name="update_reminder",
            description=(
                "把一条日历提醒标记为 done（已完成）或 dismissed（已忽略），也可改回 pending。"
                "用户说「那个提醒我弄完了」「这条不用管了」时先用 list_reminders 找到 id 再调用。"
                "提醒时间、绑定与备注的修改请在「求职进度 → 提醒」页做。"
            ),
            input_model=UpdateReminderInput,
            permission=Permission.REVERSIBLE_WRITE,
            run=_run_update_reminder,
            preview=_preview_update_reminder,
            service_entry="reminder_service.update_reminder",
            http=HttpRoute(
                "PATCH", "/api/reminders/{reminder_id}", ReminderOut, tags=("reminders",)
            ),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_reminders, update_reminder)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    """domains 包的统一构建器入口（actions.catalog 自动发现用）。"""
    return reminder_actions()


__all__ = ["ListRemindersInput", "UpdateReminderInput", "actions", "reminder_actions"]

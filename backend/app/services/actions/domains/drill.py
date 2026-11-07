# SPDX-License-Identifier: Apache-2.0
"""drill 域的 action 契约（T28 收尾批）：list_drill_sessions / get_drill_report。

迁移对：
- list_drill_sessions ↔ GET /api/drill（只读；工具侧默认 limit=20）
- get_drill_report    ↔ GET /api/drill/{session_id}（只读；路由读会话详情，
  工具侧复用既有 handler 给逐题判定/复盘文案）

run 委托既有路由 handler，run_tool 委托既有工具 handler，不复制业务逻辑。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.drill import DrillSessionBrief, DrillSessionOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401

_DEFAULT_TOOL_LIMIT = 20


class ListDrillSessionsInput(BaseModel):
    """list_drill_sessions 入参：路由只有 status，工具另有 limit 截断。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["", "active", "finished"] = Field(
        default="", description="可选：active 进行中，finished 已结束"
    )
    limit: int | None = Field(default=None, ge=1, le=50, description="可选，默认 20")


class GetDrillReportInput(BaseModel):
    """get_drill_report 入参：session_id 来自路由路径 / 工具 JSON。"""

    model_config = ConfigDict(extra="forbid")

    session_id: int = Field(ge=1, description="深挖记录 id（先用 list_drill_sessions 查）")


_ACTIONS: dict[str, ActionSpec] | None = None


def drill_actions() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # permission_enum 可能触发工具声明模块重入本构建器（首次 import 顺序）
        return _ACTIONS
    list_drill_sessions = define_action(
        ActionSpec(
            name="list_drill_sessions",
            description=(
                "列出按事实台账做的面试深挖记录（一条主张一道题、用证据状态判定讲不讲得清）。"
                "用户说「我练过的那些」「上次深挖练了什么」时用它。注意它与「模拟面试」不同："
                "模拟面试给四维度评分报告，深挖不给分数。"
            ),
            input_model=ListDrillSessionsInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.drill", "list_sessions"),
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.drill", "_tool_list_drill_sessions"
            ),
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            tool_fields=("status", "limit"),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/drill", list[DrillSessionBrief], tags=("drill",)),
        )
    )
    get_drill_report = define_action(
        ActionSpec(
            name="get_drill_report",
            description=(
                "读取某场面试深挖的逐题判定、行动清单与复练队列（用于复盘薄弱点）。"
                "用户的某条主张「讲不讲得清」「该补什么」都在这份记录里。"
            ),
            input_model=GetDrillReportInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.drill", "read_session"),
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.drill", "_tool_get_drill_report"
            ),
            service_entry="drill.session_summary",
            tool_fields=("session_id",),
            http=HttpRoute("GET", "/api/drill/{session_id}", DrillSessionOut, tags=("drill",)),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_drill_sessions, get_drill_report)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return drill_actions()


__all__ = ["GetDrillReportInput", "ListDrillSessionsInput", "actions", "drill_actions"]

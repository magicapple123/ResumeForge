# SPDX-License-Identifier: Apache-2.0
"""interview（模拟面试）域的 action 契约（T28 收尾批）：

- list_interview_sessions ↔ GET /api/interview（只读；路由 limit 默认 50，工具默认 20）
- get_interview_report    ↔ GET /api/interview/{session_id}（只读；路由返回会话详情，
  工具侧复用既有 handler 给出 Q&A + 评分报告文案）

路由侧 status 筛选是工具字段（旧路由没有 status 参数，不参与路由调用）；
limit 两侧语义一致（已测：工具路径由 tool_defaults 保 20）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.interview import InterviewBrief, InterviewDetail
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401

_DEFAULT_TOOL_LIMIT = 20


class ListInterviewSessionsInput(BaseModel):
    """list_interview_sessions 入参：limit 与 status（status 仅工具侧过滤）。"""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=50, ge=1, le=200, description="可选，默认 20")
    status: Literal["", "active", "finished"] = Field(
        default="", description="可选：active 进行中，finished 已结束"
    )


class GetInterviewReportInput(BaseModel):
    """get_interview_report 入参：session_id 来自路由路径 / 工具 JSON。"""

    model_config = ConfigDict(extra="forbid")

    session_id: int = Field(ge=1, description="面试 id（先用 list_interview_sessions 查）")


_ACTIONS: dict[str, ActionSpec] | None = None


def interview_actions() -> dict[str, ActionSpec]:
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
    list_interview_sessions = define_action(
        ActionSpec(
            name="list_interview_sessions",
            description=(
                "列出用户做过的模拟面试（类型、难度、轮数、状态与总分）。"
                "用户问「我之前的面试练得怎么样」时用它。"
            ),
            input_model=ListInterviewSessionsInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.interview", "list_sessions"),
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_list_interview_sessions"
            ),
            service_entry="interview.interview.answered_rounds",
            tool_fields=("status", "limit"),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/interview", list[InterviewBrief], tags=("interview",)),
        )
    )
    get_interview_report = define_action(
        ActionSpec(
            name="get_interview_report",
            description=(
                "读取某场模拟面试的问答记录与评分报告（用于复盘、总结薄弱点）。"
                "用户说「帮我看看上次面试哪里答得不好」时用它。"
            ),
            input_model=GetInterviewReportInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.interview", "read_session"),
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_get_interview_report"
            ),
            service_entry="interview.interview.answered_rounds",
            tool_fields=("session_id",),
            http=HttpRoute(
                "GET", "/api/interview/{session_id}", InterviewDetail, tags=("interview",)
            ),
        )
    )
    _ACTIONS = {spec.name: spec for spec in (list_interview_sessions, get_interview_report)}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return interview_actions()


__all__ = [
    "GetInterviewReportInput",
    "ListInterviewSessionsInput",
    "actions",
    "interview_actions",
]

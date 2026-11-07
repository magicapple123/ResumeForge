# SPDX-License-Identifier: Apache-2.0
"""question_banks 域的 action 契约（T28 收尾批）：list_question_banks。

只读：GET /api/interview/question-banks ↔ 工具 list_question_banks。
路由 limit 默认 100（全量列表），工具默认 20；两侧 limit 字段同义，tool_defaults 保住
工具历史默认值，路由默认值由 input_model 的 100 保持。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.interview_history import QuestionBankRecordOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401

_DEFAULT_TOOL_LIMIT = 20


class ListQuestionBanksInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=100, ge=1, le=200, description="可选，默认 20")


_ACTIONS: dict[str, ActionSpec] | None = None


def question_bank_actions() -> dict[str, ActionSpec]:
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
    list_question_banks = define_action(
        ActionSpec(
            name="list_question_banks",
            description=(
                "列出保存过的题库历史（针对某岗位/简历生成并保存的题目分组）。"
                "用户问「我之前生成过哪些题库」时用它。"
            ),
            input_model=ListQuestionBanksInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.interview_history", "read_question_banks"),
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_list_question_banks"
            ),
            service_entry="interview.interview_history.list_question_banks",
            tool_fields=("limit",),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET",
                "/api/interview/question-banks",
                list[QuestionBankRecordOut],
                tags=("interview-history",),
            ),
        )
    )
    _ACTIONS = {list_question_banks.name: list_question_banks}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return question_bank_actions()


__all__ = ["ListQuestionBanksInput", "actions", "question_bank_actions"]

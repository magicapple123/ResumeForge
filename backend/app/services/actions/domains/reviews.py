# SPDX-License-Identifier: Apache-2.0
"""reviews 域的 action 契约（T28 收尾批）：list_reviews。

只读：GET /api/interview/reviews ↔ 工具 list_reviews。
路由 limit 默认 100，工具默认 20；tool_defaults 保住工具历史默认值。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.interview_history import InterviewReviewRecordOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401

_DEFAULT_TOOL_LIMIT = 20


class ListReviewsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=100, ge=1, le=200, description="可选，默认 20")


_ACTIONS: dict[str, ActionSpec] | None = None


def review_actions() -> dict[str, ActionSpec]:
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
    list_reviews = define_action(
        ActionSpec(
            name="list_reviews",
            description=(
                "列出保存过的面试复盘历史（真实被问问题清单 + 答题思路 + 反向优化建议）。"
                "用户问「我之前的复盘」时用它。"
            ),
            input_model=ListReviewsInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.interview_history", "read_reviews"),
            run_tool=tool_runner("app.services.assistant_tools.report_tools", "_tool_list_reviews"),
            service_entry="interview.interview_history.list_reviews",
            tool_fields=("limit",),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET",
                "/api/interview/reviews",
                list[InterviewReviewRecordOut],
                tags=("interview-history",),
            ),
        )
    )
    _ACTIONS = {list_reviews.name: list_reviews}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return review_actions()


__all__ = ["ListReviewsInput", "actions", "review_actions"]

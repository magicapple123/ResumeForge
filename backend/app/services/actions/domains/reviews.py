# SPDX-License-Identifier: Apache-2.0
"""reviews 域的 action 契约（T28 收尾批）：list_reviews。

只读：GET /api/interview/reviews ↔ 工具 list_reviews。
路由 limit 默认 100，工具默认 20；tool_defaults 保住工具历史默认值。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.interview_history import InterviewReviewRecordOut
from ...interview import interview_history
from ..legacy import tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_DEFAULT_TOOL_LIMIT = 20


class ListReviewsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=100, ge=1, le=200, description="可选，默认 20")


def _run_list_reviews(db: Session, payload: ListReviewsInput) -> ActionOutcome:
    """复盘历史列表：与 ``GET /api/interview/reviews`` 同一个服务函数。"""
    return ActionOutcome(data=interview_history.list_reviews(db, limit=payload.limit))


_ACTIONS: dict[str, ActionSpec] | None = None


def review_actions() -> dict[str, ActionSpec]:
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # permission_enum 可能触发工具声明模块重入本构建器（首次 import 顺序）
        return _ACTIONS
    list_reviews = ActionSpec(
        name="list_reviews",
        description=(
            "列出保存过的面试复盘历史（真实被问问题清单 + 答题思路 + 反向优化建议）。"
            "用户问「我之前的复盘」时用它。"
        ),
        input_model=ListReviewsInput,
        permission=Permission.READ_ONLY,
        run=_run_list_reviews,
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
    _ACTIONS = {list_reviews.name: list_reviews}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return review_actions()


__all__ = ["ListReviewsInput", "actions", "review_actions"]

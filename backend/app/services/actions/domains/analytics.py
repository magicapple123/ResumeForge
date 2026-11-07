# SPDX-License-Identifier: Apache-2.0
"""analytics 域的 action 契约（T28 收尾批）：get_analytics_overview。

只读：GET /api/analytics/dashboard ↔ 工具 get_analytics_overview。
路由入参 trend_months（默认 6）是路由专属字段，工具侧不暴露（tool_fields 为空）；
工具侧历史不接受任何参数，文案/摘要由既有工具 handler 负责。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.analytics import DashboardOut
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

if TYPE_CHECKING:
    from sqlalchemy.orm import Session  # noqa: F401


class AnalyticsOverviewInput(BaseModel):
    """get_analytics_overview 入参：trend_months 只给路由用，工具侧无参数。"""

    model_config = ConfigDict(extra="forbid")

    trend_months: int = Field(
        default=6, ge=1, le=24, description="趋势统计的自然月数（1..24，路由看板用）"
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def analytics_actions() -> dict[str, ActionSpec]:
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
    get_analytics_overview = define_action(
        ActionSpec(
            name="get_analytics_overview",
            description=(
                "查看求职统计看板：投递总量、有效投递、面试率、Offer 数、六阶段漏斗与月度趋势。"
                "用户问「我投了多少」「我的求职数据怎么样」时用它。"
            ),
            input_model=AnalyticsOverviewInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.analytics", "read_dashboard"),
            run_tool=tool_runner(
                "app.services.assistant_tools.report_tools", "_tool_get_analytics_overview"
            ),
            service_entry="analytics.build_dashboard",
            tool_fields=(),
            ignore_unknown_arguments=True,
            http=HttpRoute("GET", "/api/analytics/dashboard", DashboardOut, tags=("analytics",)),
        )
    )
    _ACTIONS = {get_analytics_overview.name: get_analytics_overview}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return analytics_actions()


__all__ = ["AnalyticsOverviewInput", "actions", "analytics_actions"]

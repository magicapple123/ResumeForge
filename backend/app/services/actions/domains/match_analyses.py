# SPDX-License-Identifier: Apache-2.0
"""match_analyses 域 action 契约（T28 收尾）：历史岗位适配度分析（只读）。

迁移对（行为零漂移：run / run_tool 都直接委托既有实现）：

- list_match_analyses ↔ GET /api/jobs/match-batches
  （handler app.api.job_match.get_match_batch_history，响应 list[JobMatchBatchSummary]）

**产品红线保留**：工具侧仍走旧 handler _tool_list_match_analyses，匹配度只有五类定性
结论、reference_score / rank / top_score 与自由文本里的数字评分一律剔除；路由侧仍返回
原有 JobMatchBatchSummary（含 top_score），两条路径各自保持迁移前行为。
路由默认 limit=30（Query default），工具默认 limit=5（旧 handler 口径，用 tool_defaults）。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.job_match_batch import JobMatchBatchSummary
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

_ROUTE_LIST_LIMIT = 30
_DEFAULT_TOOL_LIMIT = 5


class ListMatchAnalysesInput(BaseModel):
    """list_match_analyses 两侧共用入参：route/tool 都只有 limit（默认值不同）。"""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(
        default=_ROUTE_LIST_LIMIT,
        ge=1,
        le=100,
        description="可选，最多看多少个批次（每批含全部岗位）；工具默认 5",
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def match_analysis_actions() -> dict[str, ActionSpec]:
    """构建（并注册）match_analyses 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_match_analyses = define_action(
        ActionSpec(
            name="list_match_analyses",
            description=(
                "查看历史批量岗位适配度分析记录（岗位/状态/硬性门槛/准入结论/建议要点）。"
                "用户问「之前的匹配分析怎么说」「分析记录里有什么」时用它。"
                "注意：匹配度只有五类定性结论，没有分数或百分比，回答里也不要编数字评分。"
            ),
            input_model=ListMatchAnalysesInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.job_match", "get_match_batch_history"),
            run_tool=tool_runner(
                "app.services.assistant_tools.p3_tools", "_tool_list_match_analyses"
            ),
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            tool_fields=("limit",),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET",
                "/api/jobs/match-batches",
                list[JobMatchBatchSummary],
                tags=("job-match",),
            ),
        )
    )
    _ACTIONS = {list_match_analyses.name: list_match_analyses}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return match_analysis_actions()


__all__ = ["ListMatchAnalysesInput", "actions", "match_analysis_actions"]

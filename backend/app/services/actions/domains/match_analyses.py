# SPDX-License-Identifier: Apache-2.0
"""match_analyses 域 action 契约（T28 收尾）：历史岗位适配度分析（只读）。

迁移对（行为零漂移：run / run_tool 都直接委托既有实现）：

- list_match_analyses ↔ GET /api/jobs/match-batches
  （run 调 services.job.job_match_batch.list_batch_summaries，路由 handler 是它的薄壳；
  响应 list[JobMatchBatchSummary]）

**产品红线保留**：工具侧仍走旧 handler _tool_list_match_analyses，匹配度只有五类定性
结论、reference_score / rank / top_score 与自由文本里的数字评分一律剔除；路由侧仍返回
原有 JobMatchBatchSummary（含 top_score），两条路径各自保持迁移前行为。
路由默认 limit=30（Query default），工具默认 limit=5（旧 handler 口径，用 tool_defaults）。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.job_match_batch import JobMatchBatchSummary
from ...job.job_match_batch import list_batch_summaries
from ..legacy import tool_runner
from ..spec import ActionOutcome, ActionSpec, HttpRoute, permission_enum

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


def _run_list_match_analyses(db, payload: ListMatchAnalysesInput) -> ActionOutcome:
    """历史批量匹配摘要：与 ``GET /api/jobs/match-batches`` 同一个服务函数。"""
    return ActionOutcome(data=list_batch_summaries(db, limit=payload.limit))


_ACTIONS: dict[str, ActionSpec] | None = None


def match_analysis_actions() -> dict[str, ActionSpec]:
    """构建（不注册）match_analyses 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_match_analyses = ActionSpec(
        name="list_match_analyses",
        description=(
            "查看历史批量岗位适配度分析记录（岗位/状态/硬性门槛/准入结论/建议要点）。"
            "用户问「之前的匹配分析怎么说」「分析记录里有什么」时用它。"
            "注意：匹配度只有五类定性结论，没有分数或百分比，回答里也不要编数字评分。"
        ),
        input_model=ListMatchAnalysesInput,
        permission=Permission.READ_ONLY,
        run=_run_list_match_analyses,
        run_tool=tool_runner("app.services.assistant_tools.p3_tools", "_tool_list_match_analyses"),
        service_entry="job.job_match_batch.list_batch_summaries",
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
    _ACTIONS = {list_match_analyses.name: list_match_analyses}
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return match_analysis_actions()


__all__ = ["ListMatchAnalysesInput", "actions", "match_analysis_actions"]

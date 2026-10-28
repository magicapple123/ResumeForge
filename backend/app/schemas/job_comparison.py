# SPDX-License-Identifier: Apache-2.0
"""岗位横向对比的数据结构（「AI 对比选岗」的结果）。

与 ``JobMatchResult`` 的区别：匹配结论回答"这一个岗位我够不够"，横向对比回答"这几个
岗位里哪个更适合我、为什么"。因此这里**没有**五类状态矩阵，只有排序、档位与理由。

三条硬约束：

1. **不出现百分比 / 评分**：档位只到"最合适 / 较合适 / 一般 / 偏弱"这一层，排序是相对
   判断，不给它配一个数字。参考分仍由本地规则单独算，只作展示。
2. 每条理由必须是**已有匹配结论 / 资料 / JD 里的事实**，不得引入新事实。
3. ``job_id`` 与 ``rank`` 由服务端核对：必须覆盖全部参与对比的岗位、名次连续唯一。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ComparisonVerdict = Literal["best", "good", "fair", "weak"]

MAX_COMPARISON_HEADLINE_CHARS = 240
MAX_COMPARISON_REASON_CHARS = 300
MAX_COMPARISON_SUMMARY_CHARS = 800


class JobComparisonItem(BaseModel):
    """一个岗位在本次横向对比里的名次与理由。"""

    model_config = ConfigDict(extra="forbid")

    job_id: int
    rank: int = Field(ge=1)
    verdict: ComparisonVerdict
    headline: str = Field(default="", max_length=MAX_COMPARISON_HEADLINE_CHARS)
    reasons: list[str] = Field(default_factory=list, max_length=6)
    concerns: list[str] = Field(default_factory=list, max_length=6)


class JobComparisonResult(BaseModel):
    """一次横向对比的完整结论；``error`` 非空表示降级/失败说明。"""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(default="", max_length=MAX_COMPARISON_SUMMARY_CHARS)
    items: list[JobComparisonItem] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list, max_length=10)
    error: str = ""
    model: str = ""


__all__ = [
    "ComparisonVerdict",
    "JobComparisonItem",
    "JobComparisonResult",
    "MAX_COMPARISON_HEADLINE_CHARS",
    "MAX_COMPARISON_REASON_CHARS",
    "MAX_COMPARISON_SUMMARY_CHARS",
]

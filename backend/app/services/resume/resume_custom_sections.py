# SPDX-License-Identifier: Apache-2.0
"""需求 6：自建板块「参与岗位相关性筛选」在生成链上的唯一执行点。

**为什么单独成模块**：`generation_postprocess` 贴着 500 行预算，而这块逻辑要同时碰
"消费快照裁条目 → 纸面投影 → 覆盖度明细 → 生成说明计数"四件事，塞回既有模块会把预算顶穿。

**职责边界**：
- 判定在 ``profile_custom_filter.plan_custom_section_filter``（与内置分区同一个
  ``_score_item``、同一个 ``JobFocus``，那里是唯一判据）；
- 本模块只做编排：算计划 → 按计划投影自建板块 → 把"入选条数"与"没写进简历的条目"
  放进本次生成的中间产物（``selection_data``），供生成说明与覆盖度清单消费。

**开关关 / 通用简历**：计划为空，投影拿到的仍是原始快照，输出与改动前逐字节一致。
"""

from __future__ import annotations

from typing import Any

from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from ..profile.paper_projection import project_paper_content
from ..profile.profile_custom_filter import (
    CustomSectionFilter,
    apply_custom_section_filter,
    find_unwritten_custom_details,
    plan_custom_section_filter,
)

__all__ = ["COUNTS_KEY", "COVERAGE_KEY", "attach_custom_sections"]

#: selection_data 里的键：自建板块的入选条数（生成说明）/ 未收录明细（覆盖度清单）。
COUNTS_KEY = "custom_sections"
COVERAGE_KEY = "custom_section_coverage"


def attach_custom_sections(
    resume: ResumeContent,
    consumed: ConsumedProfile,
    focus: Any = None,
    selection_data: dict[str, Any] | None = None,
    *,
    custom_filter: CustomSectionFilter | None = None,
) -> ResumeContent:
    """C2：按消费快照确定性写入 content.custom_sections（顺序/标题/行都由投影冻结）。

    R-37 单源：自建分区的「主文本 / 标签行」判定只在 paper_policy.custom_section_text_field，
    生成链与填充链共用同一份投影（不做第二套生成期映射）。

    需求 6 的两个入口参数：
    - ``focus``（``JobFocus``；通用简历传空 focus 即可，计划恒为空）：算「参与岗位筛选」
      的取舍计划；
    - ``selection_data``：把入选条数与未收录明细写回本次生成的中间产物，供生成说明与
      「这些资料内容没有写进这份简历」消费。

    都不传 = 一个条目都不裁（旧行为逐字节一致）；``custom_filter`` 用于调用方已算好计划
    的场景（测试与两步式调用）。
    """
    plan = (
        custom_filter if custom_filter is not None else plan_custom_section_filter(consumed, focus)
    )
    projected = project_paper_content(apply_custom_section_filter(consumed, plan))
    custom_sections = list(getattr(projected, "custom_sections", None) or [])
    updated = resume.model_copy(update={"custom_sections": custom_sections})
    if selection_data is not None and plan.active:
        selection_data[COUNTS_KEY] = plan.counts()
        selection_data[COVERAGE_KEY] = find_unwritten_custom_details(updated, consumed, plan)
    return updated

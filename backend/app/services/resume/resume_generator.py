# SPDX-License-Identifier: Apache-2.0
"""简历生成兼容门面与流式生成编排。

模型输出解析、事实回填、一致性检查和质量门槛分别位于职责模块；本文件保留原有
公共入口与步骤顺序，五步流水线（取数 → 渲染 → 重试 → 后处理 → 定稿）的实现见
同目录 resume_generator_steps。
"""

import logging
from collections.abc import AsyncGenerator
from contextlib import aclosing
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from ...config import get_settings
from ...runtime.operation_budget import OperationBudget
from ...schemas.claim import ClaimDigestOut
from ...schemas.job import JobOut
from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import GenerateOptions, ResumeContent
from ..llm.base import BaseLLMProvider
from ..llm.usage import LLMUsage
from ..profile.profile_relevance import (
    build_general_profile_context,
    build_job_prompt_text,
    build_profile_prompt_data,
    build_targeted_profile_context,
    split_commas,
    split_lines,
)
from .resume_consistency import check_consistency
from .resume_content import _LIST_FIELDS, coerce_resume, extract_json
from .resume_generation_helpers import parse_resume
from .resume_generator_prompts import (
    _ENHANCEMENT_DISABLED_GUIDE,
    ENHANCEMENT_LEVEL_GUIDES,
    MAX_JD_CHARS,
    MAX_PROFILE_CHARS,
)
from .resume_generator_steps import (
    GenerationContext,
    _step_collect_inputs,
    _step_emit_done,
    _step_postprocess_content,
    _step_quality_and_space_retry,
    _step_stream_model_output,
)
from .resume_grounding import (
    _REFERENCE_FALLBACK_LIMITS,
    _build_grounded_summary,
    _enhance_or_restore_list,
    _find_source,
    _ground_list,
    _ground_or_restore_list,
    _normalize_fact,
    _selected_data_with_reference_fallbacks,
    _similar,
    _similar_skill,
    _source_evidence_text,
    _source_list,
    _source_value,
    _unsupported_quantified_values,
    ground_resume_facts,
    ground_resume_facts_with_annotations,
    restore_selected_sections,
)
from .resume_quality import (
    _quality_generated_points,
    _quality_reference_points,
    _quality_shortfalls,
)

PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"
logger = logging.getLogger(__name__)


class ResumeGenerator:
    """简历生成器：一次生成 = 一条事件流。"""

    def __init__(self, provider: BaseLLMProvider):
        self.provider = provider
        # StrictUndefined：模板变量缺失时立即报错，而不是静默渲染成空。
        self._env = Environment(
            loader=FileSystemLoader(PROMPTS_DIR),
            undefined=StrictUndefined,
            autoescape=select_autoescape(default=False, default_for_string=False),
        )
        # 多段用量汇总（审计 PR-07-6）：主生成 / 格式修复 / 质量重试各段结束后各补
        # 一次 provider.last_usage（失败与取消轮次同样收集，能拿到多少算多少）。
        self.usage_records: list[LLMUsage] = []
        # 整链总预算（generate 时按值记录）：段结束后恢复注入，主生成流的硬墙钟
        # 在余下的调用里继续生效。
        self._total_budget: OperationBudget | None = None

    async def generate(
        self,
        profile: ProfileOut | None,
        job: JobOut | None,
        options: GenerateOptions,
        *,
        baseline: ClaimDigestOut | None = None,
        budget: OperationBudget | None = None,
        career_context_block: str = "",
        fact_sections: dict[str, Any] | None = None,
        consumed: ConsumedProfile | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """执行生成流程，依次产出进度、增量、完成或错误事件。

        job is None 表示**通用简历**：不针对任何岗位，候选资料是完整资料库，筛选层换成
        build_general_profile_context（见那里的说明——不能靠"传空岗位"让岗位路径自己
        退化，那条路径会丢掉校园经历、奖项、技能与总结）。

        consumed 是 F2 冻结的**当前组消费快照**（F3/R-28）：非空时只走消费层候选，profile
        可以传 None（新链路不读旧资料表）。按组过滤发生在任何评分/名额/预算之前；未参与
        分区整键不出现（R-29），参与但无数据的分区保留空数组（C1）。

        baseline 是事实台账已确认的条目。**不传、或台账为空时渲染出的提示词与以前逐字节
        相同**——没启用台账的用户不该因为这次改动而拿到不一样的简历。

        career_context_block 是调用方（API/runner）解析并裁剪过的职业场景表达指南（A5）。
        缺省空串时模板整块不渲染，提示词与旧行为逐字节一致；本模块不读数据库、不读 UI
        当前选择，只消费已冻结的文本。fact_sections 是补充事实快照：2.0 已删除补充事实，
        调用方恒传 None，此时输出与旧行为逐字节一致（参数保留以兼容历史调用）。

        budget 是整链总预算（RF-14 §2.1.a）：None 时行为与以前逐字节一致；三段调用的
        分段/降级/取消传播语义原样保留在步骤内（见 resume_generator_steps）。
        """
        ctx = GenerationContext(
            self, profile, job, options, baseline=baseline, budget=budget,
            career_context_block=career_context_block, fact_sections=fact_sections,
            consumed=consumed, get_settings=get_settings,
        )
        async for event in _step_collect_inputs(ctx):
            yield event
        async with aclosing(_step_stream_model_output(ctx)) as events:
            async for event in events:
                yield event
        if ctx.terminated:
            return
        async for event in _step_quality_and_space_retry(ctx):
            yield event
        async for event in _step_postprocess_content(ctx):
            yield event
        if ctx.terminated:
            return
        async for event in _step_emit_done(ctx):
            yield event

    # ===== 预算分段（RF-14 §2.1.c）=====

    def _parse(self, raw: str) -> ResumeContent | None:
        return parse_resume(raw)


__all__ = [
    "ResumeGenerator",
    "extract_json",
    "coerce_resume",
    "check_consistency",
    "ground_resume_facts",
    "ground_resume_facts_with_annotations",
    "restore_selected_sections",
    "build_profile_prompt_data",
    "build_job_prompt_text",
    "build_general_profile_context",
    "build_targeted_profile_context",
    "split_commas",
    "split_lines",
    "MAX_JD_CHARS",
    "MAX_PROFILE_CHARS",
    "ENHANCEMENT_LEVEL_GUIDES",
    "_ENHANCEMENT_DISABLED_GUIDE",
    "_LIST_FIELDS",
    "_REFERENCE_FALLBACK_LIMITS",
    "_similar",
    "_similar_skill",
    "_source_value",
    "_find_source",
    "_normalize_fact",
    "_ground_list",
    "_unsupported_quantified_values",
    "_source_list",
    "_ground_or_restore_list",
    "_source_evidence_text",
    "_enhance_or_restore_list",
    "_build_grounded_summary",
    "_selected_data_with_reference_fallbacks",
    "_quality_shortfalls",
    "_quality_reference_points",
    "_quality_generated_points",
]

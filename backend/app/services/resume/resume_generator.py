# SPDX-License-Identifier: Apache-2.0
"""简历生成兼容门面与流式生成编排。

模型输出解析、事实回填、一致性检查和质量门槛分别位于职责模块；本文件只
保留原有公共入口，并负责把各步骤编排为 API 使用的异步事件流。
"""

import logging
from collections.abc import AsyncGenerator
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
from ..llm.token_estimate import estimate_tokens
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
from .resume_coverage import (
    all_entry_names,
    confirmed_claims_about,
    find_unwritten_details,
)
from .resume_generation_helpers import (
    parse_resume,
    record_call_usage,
)
from .resume_generator_prompts import (
    _ENHANCEMENT_DISABLED_GUIDE,
    ENHANCEMENT_LEVEL_GUIDES,
    MAX_JD_CHARS,
    MAX_PROFILE_CHARS,
    append_generation_warnings,
    build_profile_selection,
    build_progress_events,
    build_rationale,
    consumed_photo,
    legacy_postprocess_resume,
    render_generation_messages,
    repair_resume_json,
    run_quality_retry,
    selection_data_for,
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
from .resume_wording import cliche_shortfalls

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

        ``job is None`` 表示**通用简历**：不针对任何岗位，候选资料是完整资料库，
        筛选层换成 ``build_general_profile_context``（见那里的说明——不能靠"传空岗位"
        让岗位路径自己退化，那条路径会丢掉校园经历、奖项、技能与总结）。

        consumed 是 F2 冻结的**当前组消费快照**（F3/R-28）：非空时只走消费层候选，
        profile 可以传 None（新链路不读旧资料表）。按组过滤发生在任何评分/名额/
        预算之前；未参与分区整键不出现（R-29），参与但无数据的分区保留空数组（C1）。

        ``baseline`` 是事实台账已确认的条目。**不传、或台账为空时渲染出的提示词与
        以前逐字节相同**——没启用台账的用户不该因为这次改动而拿到不一样的简历。

        ``career_context_block`` 是调用方（API/runner）用服务端 resolver 解析并裁剪过的
        职业场景表达指南（A5）。**缺省空串时模板整块不渲染，提示词与旧行为逐字节一致**；
        本模块不读数据库、不读 UI 当前选择，只消费已冻结的文本。

        ``fact_sections`` 是补充事实快照（``profile.fact_context.build_fact_sections`` 的输出）：
        六类事实并入同一份候选资料，``None``/六类全空时输出与旧行为逐字节一致。

        ``budget`` 是整链总预算（RF-14 §2.1.a，可选，None 时行为与以前逐字节一致）。
        三段模型调用的分段规则：
        - **主生成流**（stream_chat）：不需要 child——runner 已对每个事件
          ``raise_if_stopped()``；这里只在流开始前补一次检查（防御"上一段耗尽后才进流"）。
        - **格式修复 chat / 质量重试 chat**：各自取 ``budget.child()``——它们是两个事件
          之间的完整 provider.chat，runner 的事件检查对进行中的调用不可见（预算盲区）。
        谁兜谁（核心语义）：分项 read timeout 是"单请求不挂死"的**下限**（现状，保留）；
        总预算是整链**上限**。非流式段把 read 压缩到 child 剩余（见 ``_begin_segment``），
        到期表现为 ``LLMError``——捕获后若 ``budget.is_expired()``，改写成预算文案，
        **不得把预算耗尽误报成网络慢**。取消传播不变：budget.cancel_event 即 runner 的
        ``_stop``，generator 只接受预算检查、不接触取消信号。
        """
        general = job is None
        yield {
            "type": "progress",
            "message": "正在整理完整资料…" if general else "正在分析岗位要求与资料匹配度…",
        }
        # F3/R-28：consumed 非空即"冻结的当前组消费快照"路径——候选只含参与分区，
        # 且构造发生在任何评分/名额/预算之前。旧 ProfileOut 路径保留给既有调用方与
        # 三链外消费者，输出与改造前逐字节一致。
        scoped = consumed is not None
        selection = build_profile_selection(
            consumed=consumed,
            profile=profile,
            job=job,
            general=general,
            options=options,
            fact_sections=fact_sections,
            max_chars=MAX_PROFILE_CHARS,
        )
        selection_data = selection_data_for(selection)
        for event in build_progress_events(
            general, selection, enhance=options.enhance, scoped=scoped
        ):
            yield event
        messages = render_generation_messages(
            self._env,
            selection,
            job,
            options,
            baseline=baseline,
            career_context_block=career_context_block,
            general=general,
            scoped=scoped,
        )

        if budget is not None:
            # 流开始前检查预算（§2.1.a-2）；并把整链硬墙钟接给 provider（PR-07-3）。
            budget.raise_if_stopped()
            self._total_budget = budget
            self.provider.request_budget = budget
        # token 估算遥测（RF-14 §2.5）：默认关；只进 done 事件，不改请求体、不作截断依据。
        estimated_prompt_tokens: int | None = None
        if get_settings().llm_token_estimate_enabled:
            estimated_prompt_tokens = sum(
                estimate_tokens(str(message.get("content") or "")) for message in messages
            )

        yield {
            "type": "progress",
            "message": f"正在调用模型 {self.provider.config.model} 生成简历…",
        }
        parts: list[str] = []
        stream = self.provider.stream_chat(messages)
        try:
            async for delta in stream:
                parts.append(delta)
                yield {"type": "delta", "text": delta}
        finally:
            # 取消/超时/异常路径也显式关闭 provider 流（aclosing 纪律，PR-07-4）：
            # GeneratorExit 逐层展开，provider 的 finally 才能写 last_usage、
            # response 才能及时关闭；随后补记本段用量（失败轮次也收集）。
            await stream.aclose()
            record_call_usage(self.provider, self.usage_records)

        raw = "".join(parts)
        resume = self._parse(raw)

        # 输出不是合法 JSON：用修复 Prompt 重试一次，仍然失败则降级报错。
        if resume is None:
            yield {"type": "progress", "message": "输出格式不符合要求，正在自动修复…"}
            resume, repair_error = await repair_resume_json(
                env=self._env,
                provider=self.provider,
                raw=raw,
                budget=budget,
                total_budget=self._total_budget,
                usage_records=self.usage_records,
            )
            if repair_error is not None:
                yield {"type": "error", "message": repair_error}
                return

        if resume is None:
            yield {"type": "error", "message": "模型输出未能解析为有效 JSON，请更换模型或重试"}
            return

        # strong 美化且带附件事实时，先检查模型是否真正完成了岗位化改写。
        has_reference_facts = any(
            _source_list(item, "reference_facts")
            for section in ("educations", "experiences", "campus_experiences", "projects")
            for item in selection.data.get(section, [])
        )
        quality_enabled = (
            options.enhance and options.enhancement_level == "strong" and has_reference_facts
        )
        content_shortfalls = (
            _quality_shortfalls(resume, selection.data, job) if quality_enabled else []
        )
        # 措辞门槛与美化档位无关，但只在允许改写时生效：关闭美化时正文是用户资料原文。
        wording_enabled = options.enhance
        wording_shortfalls = cliche_shortfalls(resume) if wording_enabled else []
        if content_shortfalls or wording_shortfalls:
            yield {
                "type": "progress",
                "message": "生成内容较简略，正在重新生成…"
                if content_shortfalls
                else "生成结果里有空话或套话，正在改写…",
            }
            retry_resume = await run_quality_retry(
                env=self._env,
                provider=self.provider,
                messages=messages,
                selection_data=selection_data,
                shortfalls=[*content_shortfalls, *wording_shortfalls],
                job=job,
                options=options,
                budget=budget,
                total_budget=self._total_budget,
                usage_records=self.usage_records,
            )
            if retry_resume is not None:
                resume = retry_resume

        if scoped:
            # 一致性/覆盖度/说明都只读本次消费快照（R-30：不出现未参与分区）。
            warnings = check_consistency(
                resume, consumed, selection_data, source_label="完整资料" if general else None
            )
        else:
            # legacy 路径必须持有 ProfileOut：build_profile_selection 在 profile 与
            # consumed 双空时已抛 ValueError，走到这里 profile 一定非 None。
            assert profile is not None
            warnings = check_consistency(
                resume,
                profile,
                selection.data,
                source_label="完整资料" if general else None,
            )
        warnings = append_generation_warnings(
            warnings, resume, selection_data, general=general, wording_enabled=wording_enabled
        )
        # 后处理顺序（F3 §3 / store-owner 定稿）：grounding → 扩展栏目回填 → C5-B →
        # C2 自建分区 → R-73 语言补位 → 诊断 → done。
        if scoped:
            from .generation_postprocess import (
                apply_profile_field_backfill,
                attach_custom_sections,
                ensure_custom_field_lines_in_resume,
            )
            from .grounding_entries import (
                ground_resume_facts_with_annotations as ground_consumed_facts,
            )
            from .language_restore import LanguageCapacityError, restore_language_skills

            resume, fact_annotations = ground_consumed_facts(
                resume,
                consumed,
                job,
                selection_data,
                enhance=options.enhance,
                enhancement_level=options.enhancement_level,
            )
            # 扩展栏目（论文/科研/知识产权/证书）的整段回填仍由旧实现负责：
            # 新 grounding 只做旧六分区 + 身份/summary（store-owner 的定稿边界）。
            resume = restore_selected_sections(
                resume,
                selection_data["data"],
                enhance=options.enhance,
                enhancement_level=options.enhancement_level,
            )
            resume, custom_field_annotations = ensure_custom_field_lines_in_resume(resume, consumed)
            resume = attach_custom_sections(resume, consumed)
            # F8（R-81）：资料有值、结果槽位空 → 确定性回填；不改 AI 已写值、不阻断保存。
            resume = apply_profile_field_backfill(resume, consumed)
            try:
                resume, language_annotations = restore_language_skills(resume, consumed)
            except LanguageCapacityError as exc:
                # C14：技能 + 语言合并超过 200 条是结构化超限，不静默截断。
                yield {"type": "error", "message": exc.detail}
                return
            resume = resume.model_copy(update={"photo": consumed_photo(consumed)})
            annotations = [
                *fact_annotations,
                *custom_field_annotations,
                *language_annotations,
            ]
        else:
            # 旧链路：ProfileOut + 旧 grounding 语义（三链外调用方与既有测试依赖）。
            resume, annotation_items = legacy_postprocess_resume(
                resume, profile, job, selection_data, options
            )
            annotations = annotation_items
        # 覆盖度检查必须在所有修复/回填之后（比对用户最终看到的内容）；它是中性的
        # coverage_notes，不混进"疑似虚构"的 warnings 红墙。
        coverage_details = (
            find_unwritten_details(resume, consumed, selection_data)
            if scoped
            else find_unwritten_details(resume, selection.entry_names, selection.data)
        )
        confirmed_names = confirmed_claims_about(all_entry_names(selection.entry_names), baseline)
        rationale = build_rationale(
            job, selection, selection_data, coverage_details, confirmed_names
        )
        done_event = {
            "type": "done",
            "resume": resume.model_dump(),
            "warnings": warnings,
            "coverage_notes": coverage_details,
            "rationale": rationale,
            "fact_annotations": annotations,
        }
        if estimated_prompt_tokens is not None:
            # 遥测字段只占位在估算开启时（§2.5-2）；runner 把它并进用量结构化日志。
            done_event["estimated_prompt_tokens"] = estimated_prompt_tokens
        yield done_event

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

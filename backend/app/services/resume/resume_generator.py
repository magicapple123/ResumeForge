"""简历生成兼容门面与流式生成编排。

模型输出解析、事实回填、一致性检查和质量门槛分别位于职责模块；本文件只
保留原有公共入口，并负责把各步骤编排为 API 使用的异步事件流。
"""

import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from ...config import get_settings
from ...runtime.operation_budget import OperationBudget
from ...schemas.claim import ClaimDigestOut
from ...schemas.job import JobOut
from ...schemas.profile import ProfileOut
from ...schemas.resume import GenerateOptions, ResumeContent
from ..llm.base import BaseLLMProvider, LLMError
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
from .resume_generator_prompts import (
    _ENHANCEMENT_DISABLED_GUIDE,
    ENHANCEMENT_LEVEL_GUIDES,
    MAX_JD_CHARS,
    MAX_PROFILE_CHARS,
    build_layout_guide,
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
from .resume_rationale import build_generation_rationale
from .resume_wording import cliche_shortfalls, find_cliches

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
            autoescape=False,
        )
        # 多段用量汇总（审计 PR-07-6）：主生成 / 格式修复 / 质量重试各段结束后各补
        # 一次 provider.last_usage（失败与取消轮次同样收集，能拿到多少算多少）。
        self.usage_records: list[LLMUsage] = []
        # 整链总预算（generate 时按值记录）：段结束后恢复注入，主生成流的硬墙钟
        # 在余下的调用里继续生效。
        self._total_budget: OperationBudget | None = None

    def _record_call_usage(self) -> None:
        """把 provider 刚结束的这一次调用用量补进本链汇总（PR-07-6）。

        provider 只保留 ``last_usage``（跨轮累计是调用方责任）；在每段的
        finally 里调用——失败与取消轮次同样能拿到多少算多少。测试假 Provider
        可能不写甚至没有该属性，用 getattr 容忍缺失。
        """
        usage = getattr(self.provider, "last_usage", None)
        if usage is not None:
            self.usage_records.append(usage)

    async def generate(
        self,
        profile: ProfileOut,
        job: JobOut | None,
        options: GenerateOptions,
        *,
        baseline: ClaimDigestOut | None = None,
        budget: OperationBudget | None = None,
    ) -> AsyncIterator[dict]:
        """执行生成流程，依次产出进度、增量、完成或错误事件。

        ``job is None`` 表示**通用简历**：不针对任何岗位，候选资料是完整资料库，
        筛选层换成 ``build_general_profile_context``（见那里的说明——不能靠"传空岗位"
        让岗位路径自己退化，那条路径会丢掉校园经历、奖项、技能与总结）。

        ``baseline`` 是事实台账已确认的条目。**不传、或台账为空时渲染出的提示词与
        以前逐字节相同**——没启用台账的用户不该因为这次改动而拿到不一样的简历。

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
        enhancement_guide = (
            ENHANCEMENT_LEVEL_GUIDES[options.enhancement_level]
            if options.enhance
            else _ENHANCEMENT_DISABLED_GUIDE
        )

        yield {
            "type": "progress",
            "message": "正在整理完整资料…" if general else "正在分析岗位要求与资料匹配度…",
        }
        selection = (
            build_general_profile_context(
                profile, max_chars=MAX_PROFILE_CHARS, include_references=options.enhance
            )
            if general
            else build_targeted_profile_context(
                profile,
                job,
                max_chars=MAX_PROFILE_CHARS,
                include_references=options.enhance,
            )
        )
        counts = selection.selected_counts
        reference_count = sum(
            1
            for section in ("educations", "experiences", "campus_experiences", "projects")
            for item in selection.data.get(section, [])
            if item.get("reference_facts") or item.get("reference_excerpt")
        )
        if general:
            reference_message = (
                f"；已从 {reference_count} 份总结文件中提取可用事实"
                if options.enhance and reference_count
                else ""
            )
            yield {
                "type": "progress",
                "message": (
                    "已整理 "
                    f"{counts['experiences']} 段实习/工作、{counts['projects']} 个项目、"
                    f"{counts['campus_experiences']} 段校园经历和 {counts['skills']} 项技能"
                    f"{reference_message}"
                ),
            }
        else:
            reference_message = (
                f"；已提取 {reference_count} 份总结文件中的岗位相关事实"
                if options.enhance and reference_count
                else ""
            )
            yield {
                "type": "progress",
                "message": (
                    "已从完整资料中筛选 "
                    f"{counts['experiences']} 段实习/工作、{counts['projects']} 个项目、"
                    f"{counts['campus_experiences']} 段校园经历和 {counts['skills']} 项技能"
                    f"{reference_message}"
                ),
            }
        # 渲染会吃掉模板文件末尾的换行；补回来，让岗位模式的系统提示与改动前逐字节一致。
        system_prompt = self._env.get_template("resume_generate_system.md").render(job=job) + "\n"
        user_prompt = self._env.get_template("resume_generate_user.md").render(
            profile_json=selection.serialized,
            job=job,
            jd=build_job_prompt_text(job, MAX_JD_CHARS) if job else "",
            enhancement_guide=enhancement_guide,
            enhancement_enabled=options.enhance,
            focus_skills="、".join(selection.focus.skills) or "未识别到明确技能，请以 JD 原文为准",
            focus_domains="、".join(selection.focus.domains) or "通用岗位",
            omitted_count=sum(selection.omitted_counts.values()),
            layout_guide=build_layout_guide(options.page_limit, options.font_scale),
            custom_instruction=options.custom_instruction.strip(),
            # 台账为空时传空串，模板里的 {% if claim_baseline %} 整块不渲染。
            claim_baseline=baseline.baseline_text if baseline else "",
            blocked_wording=baseline.blocked_wording if baseline else [],
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        if budget is not None:
            # 流开始前的预算检查（§2.1.a-2）：防御"上一段耗尽后才进流"。
            budget.raise_if_stopped()
            # 整链硬墙钟接线（审计 PR-07-3）：主生成流没有 child，但 provider 的每次
            # 传输尝试都以总预算剩余做 asyncio.timeout 上限——首字前静默、只发心跳
            # 的流同样会被硬切（此前只有 runner 的逐事件检查，事件之间是盲区）。
            self._total_budget = budget
            self.provider.request_budget = budget
        # token 估算遥测（RF-14 §2.5）：默认关。开启时把估算写进 done 事件
        # （estimated_* 命名），由 runner 并进用量结构化日志——它不改请求体，
        # 也不作为截断依据（按 token 截断属 RF-13/RF-17 的产品决策，本批明确不做）。
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
            self._record_call_usage()

        raw = "".join(parts)
        resume = self._parse(raw)

        # 输出不是合法 JSON：用修复 Prompt 重试一次，仍然失败则降级报错。
        if resume is None:
            yield {"type": "progress", "message": "输出格式不符合要求，正在自动修复…"}
            fix_prompt = self._env.get_template("resume_fix_json.md").render(raw=raw[:6000])
            # 格式修复段取 child 预算（§2.1.a）：它是事件之间的完整 provider.chat，
            # runner 的事件检查对进行中的调用不可见。child 剩余经 provider 的
            # request_deadline_seconds 压缩该段 read timeout；调用后 finally 复位。
            segment = budget.child() if budget is not None else None
            if segment is not None:
                segment.raise_if_stopped()
            try:
                self._begin_segment(segment)
                fixed = await self.provider.chat(
                    [{"role": "user", "content": fix_prompt}], thinking=False
                )
            except LLMError as exc:
                if budget is not None and budget.is_expired():
                    # 预算耗尽不得伪装成网络超时（§2.1.a-3）：与 runner 的预算语义一致。
                    yield {"type": "error", "message": "生成超出时间预算，已终止"}
                    return
                yield {"type": "error", "message": f"自动修复调用失败：{exc}"}
                return
            finally:
                self._end_segment()
                # 修复段的用量（含失败轮次）也进汇总（PR-07-6）。
                self._record_call_usage()
            resume = self._parse(fixed)

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
            reference_facts = [
                {
                    "name": _source_value(source, "name"),
                    "facts": _quality_reference_points(source),
                }
                for source in selection.data.get("projects", [])
                if _quality_reference_points(source)
            ]
            retry_prompt = self._env.get_template("resume_quality_retry.md").render(
                shortfalls="\n".join(
                    f"- {item}" for item in [*content_shortfalls, *wording_shortfalls]
                ),
                reference_facts=json.dumps(reference_facts, ensure_ascii=False),
            )
            retry_messages = [*messages, {"role": "user", "content": retry_prompt}]
            retry_resume: ResumeContent | None = None
            # 质量重试段同取 child（§2.1.a-2）；重试失败沿用首轮结果（现状语义保留，
            # 不因预算改变——预算耗尽由 runner 的下一个事件检查兜底）。
            segment = budget.child() if budget is not None else None
            if segment is not None:
                segment.raise_if_stopped()
            try:
                self._begin_segment(segment)
                retry_raw = await self.provider.chat(retry_messages)
                retry_resume = self._parse(retry_raw)
            except Exception as exc:  # noqa: BLE001 - 质量重试失败应保留首轮结果
                logger.warning("简历质量重试失败，将沿用首轮结果：%s", exc)
            finally:
                self._end_segment()
                # 重试段的用量（含失败轮次）也进汇总（PR-07-6）。
                self._record_call_usage()

            retry_content_shortfalls = (
                _quality_shortfalls(retry_resume, selection.data, job)
                if retry_resume is not None and quality_enabled
                else []
            )
            retry_wording_shortfalls = (
                cliche_shortfalls(retry_resume)
                if retry_resume is not None and wording_enabled
                else []
            )
            if (
                retry_resume is not None
                and not retry_content_shortfalls
                and not retry_wording_shortfalls
            ):
                resume = retry_resume

        warnings = check_consistency(
            resume, profile, selection.data, source_label="完整资料" if general else None
        )
        if wording_enabled:
            # 重试用过之后仍然命中（或重试失败沿用首轮）时如实告知，不静默留下黑话。
            remaining_cliches = find_cliches(resume)
            if remaining_cliches:
                warnings.append(
                    "生成结果里仍有空话或黑话（"
                    + "、".join(remaining_cliches)
                    + "）：可以在「手动调整」里改掉，或重新生成一次。"
                )
        if general:
            omitted_total = sum(selection.omitted_counts.values())
            if omitted_total:
                # 措辞要同时成立于两种丢弃来源：栏目上限与序列化时的预算压缩，
                # 代码目前分不出是哪一种，所以只说"超出篇幅预算"。
                warnings.append(
                    f"这是通用简历（不按岗位筛选）：完整资料中有 {omitted_total} 条内容"
                    "超出单份简历的篇幅预算，已按资料顺序优先保留靠前的条目；"
                    "需要补充的内容可以在「手动调整」里手动加上。"
                )
        # 锚定（RF-13）：标注是锚定过程的副产品（纯收集，不调模型），随 done 事件
        # 带给调用方落库，让前端能说明"这段内容是从哪条资料事实来的"。
        resume, fact_annotations = ground_resume_facts_with_annotations(
            resume,
            profile,
            job,
            selection.data,
            enhance=options.enhance,
            enhancement_level=options.enhancement_level,
        )
        resume = resume.model_copy(update={"photo": profile.photo})
        resume = restore_selected_sections(
            resume,
            selection.data,
            enhance=options.enhance,
            enhancement_level=options.enhancement_level,
        )
        # 覆盖度检查放在**所有**修复/回填之后：它比对的必须是用户最终看到的那份内容，
        # 否则"资料里有 X、简历里没有 X"可能只是中间状态的假象。
        #
        # "没写进简历"是岗位导向筛选的正常结果，与"疑似虚构"性质完全不同——所以它
        # **不再混进 warnings**（那面红墙），而是作为结构化的 coverage_notes 单独
        # 落库，前端用中性分组展示并配处理按钮。
        coverage_details = find_unwritten_details(resume, selection.entry_names, selection.data)
        confirmed_names = confirmed_claims_about(all_entry_names(selection.entry_names), baseline)
        rationale = build_generation_rationale(
            job=job,
            selection_counts=selection.selected_counts,
            omitted_counts=selection.omitted_counts,
            focus_skills=selection.focus.skills,
            focus_domains=selection.focus.domains,
            coverage_details=coverage_details,
            baseline_confirmed=confirmed_names,
        )
        done_event = {
            "type": "done",
            "resume": resume.model_dump(),
            "warnings": warnings,
            "coverage_notes": coverage_details,
            "rationale": rationale,
            "fact_annotations": fact_annotations,
        }
        if estimated_prompt_tokens is not None:
            # 遥测字段只占位在估算开启时（§2.5-2）；runner 把它并进用量结构化日志。
            done_event["estimated_prompt_tokens"] = estimated_prompt_tokens
        yield done_event

    # ===== 预算分段（RF-14 §2.1.c）=====

    def _begin_segment(self, segment: OperationBudget | None) -> None:
        """把 child 段的剩余注入 provider 的请求级 deadline。

        静态 ``request_deadline_seconds`` 压缩该段 read timeout（deadline 只能收紧，
        provider 的 ``_timeout`` 取 ``min(配置值, 本值)`` 并夹正）；活预算
        ``request_budget`` 注入 child 段本身——provider 的每次传输尝试/重试决策用
        ``remaining()`` 重算剩余，退避与硬墙钟都随时间递减（PR-07-1/2）。provider
        实例不复用，这里设置后由调用方在 ``finally`` 里 ``_end_segment`` 复位——
        复位是防御性纪律，不是正确性依赖。
        """
        if segment is not None:
            self.provider.request_deadline_seconds = segment.remaining()
            self.provider.request_budget = segment

    def _end_segment(self) -> None:
        self.provider.request_deadline_seconds = None
        # 恢复整链总预算（主生成流的硬墙钟继续生效）；budget=None 的旧路径保持 None。
        self.provider.request_budget = self._total_budget

    def _parse(self, raw: str) -> ResumeContent | None:
        data = extract_json(raw)
        return coerce_resume(data) if data is not None else None


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

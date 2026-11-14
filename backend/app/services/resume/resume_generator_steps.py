# SPDX-License-Identifier: Apache-2.0
"""ResumeGenerator.generate 的五步流水线（从 resume_generator 拆出的行数预算产物）。

generate 只保留「建 GenerationContext → 顺序调用五步 → 返回事件流」；本模块按原
generate 的行为边界拆成五步：

1. _step_collect_inputs：取数与校验 —— 美化档位 temperature、候选构造、进度事件、
   提示词渲染、输出语言、整链预算接线与 token 估算；
2. _step_stream_model_output：渲染 —— 模型流式输出、增量事件、JSON 解析与格式修复
   （本步持有 provider 流的关闭责任，generate 用 aclosing 迭代它）；
3. _step_quality_and_space_retry：质量重试与篇幅重试 —— 含排版参数
   （page_limit / font_scale / language）的页数评估；
4. _step_postprocess_content：后处理 —— 一致性检查、grounding、扩展栏目回填、
   自建分区、语言补位与诊断警告定稿；
5. _step_emit_done：定稿 —— 确定性页面裁剪、覆盖度说明、rationale 与 done 事件。

**为什么每一步是异步生成器而不是纯函数**：原 generate 在步骤内部 yield 进度/增量/
错误事件，事件顺序是行为契约（runner 逐事件落库/发 SSE），纯函数无法在原时点产出
事件。步骤之间只通过 GenerationContext 传递中间量，不回读局部变量。
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypeVar

from ...runtime.operation_budget import OperationBudget
from ...schemas.claim import ClaimDigestOut
from ...schemas.job import JobOut
from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import GenerateOptions, ResumeContent
from ..llm.token_estimate import estimate_tokens
from .resume_consistency import check_consistency
from .resume_coverage import (
    all_entry_names,
    confirmed_claims_about,
    find_unwritten_details,
    find_unwritten_field_details,
)
from .resume_generation_helpers import record_call_usage, with_output_language
from .resume_generation_levels import apply_enhancement_temperature
from .resume_generator_prompts import (
    MAX_PROFILE_CHARS,
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
from .resume_grounding import _source_list, restore_selected_sections
from .resume_quality import _quality_shortfalls
from .resume_warnings import finalize_generation_warnings
from .resume_wording import cliche_shortfalls

if TYPE_CHECKING:
    from .resume_generator import ResumeGenerator

_T = TypeVar("_T")


def _require(value: _T | None, name: str) -> _T:
    """取步骤间不变式字段：进入某步前上游步骤必须已填好，None 只可能是编排错误。

    正常流水线不会走到；错误消息只进异常、不作为 SSE 用户文案。失败路径由
    ``tests/test_resume_generate_steps.py`` 直接覆盖（不是不可达分支）。
    """
    if value is None:  # 不变式：上游步骤已产出该状态
        raise RuntimeError(f"生成步骤状态缺失：{name}")
    return value


@dataclass
class GenerationContext:
    """一次 generate 调用的输入 + 跨步骤中间量。

    字段与原 generate 的局部赋值一一对应（输入 → 候选/提示词 → 渲染结果 → 用量与
    后处理产物）。generator 就是正在执行的 ResumeGenerator：provider、jinja 环境、
    用量汇总列表与整链总预算都只挂在它上面（不复制状态，避免出现两处真源）。

    get_settings 由 generate 注入而不是本模块直接 import：既有测试把
    resume_generator.get_settings 作为 monkeypatch 落点（计划 §5.1），注入保持该
    补丁仍然有效。terminated 表示某一步已产出错误事件并要求 generate 提前返回。
    """

    generator: ResumeGenerator
    profile: ProfileOut | None
    job: JobOut | None
    options: GenerateOptions
    baseline: ClaimDigestOut | None
    budget: OperationBudget | None
    career_context_block: str
    fact_sections: dict[str, Any] | None
    consumed: ConsumedProfile | None
    get_settings: Callable[[], Any]
    # ===== 跨步骤中间量（原 generate 的局部赋值；按流水线顺序逐项填入）=====
    general: bool = False
    scoped: bool = False
    selection: Any = None
    selection_data: dict[str, Any] | None = None
    messages: list[dict[str, Any]] = field(default_factory=list)
    estimated_prompt_tokens: int | None = None
    resume: ResumeContent | None = None
    warnings: list[str] = field(default_factory=list)
    annotations: list[dict[str, Any]] = field(default_factory=list)
    terminated: bool = False


async def _step_collect_inputs(
    ctx: GenerationContext,
) -> AsyncGenerator[dict[str, Any], None]:
    """取数与校验：候选构造、提示词、输出语言、整链预算接线与 token 估算。"""
    generator = ctx.generator
    general = ctx.job is None
    ctx.general = general
    # #33：美化档位也决定本次生成的 temperature（轻档收紧 / 深档放开）；
    # 关闭美化时不改配置，请求体与改动前逐一字节一致。
    apply_enhancement_temperature(generator.provider, ctx.options)
    yield {
        "type": "progress",
        "message": "正在整理完整资料…" if general else "正在分析岗位要求与资料匹配度…",
    }
    # F3/R-28：consumed 非空即"冻结的当前组消费快照"路径——候选只含参与分区，
    # 且构造发生在任何评分/名额/预算之前。旧 ProfileOut 路径保留给既有调用方与
    # 三链外消费者，输出与改造前逐字节一致。
    scoped = ctx.consumed is not None
    ctx.scoped = scoped
    selection = build_profile_selection(
        consumed=ctx.consumed,
        profile=ctx.profile,
        job=ctx.job,
        general=general,
        options=ctx.options,
        fact_sections=ctx.fact_sections,
        max_chars=MAX_PROFILE_CHARS,
    )
    ctx.selection = selection
    selection_data = selection_data_for(selection)
    ctx.selection_data = selection_data
    for event in build_progress_events(
        general, selection, enhance=ctx.options.enhance, scoped=scoped
    ):
        yield event
    messages = render_generation_messages(
        generator._env,
        selection,
        ctx.job,
        ctx.options,
        baseline=ctx.baseline,
        career_context_block=ctx.career_context_block,
        general=general,
        scoped=scoped,
    )
    # 英文简历的正文必须用英文写：只看 resume.language，界面语言不参与判断。
    messages[0]["content"] = with_output_language(messages[0]["content"], ctx.options.language)
    ctx.messages = messages
    if ctx.budget is not None:
        # 流开始前检查预算（§2.1.a-2）；并把整链硬墙钟接给 provider（PR-07-3）。
        ctx.budget.raise_if_stopped()
        generator._total_budget = ctx.budget
        generator.provider.request_budget = ctx.budget
    # token 估算遥测（RF-14 §2.5）：默认关；只进 done 事件，不改请求体、不作截断依据。
    if ctx.get_settings().llm_token_estimate_enabled:
        ctx.estimated_prompt_tokens = sum(
            estimate_tokens(str(message.get("content") or "")) for message in messages
        )


async def _step_stream_model_output(
    ctx: GenerationContext,
) -> AsyncGenerator[dict[str, Any], None]:
    """渲染：模型流式输出 → 增量事件 → 原始输出解析 / 格式修复。"""
    generator = ctx.generator
    yield {
        "type": "progress",
        "message": f"正在调用模型 {generator.provider.config.model} 生成简历…",
    }
    parts: list[str] = []
    stream = generator.provider.stream_chat(ctx.messages)
    try:
        async for delta in stream:
            parts.append(delta)
            yield {"type": "delta", "text": delta}
    finally:
        # 取消/超时/异常路径也显式关闭 provider 流（aclosing 纪律，PR-07-4）：
        # GeneratorExit 逐层展开，provider 的 finally 才能写 last_usage、
        # response 才能及时关闭；随后补记本段用量（失败轮次也收集）。
        await stream.aclose()
        record_call_usage(generator.provider, generator.usage_records)

    raw = "".join(parts)
    resume = generator._parse(raw)

    # 输出不是合法 JSON：用修复 Prompt 重试一次，仍然失败则降级报错。
    if resume is None:
        yield {"type": "progress", "message": "输出格式不符合要求，正在自动修复…"}
        resume, repair_error = await repair_resume_json(
            env=generator._env,
            provider=generator.provider,
            raw=raw,
            budget=ctx.budget,
            total_budget=generator._total_budget,
            usage_records=generator.usage_records,
        )
        if repair_error is not None:
            yield {"type": "error", "message": repair_error}
            ctx.terminated = True
            return

    if resume is None:
        yield {"type": "error", "message": "模型输出未能解析为有效 JSON，请更换模型或重试"}
        ctx.terminated = True
        return
    ctx.resume = resume


async def _step_quality_and_space_retry(
    ctx: GenerationContext,
) -> AsyncGenerator[dict[str, Any], None]:
    """质量重试与篇幅重试：含排版参数（页数/字号/语言）的页数评估。"""
    generator = ctx.generator
    resume = _require(ctx.resume, "resume")
    selection_data = _require(ctx.selection_data, "selection_data")
    # strong 美化且带附件事实时，先检查模型是否真正完成了岗位化改写。
    has_reference_facts = any(
        _source_list(item, "reference_facts")
        for section in ("educations", "experiences", "campus_experiences", "projects")
        for item in ctx.selection.data.get(section, [])
    )
    quality_enabled = (
        ctx.options.enhance and ctx.options.enhancement_level == "strong" and has_reference_facts
    )
    content_shortfalls = (
        _quality_shortfalls(resume, ctx.selection.data, ctx.job) if quality_enabled else []
    )
    # 措辞门槛与美化档位无关，但只在允许改写时生效：关闭美化时正文是用户资料原文。
    wording_enabled = ctx.options.enhance
    wording_shortfalls = cliche_shortfalls(resume) if wording_enabled else []
    # #34：核心板块缺口并入同一次重试（不多打一次模型调用）；没有其它 shortfall
    # 时不单独为它重试——落库前的覆盖警告足以告知。
    from .resume_space_gate import coverage_gaps as _coverage_gaps

    gap_texts = _coverage_gaps(resume.model_dump()) if ctx.options.enhance else []
    retry_shortfalls = [*content_shortfalls, *wording_shortfalls]
    if gap_texts and retry_shortfalls:
        retry_shortfalls.append(
            "补上缺失的核心板块（只用候选资料里的事实，没有依据的除外）：" + "、".join(gap_texts)
        )
    if retry_shortfalls:
        yield {
            "type": "progress",
            "message": "生成内容较简略，正在重新生成…"
            if content_shortfalls
            else "生成结果里有空话或套话，正在改写…",
        }
        retry_resume = await run_quality_retry(
            env=generator._env,
            provider=generator.provider,
            messages=ctx.messages,
            selection_data=selection_data,
            shortfalls=retry_shortfalls,
            job=ctx.job,
            options=ctx.options,
            budget=ctx.budget,
            total_budget=generator._total_budget,
            usage_records=generator.usage_records,
        )
        if retry_resume is not None:
            resume = retry_resume
        quality_retry_ran = True
    else:
        quality_retry_ran = False

    # #23/#34：篇幅的**模型重试**只在没有其它重试时发起（避免一次生成叠三次调用；
    # 质量重试已跑过时，超页由定稿后的确定性裁剪兜底）。页数按真实渲染量。
    from .resume_space_gate import page_overage, run_space_retry

    overage = page_overage(
        resume,
        page_limit=ctx.options.page_limit,
        font_scale=ctx.options.font_scale,
        language=ctx.options.language or "zh-CN",
    )
    # 预算已耗尽时不再发起篇幅重试（重试是真实模型调用，逃出预算=白烧钱）。
    budget_alive = ctx.budget is None or not ctx.budget.is_expired()
    if overage > 0 and not quality_retry_ran and budget_alive:
        yield {
            "type": "progress",
            "message": "生成结果超出篇幅上限，正在压缩…",
        }
        space_resume = await run_space_retry(
            provider=generator.provider,
            messages=ctx.messages,
            resume=resume.model_dump(),
            overage=overage,
            page_limit=ctx.options.page_limit,
            coverage_gap_texts=gap_texts,
            usage_records=generator.usage_records,
            budget=ctx.budget,
            total_budget=generator._total_budget,
        )
        # 重试结果必须重新过一致性门槛：套话/黑话不因篇幅重试而放行。
        if space_resume is not None and not (wording_enabled and cliche_shortfalls(space_resume)):
            resume = space_resume
    ctx.resume = resume


async def _step_postprocess_content(
    ctx: GenerationContext,
) -> AsyncGenerator[dict[str, Any], None]:
    """后处理：一致性检查 + grounding/回填/语言补位 + 诊断警告定稿。"""
    resume = _require(ctx.resume, "resume")
    selection_data = _require(ctx.selection_data, "selection_data")
    if ctx.scoped:
        consumed = _require(ctx.consumed, "consumed")
        # 一致性/覆盖度/说明都只读本次消费快照（R-30：不出现未参与分区）。
        warnings = check_consistency(
            resume,
            consumed,
            selection_data,
            source_label="完整资料" if ctx.general else None,
        )
    else:
        # legacy 路径必须持有 ProfileOut：build_profile_selection 在 profile 与
        # consumed 双空时已抛 ValueError，走到这里 profile 一定非 None。
        assert ctx.profile is not None
        warnings = check_consistency(
            resume,
            ctx.profile,
            ctx.selection.data,
            source_label="完整资料" if ctx.general else None,
        )
    previous_resume = resume  # grounding 前快照：警告文案要按"删了什么"改写（问题 4）
    # 后处理顺序（F3 §3 / store-owner 定稿）：grounding → 扩展栏目回填 → C5-B →
    # C2 自建分区 → R-73 语言补位 → 诊断 → done。
    if ctx.scoped:
        consumed = _require(ctx.consumed, "consumed")
        from .generation_postprocess import (
            apply_profile_field_backfill,
            attach_custom_sections,
            ensure_custom_field_lines_in_resume,
            merge_missing_consumed_fields,
            normalize_generated_content,
        )
        from .grounding_entries import (
            ground_resume_facts_with_annotations as ground_consumed_facts,
        )
        from .language_restore import LanguageCapacityError, restore_languages

        resume, fact_annotations = ground_consumed_facts(
            resume,
            consumed,
            ctx.job,
            selection_data,
            enhance=ctx.options.enhance,
            enhancement_level=ctx.options.enhancement_level,
        )
        # 扩展栏目（论文/科研/知识产权/证书）的整段回填仍由旧实现负责：
        # 新 grounding 只做旧六分区 + 身份/summary（store-owner 的定稿边界）。
        resume = restore_selected_sections(
            resume,
            selection_data["data"],
            enhance=ctx.options.enhance,
            enhancement_level=ctx.options.enhancement_level,
        )
        # 计划 §8.2「按 key 合并/补值」在本批的实现：模型没写全的自定义字段在 v1
        # 中间态补回承载区「标签：值」行（保证资料里的非空字段不因模型漏写而丢失），
        # 自建分区确定性追加；落库前由 converter 按 custom_fields hints 把这些行/
        # 分区解析成 v2 的 item / 自建 section。
        resume, custom_field_annotations = ensure_custom_field_lines_in_resume(resume, consumed)
        resume = attach_custom_sections(resume, consumed, ctx.selection.focus, selection_data)
        # F8（R-81）：资料有值、结果槽位空 → 确定性回填；不改 AI 已写值、不阻断保存。
        resume = apply_profile_field_backfill(resume, consumed)
        # R1-G：条目内被模型写空的字段（tech_stack / 技能水平等）按 key 合并回来。
        resume = merge_missing_consumed_fields(resume, consumed, selection_data)
        try:
            resume, language_annotations = restore_languages(resume, consumed)
        except LanguageCapacityError as exc:
            # C14：技能 + 语言合并超过 200 条是结构化超限，不静默截断。
            yield {"type": "error", "message": exc.detail}
            ctx.terminated = True
            return
        # R1-A/R1-B：正文行保序去重 + 剥掉行首 markdown 列表前缀（含自建分区文本）。
        resume = normalize_generated_content(resume)
        resume = resume.model_copy(update={"photo": consumed_photo(consumed)})
        annotations = [
            *fact_annotations,
            *custom_field_annotations,
            *language_annotations,
        ]
    else:
        # 旧链路：ProfileOut + 旧 grounding 语义（三链外调用方与既有测试依赖）。
        resume, annotation_items = legacy_postprocess_resume(
            resume, ctx.profile, ctx.job, selection_data, ctx.options
        )
        annotations = annotation_items
    warnings = finalize_generation_warnings(
        warnings,
        previous_resume,
        resume,
        selection_data,
        ctx.options,
        general=ctx.general,
    )
    ctx.resume = resume
    ctx.warnings = warnings
    ctx.annotations = annotations


async def _step_emit_done(
    ctx: GenerationContext,
) -> AsyncGenerator[dict[str, Any], None]:
    """定稿：确定性页面裁剪、覆盖度说明、rationale 与 done 事件。"""
    resume = _require(ctx.resume, "resume")
    selection_data = _require(ctx.selection_data, "selection_data")
    # #23 后半段 + #34 可观测：内容定稿后的确定性裁剪与如实警告（下沉到
    # resume_space_gate.finalize_page_budget——生成器守 500 行预算，也便于单测）。
    # 自定义字段回填行（C5-B "标签：值"）不参与篇幅裁剪：它们是确定性回填的用户数据。
    from .resume_space_gate import finalize_page_budget

    protected = frozenset(
        line.strip()
        for annotation in ctx.annotations
        if annotation.get("origin") == "restored"
        for line in str(annotation.get("source_fact") or "").split("；")
        if line.strip()
    )
    resume = finalize_page_budget(
        resume,
        ctx.warnings,
        page_limit=ctx.options.page_limit,
        font_scale=ctx.options.font_scale,
        language=ctx.options.language or "zh-CN",
        protected_lines=protected,
    )
    # 覆盖度检查必须在所有修复/回填之后（比对用户最终看到的内容）；它是中性的
    # coverage_notes，不混进"疑似虚构"的 warnings 红墙。
    if ctx.scoped:
        consumed = _require(ctx.consumed, "consumed")
        coverage_details = [
            *find_unwritten_details(resume, consumed, selection_data),
            # R1-G：条目内字段/技能/总结层面的遗漏也要如实记录（不是只说整条）。
            # 传本次候选快照：技能名额裁掉的不能记成"模型没写"。
            *find_unwritten_field_details(resume, consumed, selection_data),
        ]
    else:
        coverage_details = find_unwritten_details(
            resume, ctx.selection.entry_names, ctx.selection.data
        )
    confirmed_names = confirmed_claims_about(
        all_entry_names(ctx.selection.entry_names), ctx.baseline
    )
    rationale = build_rationale(
        ctx.job, ctx.selection, selection_data, coverage_details, confirmed_names
    )
    done_event = {
        "type": "done",
        "resume": resume.model_dump(),
        "warnings": ctx.warnings,
        "coverage_notes": coverage_details,
        "rationale": rationale,
        "fact_annotations": ctx.annotations,
    }
    if ctx.estimated_prompt_tokens is not None:
        # 遥测字段只占位在估算开启时（§2.5-2）；runner 把它并进用量结构化日志。
        done_event["estimated_prompt_tokens"] = ctx.estimated_prompt_tokens
    yield done_event

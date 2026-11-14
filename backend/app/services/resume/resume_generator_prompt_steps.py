# SPDX-License-Identifier: Apache-2.0
"""简历生成提示词之后的模型交互步骤（从 app.services.resume.resume_generator_prompts 纯搬迁拆出）。

本模块只装"拿到提示词之后"的步骤：质量重试提示词与调用、JSON 格式修复、旧 ProfileOut
路径的后处理、生成告警、候选构造与生成说明。提示词常量与渲染（系统/用户消息、进度文案）
留在 resume_generator_prompts；该模块对本模块做 re-export，消费方旧 import 路径不变。
"""

import json
import logging
from typing import Any

from ...schemas.resume import ResumeContent
from ..profile.profile_relevance import (
    build_general_consumed_profile_context,
    build_general_profile_context,
    build_targeted_consumed_profile_context,
    build_targeted_profile_context,
)
from .resume_quality import _quality_reference_points
from .resume_rationale import build_generation_rationale


def build_quality_retry_prompt(env: Any, resume_data: dict[str, Any], shortfalls: list[str]) -> str:
    """质量重试提示词；新旧路径同一实现。"""
    reference_facts = [
        {
            "name": str(source.get("name") or ""),
            "facts": _quality_reference_points(source),
        }
        for source in resume_data.get("projects", [])
        if _quality_reference_points(source)
    ]
    return env.get_template("resume_quality_retry.md").render(
        shortfalls="\n".join(f"- {item}" for item in shortfalls),
        reference_facts=json.dumps(reference_facts, ensure_ascii=False),
    )


async def repair_resume_json(
    *,
    env: Any,
    provider: Any,
    raw: str,
    budget: Any,
    total_budget: Any,
    usage_records: list[Any],
) -> tuple[ResumeContent | None, str | None]:
    """格式修复段（F3 拆分产物）：返回 (解析后的简历, 错误文案)；错误文案非空即终止。

    两个元素都可能为 None：错误文案非空时简历一定是 None（调用方据此直接报错）。
    """
    from ..llm.base import LLMError
    from .resume_generation_helpers import (
        begin_budget_segment,
        end_budget_segment,
        parse_resume,
        record_call_usage,
    )

    fix_prompt = env.get_template("resume_fix_json.md").render(raw=raw[:6000])
    segment = budget.child() if budget is not None else None
    if segment is not None:
        segment.raise_if_stopped()
    try:
        begin_budget_segment(provider, segment)
        fixed = await provider.chat([{"role": "user", "content": fix_prompt}], thinking=False)
    except LLMError:
        if budget is not None and budget.is_expired():
            # 预算耗尽不得伪装成网络超时（§2.1.a-3）。
            return None, "生成超出时间预算，已终止"
        return None, "自动修复调用失败：模型服务暂时不可用，请稍后重试"
    finally:
        end_budget_segment(provider, total_budget)
        record_call_usage(provider, usage_records)
    return parse_resume(fixed), None


async def run_quality_retry(
    *,
    env: Any,
    provider: Any,
    messages: list[dict[str, str]],
    selection_data: dict[str, Any],
    shortfalls: list[str],
    job: Any,
    options: Any,
    budget: Any,
    total_budget: Any,
    usage_records: list[Any],
) -> ResumeContent | None:
    """质量重试段（F3 拆分产物）：返回通过门槛的重试结果；不通过返回 None 沿用首轮。"""
    from .resume_generation_helpers import (
        begin_budget_segment,
        end_budget_segment,
        parse_resume,
        record_call_usage,
    )
    from .resume_quality import _quality_shortfalls
    from .resume_wording import cliche_shortfalls

    retry_prompt = build_quality_retry_prompt(env, selection_data["data"], shortfalls)
    retry_messages = [*messages, {"role": "user", "content": retry_prompt}]
    segment = budget.child() if budget is not None else None
    if segment is not None:
        segment.raise_if_stopped()
    retry_resume = None
    try:
        begin_budget_segment(provider, segment)
        retry_raw = await provider.chat(retry_messages)
        retry_resume = parse_resume(retry_raw)
    except Exception as exc:  # noqa: BLE001 - 质量重试失败应保留首轮结果
        logging.getLogger(__name__).warning(
            "简历质量重试失败，将沿用首轮结果，异常类型=%s", type(exc).__name__
        )
    finally:
        end_budget_segment(provider, total_budget)
        record_call_usage(provider, usage_records)
    if retry_resume is None:
        return None
    quality_enabled = bool(
        options.enhance
        and options.enhancement_level == "strong"
        and any(
            item.get("reference_facts")
            for section in ("educations", "experiences", "campus_experiences", "projects")
            for item in selection_data["data"].get(section, [])
        )
    )
    if quality_enabled and _quality_shortfalls(retry_resume, selection_data["data"], job):
        return None
    if options.enhance and cliche_shortfalls(retry_resume):
        return None
    return retry_resume


def legacy_postprocess_resume(
    resume: Any,
    profile: Any,
    job: Any,
    selection_data: dict[str, Any],
    options: Any,
) -> tuple[Any, list[dict[str, Any]]]:
    """旧 ProfileOut 路径的后处理（F3 拆分产物）：grounding → 照片 → 扩展栏目回填。"""
    from .resume_grounding import (
        ground_resume_facts_with_annotations,
        restore_selected_sections,
    )

    resume, fact_annotations = ground_resume_facts_with_annotations(
        resume,
        profile,
        job,
        selection_data,
        enhance=options.enhance,
        enhancement_level=options.enhancement_level,
    )
    resume = resume.model_copy(update={"photo": profile.photo})
    resume = restore_selected_sections(
        resume,
        selection_data,
        enhance=options.enhance,
        enhancement_level=options.enhancement_level,
    )
    return resume, fact_annotations


def append_generation_warnings(
    warnings: list[str],
    resume: Any,
    selection_data: dict[str, Any],
    *,
    general: bool,
    wording_enabled: bool,
) -> list[str]:
    """套话残留与通用简历的篇幅提示（F3 拆分产物，行为与改造前一致）。"""
    from .resume_wording import find_cliches

    if wording_enabled:
        remaining_cliches = find_cliches(resume)
        if remaining_cliches:
            warnings.append(
                "生成结果里仍有空话或黑话（"
                + "、".join(remaining_cliches)
                + "）：可以在「手动调整」里改掉，或重新生成一次。"
            )
    if general:
        omitted_total = sum(selection_data["omitted_counts"].values())
        if omitted_total:
            warnings.append(
                f"这是通用简历（不按岗位筛选）：完整资料中有 {omitted_total} 条内容"
                "超出单份简历的篇幅预算，已按资料顺序优先保留靠前的条目；"
                "需要补充的内容可以在「手动调整」里手动加上。"
            )
    return warnings


def build_profile_selection(
    *,
    consumed: Any,
    profile: Any,
    job: Any,
    general: bool,
    options: Any,
    fact_sections: dict[str, Any] | None,
    max_chars: int,
) -> Any:
    """按入口选择候选构造器（F3 拆分产物）：consumed 非空只走消费层，绝不回落全量。"""
    if consumed is not None:
        return (
            build_general_consumed_profile_context(consumed, max_chars=max_chars)
            if general
            else build_targeted_consumed_profile_context(consumed, job, max_chars=max_chars)
        )
    if profile is None:
        raise ValueError("简历生成需要 profile 或 consumed 至少提供一个")
    active_facts = fact_sections if fact_sections and any(fact_sections.values()) else None
    if general:
        return build_general_profile_context(
            profile,
            max_chars=max_chars,
            include_references=options.enhance,
            fact_sections=active_facts,
        )
    return build_targeted_profile_context(
        profile,
        job,
        max_chars=max_chars,
        include_references=options.enhance,
        fact_sections=active_facts,
    )


def build_rationale(
    job: Any,
    selection: Any,
    selection_data: dict[str, Any],
    coverage_details: list[dict[str, Any]],
    baseline_confirmed: list[str],
) -> str:
    """生成说明（F3-B 定稿的 keyword 签名；旧路径传同样的值）。"""
    focus = selection_data["focus"]
    return build_generation_rationale(
        job=job,
        selection_counts=selection_data["selected_counts"],
        omitted_counts=selection_data["omitted_counts"],
        focus_skills=focus["skills"],
        focus_domains=focus["domains"],
        coverage_details=coverage_details,
        baseline_confirmed=baseline_confirmed,
        fallback_sections=selection_data["fallback_sections"],
        # 需求 6：开了「参与岗位筛选」的自建板块条数（没有时为空，旧输出逐字不变）。
        custom_sections=selection_data.get("custom_sections") or (),
    )

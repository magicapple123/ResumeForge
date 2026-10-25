# SPDX-License-Identifier: Apache-2.0
"""简历生成的提示词常量与篇幅引导（从 :mod:`app.services.resume.resume_generator` 纯搬迁拆出）。

只含提示词组装侧的常量与纯函数：用量汇总（``usage_records``）、预算接线与流式
主循环留在 ``resume_generator.py``——测试在该模块命名空间上 monkeypatch
（如 ``get_settings``），落点不能动。``resume_generator`` 对以下名字做 re-export，
既有消费方与 ``__all__`` 契约不变。
"""

import json
import logging
from typing import Any

from ..profile.profile_budget import build_job_prompt_text
from ..profile.profile_relevance import (
    build_general_consumed_profile_context,
    build_general_profile_context,
    build_targeted_consumed_profile_context,
    build_targeted_profile_context,
)
from .resume_generation_helpers import has_extended_facts
from .resume_quality import _quality_reference_points
from .resume_rationale import build_generation_rationale
from .resume_templates import font_scale_spec

# 控制总输入体积：先筛选资料，再为 JD 保留独立预算，避免超长资料/JD 挤掉彼此。
MAX_JD_CHARS = 5_000
MAX_PROFILE_CHARS = 9_000

# 三档只控制对描述性字段的改写幅度；结构化事实始终由代码强制锚定。
ENHANCEMENT_LEVEL_GUIDES = {
    "light": (
        "轻度美化：只优化语序、动词和专业表达，保持原有要点数量与职责边界；"
        "每条内容应能直接对应原资料或参考事实。原描述为空但存在 reference_facts 时，"
        "提炼 1-2 条最相关事实，不能继续留空。"
    ),
    "balanced": (
        "均衡美化：可围绕 JD 重组原有事实，补足动作、方法和业务目的，使表达更扎实；"
        "允许合并同一条目内的相关证据，但不得推导未明确提供的结果。含 reference_facts "
        "的相关条目在可用事实达到 2 条时，应将 description/highlights 合计写成 2-4 条。"
    ),
    "strong": (
        "深度美化：充分挖掘同一条目及 reference_facts/reference_excerpt 中的岗位相关证据，"
        "以专业简历语言展开技术决策、实施过程和价值，可以增加描述要点。存在至少 3 条 "
        "reference_facts 时，必须将 description/highlights 合计写成 3-5 条；不足 3 条时全部"
        "使用，不得为凑数虚构。每个事实都必须能追溯到该条目来源。"
    ),
}

_ENHANCEMENT_DISABLED_GUIDE = (
    "美化拓展已关闭：只能选择、排序并精确回填候选资料中的原文要点；"
    "不得合并、改写或扩充 description、highlights 和 summary。"
)

# 单页 A4 在不同字号下的汉字预算（含标题、联系方式等全部版面文字）。
# 数字是经验值，只用来给模型一个明确的篇幅目标，不参与任何校验。
_PAGE_CHAR_BUDGET = {
    "small": (850, 1100),
    "standard": (650, 880),
    "large": (550, 720),
}


def build_layout_guide(page_limit: int, font_scale: str) -> str:
    """把「页数 + 字号」翻译成模型可执行的篇幅要求。"""
    spec = font_scale_spec(font_scale)
    low, high = _PAGE_CHAR_BUDGET.get(spec["name"], _PAGE_CHAR_BUDGET["standard"])
    if page_limit <= 1:
        return (
            f"目标篇幅：1 页 A4、{spec['label']}。整份简历（含联系方式与全部文字）"
            f"控制在 {low}-{high} 个汉字以内：每段经历保留 2-3 条最相关的要点，"
            "每条要点 25-35 字，个人总结不超过 100 字。宁可少写，也不要为了完整而超出篇幅。"
        )
    total_low = low * page_limit
    total_high = high * page_limit
    return (
        f"目标篇幅：最多 {page_limit} 页 A4、{spec['label']}。整份简历控制在 "
        f"{total_low}-{total_high} 个汉字以内：优先写满第一页，确有必要再用第二页；"
        "不要为了填满页数而堆砌次要内容，也不要留下大半页空白。"
    )
# ===== F3：按当前组（消费快照）生成时的提示词补充 =====
#
# 旧路径（ProfileOut 全量候选）的提示词保持逐字节不变：以下补充文本只在生成链路
# 走 ConsumedProfile 时追加，旧请求/旧测试拿到的消息与改造前完全一致。

# 进度文案标签与量词（R-30：只描述本次参与分区，不硬索引固定六键）。
SECTION_PROGRESS_LABELS: dict[str, tuple[str, str]] = {
    "educations": ("教育经历", "段"),
    "experiences": ("实习/工作经历", "段"),
    "campus_experiences": ("校园经历", "段"),
    "projects": ("项目经历", "个"),
    "skills": ("技能", "项"),
    "awards": ("荣誉奖项", "项"),
    "publications": ("学术成果", "条"),
    "research_projects": ("科研项目", "项"),
    "patents": ("知识产权", "条"),
    "credentials": ("证书资质", "条"),
    "languages": ("语言能力", "条"),
}

_CONSUMED_SYSTEM_SUPPLEMENT = '''
## 本次资料模型（v3）的补充规则（与其他规则冲突时以本节为准）

1. 候选资料可能包含 13 个大字段：基本信息、教育经历、实习/工作经历、项目经历、专业技能、
   校园经历、荣誉奖项、个人总结/自我评价、学术成果、科研项目、知识产权、证书资质、语言能力。
   只描述候选资料里**实际出现的分区**：没有出现的分区不要猜、不要补造，也不要把内容写进
   其它分区。某个分区出现但数组为空，表示用户这次没有提供该分区的内容。
2. 自定义字段：候选条目里的 custom_fields 是用户自定义的小字段。必须逐条以「标签：值」的
   独立行追加到该条目的承载区文本末尾（项目描述 / 工作内容 / 经历描述 / 奖项说明 / 备注 /
   熟练度），**标签名必须逐字保留**，不得改写、不得合并进已有句子。仅素材分区（基本信息、
   知识产权）的 custom_fields 只作事实参考，不得写进任何输出字段。
3. 语言能力：候选资料里的 languages 单独给出。必须把它们映射为输出的 skills 条目：
   name=语言，level 按「水平/等级 · 证书 · 分数」的顺序取非空段、以 「 · 」连接
   （例如「CET-6 · 550」）；不得把取得时间写进 level；语言条目排在所有技能条目之后，
   不得遗漏。
4. 知识产权：候选 patents 里的 outcome_type / inventor_rank 只作素材，不要写进输出；
   论文 / 科研项目 / 专利 / 证书的输出结构严格沿用下方「扩展事实栏目」的结构。
5. 技能与语言合并后总数不能超过 200 条；装不下时如实减少条目，不要静默截断或用省略号糊弄。
'''

_CONSUMED_USER_SUPPLEMENT = "补充：候选资料只含当前组参与的大字段；分区未出现不代表用户没有该经历，不要编造。"

# 旧补充事实栏目的参考计数分区。
_REFERENCE_SECTIONS: tuple[str, ...] = (
    "educations",
    "experiences",
    "campus_experiences",
    "projects",
)


def consumed_photo(consumed: Any) -> str:
    """当前组基本信息的照片引用（data URL 或资源 id 原样透传；缺失就是空串）。"""
    basic = consumed.section("basic_info")
    if basic is None or not basic.entries:
        return ""
    return str(basic.entries[0].values.get("basic_info.photo", "") or "")


def selection_data_for(selection: Any) -> dict[str, Any]:
    """把 ProfileSelection 冻结成 F3-B 纯步骤共用的 dict 形状。"""
    return {
        "data": selection.data,
        "selected_counts": dict(selection.selected_counts),
        "omitted_counts": dict(selection.omitted_counts),
        "entry_names": {key: list(names) for key, names in selection.entry_names.items()},
        "focus": {
            "skills": list(selection.focus.skills),
            "domains": list(selection.focus.domains),
            "terms": list(selection.focus.terms),
        },
        "fallback_sections": list(selection.fallback_sections),
    }


def build_progress_events(
    general: bool,
    selection: Any,
    *,
    enhance: bool,
    scoped: bool,
) -> list[dict[str, Any]]:
    """第二段进度文案；旧路径逐字节沿用，新路径只列本次参与分区（R-30）。"""
    reference_count = sum(
        1
        for section in _REFERENCE_SECTIONS
        for item in selection.data.get(section, [])
        if item.get("reference_facts") or item.get("reference_excerpt")
    )
    if scoped:
        parts = [
            f"{label} {selection.selected_counts[section]} {unit}"
            for section, (label, unit) in SECTION_PROGRESS_LABELS.items()
            if selection.selected_counts.get(section)
        ]
        summary = "、".join(parts) if parts else "暂无可用条目"
        if general:
            suffix = (
                f"；已从 {reference_count} 份总结文件中提取可用事实"
                if enhance and reference_count
                else ""
            )
            message = f"已整理本次候选：{summary}{suffix}"
        else:
            suffix = (
                f"；已提取 {reference_count} 份总结文件中的岗位相关事实"
                if enhance and reference_count
                else ""
            )
            message = f"已从本次候选资料中筛选：{summary}{suffix}"
        return [{"type": "progress", "message": message}]
    counts = selection.selected_counts
    if general:
        reference_message = (
            f"；已从 {reference_count} 份总结文件中提取可用事实"
            if enhance and reference_count
            else ""
        )
        return [
            {
                "type": "progress",
                "message": (
                    "已整理 "
                    f"{counts['experiences']} 段实习/工作、{counts['projects']} 个项目、"
                    f"{counts['campus_experiences']} 段校园经历和 {counts['skills']} 项技能"
                    f"{reference_message}"
                ),
            }
        ]
    reference_message = (
        f"；已提取 {reference_count} 份总结文件中的岗位相关事实"
        if enhance and reference_count
        else ""
    )
    return [
        {
            "type": "progress",
            "message": (
                "已从完整资料中筛选 "
                f"{counts['experiences']} 段实习/工作、{counts['projects']} 个项目、"
                f"{counts['campus_experiences']} 段校园经历和 {counts['skills']} 项技能"
                f"{reference_message}"
            ),
        }
    ]


def render_generation_messages(
    env: Any,
    selection: Any,
    job: Any,
    options: Any,
    *,
    baseline: Any,
    career_context_block: str,
    general: bool,
    scoped: bool,
) -> list[dict[str, str]]:
    """渲染系统/用户提示词；scoped=True 时追加 v3（13 分区/语言/自定义字段）规则。"""
    system_prompt = env.get_template("resume_generate_system.md").render(job=job) + "\n"
    if scoped:
        system_prompt += _CONSUMED_SYSTEM_SUPPLEMENT
    user_prompt = env.get_template("resume_generate_user.md").render(
        profile_json=selection.serialized,
        job=job,
        jd=build_job_prompt_text(job, MAX_JD_CHARS) if job else "",
        enhancement_guide=(
            ENHANCEMENT_LEVEL_GUIDES[options.enhancement_level]
            if options.enhance
            else _ENHANCEMENT_DISABLED_GUIDE
        ),
        enhancement_enabled=options.enhance,
        focus_skills="、".join(selection.focus.skills) or "未识别到明确技能，请以 JD 原文为准",
        focus_domains="、".join(selection.focus.domains) or "通用岗位",
        omitted_count=sum(selection.omitted_counts.values()),
        layout_guide=build_layout_guide(options.page_limit, options.font_scale),
        custom_instruction=options.custom_instruction.strip(),
        claim_baseline=baseline.baseline_text if baseline else "",
        blocked_wording=baseline.blocked_wording if baseline else [],
        career_context_block=career_context_block.strip(),
        extended_facts=has_extended_facts(selection.data),
    )
    if scoped:
        user_prompt += _CONSUMED_USER_SUPPLEMENT
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


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
) -> tuple[Any, str | None]:
    """格式修复段（F3 拆分产物）：返回 (解析后的简历, 错误文案)；错误文案非空即终止。"""
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
        fixed = await provider.chat(
            [{"role": "user", "content": fix_prompt}], thinking=False
        )
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
) -> Any | None:
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
    if quality_enabled and _quality_shortfalls(
        retry_resume, selection_data["data"], job
    ):
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
    )
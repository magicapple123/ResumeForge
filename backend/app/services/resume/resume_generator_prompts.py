# SPDX-License-Identifier: Apache-2.0
"""简历生成的提示词常量与篇幅引导（从 :mod:`app.services.resume.resume_generator` 纯搬迁拆出）。

只含提示词组装侧的常量与纯函数：用量汇总（``usage_records``）、预算接线与流式
主循环留在 ``resume_generator.py``——测试在该模块命名空间上 monkeypatch
（如 ``get_settings``），落点不能动。``resume_generator`` 对以下名字做 re-export，
既有消费方与 ``__all__`` 契约不变。
"""

from typing import Any

from ..profile.profile_budget import build_job_prompt_text
from .resume_generation_helpers import has_extended_facts

# 控制总输入体积：先筛选资料，再为 JD 保留独立预算，避免超长资料/JD 挤掉彼此。
MAX_JD_CHARS = 5_000
MAX_PROFILE_CHARS = 9_000

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
2. 自定义字段：候选条目里的 custom_fields 是用户自定义的小字段。与目标岗位或简历主线
   **相关**的自定义字段，以「标签：值」的独立行追加到该条目的承载区文本末尾（项目描述 /
   工作内容 / 经历描述 / 奖项说明 / 备注 / 熟练度），标签名必须逐字保留，不得改写、
   不得合并进已有句子；与主线无关的自定义字段可以省略（#23：干扰文本不自动入稿）。
   仅素材分区（基本信息、知识产权）的 custom_fields 只作事实参考，不得写进任何输出字段。
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

# 输出 JSON 键 ← 候选数据键：两套名字不同（education / educations），映射只此一份。
# 提示词要不要输出某个分区，判据与 check_consistency **完全一致**：候选数据里出现了这个键
# （未参与分区整键不出现，R-29）。旧 ProfileOut 路径的候选始终含全部六键，所以旧请求拿到的
# 提示词与改造前一致；只有"按当前组生成"时才会真的少掉未参与分区（问题 4 的源头修复）。
_OUTPUT_SECTION_SOURCES: dict[str, str] = {
    "education": "educations",
    "experience": "experiences",
    "campus_experience": "campus_experiences",
    "projects": "projects",
    "skills": "skills",
    "awards": "awards",
}


def output_section_keys(candidate_data: Any) -> frozenset[str]:
    """本次让模型输出的内置分区键（模板据此条件渲染 JSON 结构）。"""
    data = candidate_data if isinstance(candidate_data, dict) else {}
    return frozenset(out for out, source in _OUTPUT_SECTION_SOURCES.items() if source in data)


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
    system_prompt = (
        env.get_template("resume_generate_system.md").render(
            job=job,
            # #33：字数/条数上限随档位变化（写死会与深度档的展开指令互相抵消）。
            point_rules=ENHANCEMENT_POINT_RULES.get(
                options.enhancement_level, ENHANCEMENT_POINT_RULES["balanced"]
            ),
        )
        + "\n"
    )
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
        layout_guide=build_layout_guide(
            options.page_limit, options.font_scale, options.enhancement_level
        ),
        point_rules=ENHANCEMENT_POINT_RULES.get(
            options.enhancement_level, ENHANCEMENT_POINT_RULES["balanced"]
        ),
        custom_instruction=options.custom_instruction.strip(),
        # 三个变量分开判断（§20 D2）：没有已确认基线时 blocked_wording 仍必须渲染。
        claim_baseline=baseline.baseline_text if baseline else "",
        blocked_wording=baseline.blocked_wording if baseline else [],
        covered_entries=baseline.covered_entries if baseline else [],
        career_context_block=career_context_block.strip(),
        extended_facts=has_extended_facts(selection.data),
        resume_sections=output_section_keys(selection.data),
    )
    if scoped:
        user_prompt += _CONSUMED_USER_SUPPLEMENT
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


# 拆分后的 re-export（resume_generator / 测试的旧 import 路径不断）。
from .resume_generation_levels import (  # noqa: E402,F401
    _ENHANCEMENT_DISABLED_GUIDE,
    _PAGE_CHAR_BUDGET,
    ENHANCEMENT_LEVEL_GUIDES,
    ENHANCEMENT_POINT_RULES,
    build_layout_guide,
)

# 拆分后的 re-export（resume_generator_steps / 测试的旧 import 路径不断）。
from .resume_generator_prompt_steps import (  # noqa: E402,F401
    append_generation_warnings,
    build_profile_selection,
    build_quality_retry_prompt,
    build_rationale,
    legacy_postprocess_resume,
    repair_resume_json,
    run_quality_retry,
)

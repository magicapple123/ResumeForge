# SPDX-License-Identifier: Apache-2.0
"""生成说明：用确定性的筛选/覆盖度数据回答"为什么是这样一份简历"。

用户对生成结果的疑惑集中在两类：
- "我的某个项目怎么没写进去？"——那是岗位导向筛选或模型取舍的结果，此前只有一条
  混在"疑似虚构"红墙里的文字警告；
- "为什么选了这些内容？"——候选资料的组成从来只存在于日志里，用户看不见。

这个模块把两者变成**生成时一次性算好的结构化数据**：

- :func:`build_generation_rationale` 拼一段用户可读的说明文本（数据来源概况、岗位
  对齐信号、省略原因、事实约束），随简历记录落库、在预览里折叠展示；
- ``find_unwritten_details``（见 ``resume_coverage``）给出逐分区的未收录清单，
  前端据此渲染"没写进这份简历"的中性分组与处理按钮。

**为什么是代码拼而不是让模型写**：理由的价值在于可信。数据（筛了多少、留了多少、
为什么丢）全部来自确定性计算，代码拼装零额外模型调用，也不会出现"模型给自己的
选择找了个好听的借口"。
"""
from __future__ import annotations

from typing import Any

from ...schemas.job import JobOut


def build_generation_rationale(
    *,
    job: JobOut | None,
    selection_counts: dict[str, int],
    omitted_counts: dict[str, int],
    focus_skills: tuple[str, ...] | list[str],
    focus_domains: tuple[str, ...] | list[str],
    coverage_details: list[dict[str, Any]],
    baseline_confirmed: list[str],
    skill_limit: int = 14,
    fallback_sections: tuple[str, ...] | list[str] = (),
    custom_sections: list[dict[str, Any]] | tuple[dict[str, Any], ...] = (),
) -> str:
    """拼装生成说明。输入全部来自生成流程的确定性中间产物。

    ``custom_sections``（需求 6）：参与了岗位相关性筛选的自建板块
    （``profile_custom_filter.CustomSectionFilter.counts()``）。它们不进模型提示词，
    所以单独并进「候选资料组成」与"另有 N 条没进候选"的计数，不能靠
    ``selection_counts`` 里的键——那张表的键是 13 个内置分区。
    """
    general = job is None
    lines: list[str] = []
    if general:
        lines.append(
            "这是一份通用简历：没有按任何岗位做取舍，完整资料只按篇幅预算压缩后交给模型，"
            "各方向的经历都会保留。"
        )
    else:
        custom_labels: dict[str, str] = {}
        if custom_sections:
            selection_counts = dict(selection_counts)
            omitted_counts = dict(omitted_counts)
            for item in custom_sections:
                key = str(item.get("key") or "")
                if not key:
                    continue
                selected = int(item.get("selected") or 0)
                total = int(item.get("total") or 0)
                custom_labels[key] = str(item.get("name") or key)
                if selected:
                    selection_counts[key] = selected
                if total > selected:
                    omitted_counts[key] = total - selected
        skills_text = "、".join(list(focus_skills)[:8]) or "未识别到明确技能"
        domains_text = "、".join(list(focus_domains)[:4]) or "通用方向"
        lines.append(
            f"目标岗位「{job.title}」：系统从 JD 里提取到的核心技能信号是 {skills_text}，"
            f"岗位方向判断为「{domains_text}」。"
        )
        lines.append(
            f"候选资料组成：{_compose_counts(selection_counts, custom_labels)}。"
        )
        if fallback_sections:
            # A4/§8.5：岗位关键词与资料的直接交集不足，这些分区是按资料顺序保守保留
            # 的候选，不是"系统认为它们匹配"。资料里没写的岗位要求不会被编造。
            labels = "、".join(
                "实习/工作" if section == "experiences" else "项目"
                for section in fallback_sections
            )
            lines.append(
                f"岗位关键词与你的{labels}没有直接同词交集：系统保留了少量原始条目作为"
                "参考候选，避免资料被筛空；资料里没有的岗位要求不会编写。"
            )
        total_omitted = sum(omitted_counts.values())
        if total_omitted:
            lines.append(
                f"另有 {total_omitted} 条内容因为与岗位关键词交集不足或超出篇幅预算，"
                "没有进入候选资料——它们不是丢失了，仍完整保存在你的资料库里。"
            )
    if coverage_details:
        # 旧写法把 11 个分区的资料名用「；」串成一句（实测 623 字，占全文 61%），
        # 既是"理解为什么"最不需要的部分，又与上方蓝色覆盖块完全重复（同一份数据的
        # 超集，且那边还能逐条「AI 补上这段」）。这里只留一句指路 + 条数。
        total_unwritten = sum(int(note.get("total") or 0) for note in coverage_details)
        if total_unwritten:
            lines.append(
                f"没有写进这份简历的内容：共 {total_unwritten} 条，见上方「这些资料内容没有写进"
                "这份简历」，可在那里逐条补回；也可以把岗位关键词写进那条经历的描述后重新生成。"
            )
    if baseline_confirmed:
        lines.append(
            "事实台账里你已确认过的与 "
            + "、".join(baseline_confirmed[:6])
            + " 相关的主张参与了本次生成。"
        )
    lines.append(
        "事实约束：模型只能使用候选资料中出现过的经历、技能与数字，后端会再对照资料做"
        "一次防虚构核对（就是上方需要人工核对的清单）。"
    )
    if not general:
        lines.append(
            f"技能候选最多保留 {skill_limit} 项；匹配岗位的条目会前置并重点描述，"
            "与岗位无关的内容可能被省略——这是为了不让一份简历塞满无关经历。"
        )
    return "\n".join(line for line in lines if line)


def _compose_counts(
    selection_counts: dict[str, int], extra_labels: dict[str, str] | None = None
) -> str:
    # F3：候选组成扩展到 13 个大字段（新键只在有候选时出现，旧输出逐字不变）。
    labels = {
        "projects": "项目",
        "experiences": "实习/工作",
        "campus_experiences": "校园经历",
        "educations": "教育",
        "skills": "技能",
        "awards": "奖项",
        "publications": "学术成果",
        "research_projects": "科研项目",
        "patents": "知识产权",
        "credentials": "证书资质",
        "languages": "语言能力",
    }
    parts = [
        f"{label} {selection_counts.get(key, 0)} 条"
        for key, label in labels.items()
        if selection_counts.get(key)
    ]
    # 需求 6：自建板块用用户自己起的名字（后端原文，不翻译），排在 13 个内置之后。
    for key, label in (extra_labels or {}).items():
        if key in labels or not selection_counts.get(key):
            continue
        parts.append(f"{label} {selection_counts[key]} 条")
    return "、".join(parts) if parts else "（资料为空）"


__all__ = ["build_generation_rationale"]

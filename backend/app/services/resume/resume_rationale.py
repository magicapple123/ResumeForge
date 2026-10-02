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
) -> str:
    """拼装生成说明。输入全部来自生成流程的确定性中间产物。"""
    general = job is None
    lines: list[str] = []
    if general:
        lines.append(
            "这是一份通用简历：没有按任何岗位做取舍，完整资料只按篇幅预算压缩后交给模型，"
            "各方向的经历都会保留。"
        )
    else:
        skills_text = "、".join(list(focus_skills)[:8]) or "未识别到明确技能"
        domains_text = "、".join(list(focus_domains)[:4]) or "通用方向"
        lines.append(
            f"目标岗位「{job.title}」：系统从 JD 里提取到的核心技能信号是 {skills_text}，"
            f"岗位方向判断为「{domains_text}」。"
        )
        lines.append(f"候选资料组成：{_compose_counts(selection_counts)}。")
        total_omitted = sum(omitted_counts.values())
        if total_omitted:
            lines.append(
                f"另有 {total_omitted} 条内容因为与岗位关键词交集不足或超出篇幅预算，"
                "没有进入候选资料——它们不是丢失了，仍完整保存在你的资料库里。"
            )
    if coverage_details:
        dropped = [
            f"{note['section_label']}：{'、'.join(f'「{name}」' for name in note['names'][:4])}"
            for note in coverage_details
        ]
        lines.append(
            "没有写进这份简历的内容（多为岗位相关性取舍）："
            + "；".join(dropped)
            + "。想补哪一条，把岗位关键词写进那条经历的描述后重新生成，或手动补上。"
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


def _compose_counts(selection_counts: dict[str, int]) -> str:
    labels = {
        "projects": "项目",
        "experiences": "实习/工作",
        "campus_experiences": "校园经历",
        "educations": "教育",
        "skills": "技能",
        "awards": "奖项",
    }
    parts = [
        f"{label} {selection_counts.get(key, 0)} 条"
        for key, label in labels.items()
        if selection_counts.get(key)
    ]
    return "、".join(parts) if parts else "（资料为空）"


__all__ = ["build_generation_rationale"]

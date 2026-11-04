# SPDX-License-Identifier: Apache-2.0
"""生成结果的"覆盖度"检查：资料里有、但这份简历里没写的内容。

**为什么要有它**：生成链路里有两道会丢内容的关卡——
1. 岗位相关性筛选（profile_relevance）：与岗位关键词没有交集的条目根本不会进入
   发给模型的候选资料；
2. 模型自己取舍：同一份候选资料里，它也可能只写与岗位最相关的那几条。

两道关卡都是有意的设计（不筛的话，一份简历会塞满与岗位无关的经历）。但它们之前
都是静默的：用户在资料里明明写了项目、台账里也确认了，生成出来却没有——从用户的角度看
这就是"工具把我的内容弄丢了"，而他没有任何办法知道原因，更不知道该怎么办。

这个模块把"丢了什么、为什么丢、怎么办"一次说清。它只做确定性的集合比对
（按条目的身份字段：项目名 / 公司名 / 学校名），不做模糊语义判断——宁可少报，也不能
把"写进去了"误报成"没写"。

**F3 取数口径**：诊断只读本次冻结的消费快照。新入口 find_unwritten_details(resume,
consumed, selection_data) 用 selection_data["entry_names"]（F3-A 已按参与分区构造、
只含参与分区）与 selection_data["data"]（本次候选）；旧的 (resume, entry_names,
selection_data) 入口保留给既有单元测试，行为不变。
"""

from __future__ import annotations

import difflib
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from ...schemas.claim import ClaimDigestOut
from ...schemas.profile_projection import ConsumedProfile
from ...schemas.resume import ResumeContent
from ..profile.paper_projection import project_paper_content
from ..profile.profile_relevance_constants import section_limit
from .resume_coverage_notes import (
    builtin_entry_ids,
    custom_entry_ids,
    with_reasons,
)
from .resume_grounding_helpers import _similar, _similar_skill

# 简历字段 ↔ 资料分区的对应关系：
#   (简历上的字段, 资料里的分区, 身份字段, 用户看得见的分区名)
# 身份字段是"这条是不是同一条"的判据（项目名 / 公司名 / 学校名……）。它必须是
# 用户自己填的名字，而不是模型改写过的标题——否则比对就没有意义。
_SECTION_MAP: tuple[tuple[str, str, str, str], ...] = (
    ("projects", "projects", "name", "项目经历"),
    ("experience", "experiences", "company", "实习/工作经历"),
    ("campus_experience", "campus_experiences", "organization", "校园经历"),
    ("awards", "awards", "name", "荣誉奖项"),
    ("education", "educations", "school", "教育经历"),
    # A4 扩展栏目：身份字段与候选键同名（entry_names 里没有这些键时自然跳过，
    # 旧链路行为逐字不变）。
    ("publications", "publications", "title", "学术成果"),
    ("research_projects", "research_projects", "name", "科研项目"),
    ("patents", "patents", "title", "知识产权"),
    ("credentials", "credentials", "name", "证书资质"),
)

# 一次最多报几条，避免一份资料特别厚的用户收到一面墙的警告。
_MAX_REPORTED = 4


def _entry_names(section: Any, identity_field: str) -> set[str]:
    """取一个分区里所有条目的身份值（去掉空白）。"""
    names: set[str] = set()
    if not isinstance(section, list):
        return names
    for item in section:
        if isinstance(item, dict):
            value = str(item.get(identity_field) or "").strip()
            if value:
                names.add(value)
    return names


def _written_names(resume: ResumeContent, field: str, identity_field: str) -> set[str]:
    section = getattr(resume, field, None) or []
    names: set[str] = set()
    for item in section:
        value = str(getattr(item, identity_field, "") or "").strip()
        if value:
            names.add(value)
    return names


def find_unwritten_items(
    resume: ResumeContent,
    entry_names: dict[str, tuple[str, ...]],
    selection_data: dict[str, Any],
) -> list[str]:
    """对比"资料里有什么"与"简历里写了什么"，返回需要告知用户的条目。

    entry_names 是筛选前的身份字段清单（见 ProfileSelection）；
    selection_data 是真正发给模型的候选资料。
    """
    warnings: list[str] = []
    for note in find_unwritten_details(resume, entry_names, selection_data):
        parts: list[str] = []
        if note["filtered"]:
            preview = _preview_names(note["filtered"])
            parts.append(f"{preview}与这个岗位的关键词交集不足，没有进入本次生成使用的候选资料")
        # 受条数上限（如技能最多 14 条）裁掉的：原因与"交集不足"不同，文案必须分开说，
        # 否则用户会以为自己的技能与岗位不相关。
        capacity = note.get("capacity_omitted") or []
        if capacity:
            preview = _preview_names(capacity)
            parts.append(f"{preview}超出了本次生成的单栏目条数上限，没有进入候选资料")
        if note["model_omitted"]:
            preview = _preview_names(note["model_omitted"])
            parts.append(f"{preview}在候选资料里，但模型没有把它写进简历")
        if not parts:
            continue
        warnings.append(
            f"{note['section_label']}中有 {note['total']} 条没有出现在这份简历里：{'；'.join(parts)}。"
            "如果不是有意省略：把岗位关键词补进该条目的描述后重新生成，"
            "或在「手动调整」里手动补上这一段。"
        )
    return warnings


def _preview_names(names: list[str]) -> str:
    preview = "、".join(f"「{name}」" for name in names[:_MAX_REPORTED])
    extra = f"（共 {len(names)} 条）" if len(names) > _MAX_REPORTED else ""
    return f"{preview}{extra}"


def find_unwritten_details(
    resume: ResumeContent,
    # Mapping/Sequence（只读协议）：调用方手里有 dict[str, tuple[str, ...]] 也有
    # dict[str, list[str]]——dict 的值类型不变型，收成只读协议两边都装得下。
    entry_names: Mapping[str, Sequence[str]] | ConsumedProfile,
    selection_data: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """find_unwritten_items 的结构化版本，供前端按分组渲染与生成说明引用。

    返回的每项：section_label（用户可读的分区名）、names（全部未写入条目）、
    filtered（被岗位筛选/预算拦下的）、capacity_omitted（被单栏目名额裁掉的）、
    model_omitted（进了候选但模型没写的）、total，以及 5-A 新增的两项可选字段：
    ``reasons``（每条名字的显式原因，见 :func:`resume_coverage_notes.reasons_for`）
    与 ``entry_ids``（能唯一定位到资料条目的那些名字的 id，供 3-A 确定性补入）。
    文案组装留在调用方。

    F3 新入口：第二参传 ConsumedProfile 时，entry_names / candidates 都从
    selection_data 取（entry_names 只含参与分区；data 是本次候选）。
    """
    # 显式类型收窄：`consumed = entry_names if isinstance(...) else None` 的窄化只在三元
    # 表达式内部生效，后面 `if consumed is not None` 无法反推 entry_names 的类型（union
    # 原样保留，`.get` 就会报到 ConsumedProfile 头上）。所以直接把 isinstance 当分支条件，
    # 两个形态各自落到已标注的局部变量上，运行期逻辑与原来逐字等价。
    consumed: ConsumedProfile | None
    names_by_section: Mapping[str, Sequence[str]]
    candidates: Mapping[str, Any]
    if isinstance(entry_names, ConsumedProfile):
        consumed = entry_names
        selection = selection_data if isinstance(selection_data, dict) else {}
        names_by_section = selection.get("entry_names") or {}
        candidates = selection.get("data") or {}
    else:
        consumed = None
        # 旧入口：dict[str, tuple[str, ...]] / dict[str, list[str]]，只读协议两边都装得下。
        names_by_section = entry_names or {}
        candidates = selection_data if isinstance(selection_data, dict) else {}
    details: list[dict[str, Any]] = []
    for field, section, identity_field, label in _SECTION_MAP:
        original = set(names_by_section.get(section) or ())
        if not original:
            continue
        written = _written_names(resume, field, identity_field)
        missing = original - written
        if not missing:
            continue
        # 关键区分：这条内容有没有进入发给模型的候选资料。
        # 没进入 → 关卡 1（相关性/预算）拦的；进入了 → 模型自己取舍的。
        in_candidates = original & _entry_names(candidates.get(section), identity_field)
        filtered = sorted(missing - in_candidates)
        model_omitted = sorted(missing & in_candidates)
        if not filtered and not model_omitted:
            continue
        missing_names = sorted(missing)
        details.append(
            with_reasons(
                {
                    "section": section,
                    "section_label": label,
                    "names": missing_names,
                    "filtered": filtered,
                    "model_omitted": model_omitted,
                    "total": len(missing),
                },
                # 3-A：只有能从消费快照唯一定位到条目的名字才给 entry_ids；旧入口
                # （只带身份名）拿不到，于是这个键缺席，前端退回"去制作台添加"。
                entry_ids=(
                    builtin_entry_ids(consumed, section, identity_field, missing_names)
                    if consumed is not None
                    else None
                ),
            )
        )
    # 需求 6：自建板块的未收录明细由生成链在投影后算好（条目由服务端确定性写入，
    # 模型没有取舍权），随 selection_data 传进来；这里只负责合并进同一份清单。
    if consumed is not None:
        selection = selection_data if isinstance(selection_data, dict) else {}
        precomputed = selection.get("custom_section_coverage")
        if isinstance(precomputed, list):
            for item in precomputed:
                if not isinstance(item, dict):
                    continue
                note = dict(item)
                # 5-A：自建板块的原因与内置分区同一套口径（这里是它唯一的补口——
                # 明细由 profile_custom_filter 按同一份计划算好，这里只加显式原因与
                # entry_ids，不改它的判定结果）。
                names = [str(name) for name in (note.get("names") or []) if str(name)]
                details.append(
                    with_reasons(
                        note,
                        entry_ids=custom_entry_ids(
                            consumed, str(note.get("section") or ""), names
                        ),
                    )
                )
    return details




_LIST_FIELD_LABELS: tuple[tuple[tuple[str, str], str], ...] = (
    (("projects", "tech_stack"), "技术栈"),
    (("projects", "highlights"), "项目亮点"),
    (("research_projects", "outcomes"), "科研成果"),
)


# 行首列表标记：`- ` / `* ` / `• ` / `· ` 与 `1. ` / `2) `。**只锚行首**，且标记后必须
# 跟空白——这一条是刻意的：「1-2 秒」「2024-08」「2024.03」是正文，不能被当成列表前缀剥掉。
# 资料侧常是多行 Markdown 字符串、简历侧是已清洗的列表，两侧口径不一致会把每一条都判成
# "没写进简历"，用户照着提示再补一遍就变成重复内容（问题 15）。
_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*•·]|\d{1,3}[.)])\s+")


def _strip_list_marker(value: str) -> str:
    return _LIST_MARKER_RE.sub("", value, count=1)


def _normalized_values(raw: Any) -> list[str]:
    if isinstance(raw, (list, tuple)):
        values = [_strip_list_marker(str(value or "")).strip() for value in raw]
    else:
        values = [
            _strip_list_marker(part).strip()
            for line in str(raw or "").splitlines()
            for part in line.split("，")
        ]
    # 剥完标记后为空的行（原来只是一个 `- `）直接丢弃，不参与比对。
    return [value for value in values if value]


def _normalize_field_text(value: Any) -> str:
    return "".join(str(value or "").split()).casefold()


def _candidate_names(
    selection_data: dict[str, Any] | None, section: str, identity_field: str
) -> set[str]:
    """本次候选资料里某分区"都有谁"（没有候选快照时返回空集合）。

    条目级检查（``find_unwritten_details``）与技能检查共用同一套交集判断：
    **进了候选**才谈得上"模型取舍"，没进候选就是关卡 1（相关性 / 名额 / 预算）拦的。
    """
    selection = selection_data if isinstance(selection_data, dict) else {}
    data = selection.get("data")
    if not isinstance(data, dict):
        return set()
    return _entry_names(data.get(section), identity_field)


def find_unwritten_field_details(
    resume: ResumeContent,
    consumed: ConsumedProfile,
    selection_data: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """R1-G：条目内字段/技能/总结层面“资料里有、简历里没写”的结构化明细。

    与 find_unwritten_details 互补：后者按**条目**比对（整条没写），这里补上
    “条目在、但字段值被丢掉”（项目 tech_stack/亮点、技能条目、个人总结只写一部分）
    的情况，供 coverage_notes 如实告知用户。只做确定性集合比对，不猜语义。

    ``selection_data`` 是本次发给模型的候选料（``{"entry_names": …, "data": …}``）：
    技能那一档必须用它判断"这条技能到底有没有进过候选"，否则名额（
    ``SECTION_LIMITS["skills"]``）裁掉的那些会被误记成"模型没写"——模型一条都没漏。
    不传时无法区分，按旧口径全部记 model_omitted（生成链路必须传，见 resume_generator）。
    """
    fallback = project_paper_content(consumed)
    details: list[dict[str, Any]] = []
    # 1) 条目内列表字段：按身份匹配到同一条目后比较集合。
    for (section_key, field), label in _LIST_FIELD_LABELS:
        resume_field = "projects" if section_key == "projects" else "research_projects"
        identity_attr = "name"
        written_entries = list(getattr(resume, resume_field, None) or [])
        fallback_entries = list(getattr(fallback, resume_field, None) or [])
        for source_entry in fallback_entries:
            name = str(getattr(source_entry, identity_attr, "") or "").strip()
            if not name:
                continue
            target = next(
                (
                    item
                    for item in written_entries
                    if _similar(str(getattr(item, identity_attr, "") or ""), name)
                ),
                None,
            )
            if target is None:
                continue  # 整条没写 → 已由 find_unwritten_details 报过
            source_values = _normalized_values(getattr(source_entry, field, None))
            written_values = [
                _normalize_field_text(value)
                for value in _normalized_values(getattr(target, field, None))
            ]
            missing = [
                value
                for value in source_values
                if _normalize_field_text(value) not in written_values
            ]
            if not missing:
                continue
            prefix = "项目" if section_key == "projects" else "科研项目"
            details.append(
                with_reasons(
                    {
                        "section": section_key,
                        "section_label": f"{prefix}「{name}」的{label}",
                        "names": missing,
                        "filtered": [],
                        "model_omitted": missing,
                        "total": len(missing),
                    }
                )
            )
    # 2) 技能条目：整条没写的技能单列，并按"有没有进过候选"分开归因。
    #
    # 以前这里把没写进去的一律记 model_omitted、`filtered` 硬编码成空数组。但技能的名额
    # 在 SECTION_LIMITS["skills"]=14 就压掉了：候选 14 条、实写 14 条时模型一条没漏，
    # 用户却读到"模型没有把它写进简历"。归因口径与条目级（第 149-153 行）保持一致：
    #   - 没进候选 + 候选已满名额 → capacity_omitted（受条数上限限制）
    #   - 没进候选 + 候选没满     → filtered（相关性 / 预算拦下）
    #   - 进了候选               → model_omitted（模型取舍）
    written_skills = [
        str(skill.name or "").strip()
        for skill in resume.skills
        if str(skill.name or "").strip()
    ]
    missing_skills = [
        str(skill.name or "").strip()
        for skill in fallback.skills
        if str(skill.name or "").strip()
        and not any(_similar_skill(str(skill.name or ""), name) for name in written_skills)
    ]
    if missing_skills:
        has_snapshot = selection_data is not None
        in_candidates = _candidate_names(selection_data, "skills", "name")
        # 候选条数顶到名额上限：没进候选的那些是被名额裁掉的，不是"交集不足"。
        at_capacity = len(in_candidates) >= section_limit("skills")
        # 没有候选快照就无法判断（旧口径）：不谎称是名额裁的，也不谎称被筛掉。
        outside = [name for name in missing_skills if name not in in_candidates]
        capacity_omitted = outside if has_snapshot and at_capacity else []
        filtered_skills = outside if has_snapshot and not at_capacity else []
        details.append(
            with_reasons(
                {
                    "section": "skills",
                    "section_label": "专业技能",
                    "names": missing_skills,
                    "filtered": filtered_skills,
                    "capacity_omitted": capacity_omitted,
                    "model_omitted": [
                        name
                        for name in missing_skills
                        if name in in_candidates or not has_snapshot
                    ],
                    "total": len(missing_skills),
                }
            )
        )
    # 3) 个人总结：资料有总结、简历只写一小部分时如实提示（不要求逐字）。
    source_summary = str(fallback.summary or "").strip()
    written_summary = str(resume.summary or "").strip()
    if source_summary:
        ratio = difflib.SequenceMatcher(
            None, _normalize_field_text(written_summary), _normalize_field_text(source_summary)
        ).ratio()
        if ratio < 0.5:
            # 5-A 顺带修既有不一致：原来 ``names`` 是「个人总结（与资料原文相似度 68%）」
            # 而 ``model_omitted`` 只有「个人总结」，两条按名字对不上 → 原因整条丢掉
            # （前端只能显示「未说明」）。现在两处共用**同一个**标签，相似度仍然可见。
            label = f"个人总结（与资料原文相似度 {ratio:.0%}）"
            details.append(
                with_reasons(
                    {
                        "section": "summary",
                        "section_label": "个人总结",
                        "names": [label],
                        "filtered": [],
                        "model_omitted": [label],
                        "total": 1,
                    }
                )
            )
    return details

def all_entry_names(entry_names: dict[str, tuple[str, ...]]) -> set[str]:
    """把各分区的身份名合并成一个集合（给台账主张的包含判断用）。"""
    names: set[str] = set()
    for section_names in (entry_names or {}).values():
        names.update(name for name in section_names if name)
    return names


def claim_subjects(baseline: ClaimDigestOut | None) -> list[str]:
    """从事实基线里取已确认条目的主体（用于与条目名做包含判断）。

    baseline 为 None 是正常状态：没启用事实台账的用户、以及通用简历路径都传 None。
    """
    if baseline is None:
        return []
    subjects: list[str] = []
    for line in (baseline.baseline_text or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        subject = str(entry.get("subject") or "").strip()
        if subject:
            subjects.append(subject)
    return subjects


def confirmed_claims_about(names: set[str], baseline: ClaimDigestOut | None) -> list[str]:
    """找出与给定条目名相关的已确认台账主张（主体里提到该名字）。

    台账条目本身不会被直接写进简历（它只是事实来源），所以这里不检查主张是否
    逐字出现——那必然几乎全部"未命中"。有用的是反过来的那条信息：
    用户已经为某个条目确认过事实，但该条目根本没进入候选资料。
    """
    if not names:
        return []
    hits: list[str] = []
    for subject in claim_subjects(baseline):
        for name in names:
            if name and name in subject:
                hits.append(name)
                break
    return sorted(set(hits))

# SPDX-License-Identifier: Apache-2.0
"""生成警告的最终定型：被移除条目的文案替换（问题 4）与补充要求不生效的告知（问题 13）。

**为什么单开一个模块**：`resume_generator` 已顶到 500 行预算，而警告改写是纯字符串逻辑，
留在编排门面里只会让主流程更难读。这里的实现只依赖「grounding 前后的两份简历」与候选
数据的键集合，不复制 grounding / consistency 的匹配规则：

- :func:`collect_removed_entries`：按「分区 + 条目名」做前后 diff。grounding 只在
  `_find_source` 命中后才保留条目，保留时会把名字改写成来源名（与模型写的名字必然
  `_similar`），所以「前有后无」就是被移除——改名不会被误判成删除。
- :func:`rewrite_removed_entry_warnings`：**替换**而不是追加，同一条内容只该有一条警告；
  两种情形文案必须分开——分区**本次未参与**（下一步是"去方案里启用"）、分区**已参与**
  但对不上（下一步才是"去资料里核对/补充"）。量化结果类警告（`出现资料未提供的量化结果`）
  不含条目名，因此不会被这里吞掉。

**为什么不改六个 `ground_*` 的签名**：removed 清单以两份简历快照为输入，六个分区函数
的返回值形状保持不变，既有调用点（含 4 处测试）无需改动。
"""

from __future__ import annotations

from typing import Any

from ...schemas.resume import ResumeContent
from .resume_generator_prompts import append_generation_warnings
from .resume_grounding_helpers import _similar, _similar_skill

# (简历字段, 身份属性, 候选数据里的分区键, 用户看得见的分区名)
# 与 resume_coverage._SECTION_MAP 同一套身份字段口径：条目"是不是同一条"只认用户自己
# 填的名字，不认模型改写过的标题。
_REMOVAL_SECTIONS: tuple[tuple[str, str, str, str], ...] = (
    ("education", "school", "educations", "教育经历"),
    ("experience", "company", "experiences", "实习/工作经历"),
    ("campus_experience", "organization", "campus_experiences", "校园经历"),
    ("projects", "name", "projects", "项目经历"),
    ("skills", "name", "skills", "专业技能"),
    ("awards", "name", "awards", "荣誉奖项"),
)

#: 一条警告里最多点名几个条目（超过就只给总数），避免把警告写成一面墙。
_MAX_PREVIEW = 4


def collect_removed_entries(before: ResumeContent, after: ResumeContent) -> list[dict[str, Any]]:
    """grounding 前后 diff：哪些条目被删掉了（按分区 + 条目名）。

    同一分区里重名的条目只登记一次；`after` 里仍有相近名字的条目不登记。
    """
    removed: list[dict[str, Any]] = []
    for field, identity, source_key, label in _REMOVAL_SECTIONS:
        matcher = _similar_skill if source_key == "skills" else _similar
        kept = [
            str(getattr(item, identity, "") or "").strip()
            for item in (getattr(after, field, None) or [])
        ]
        kept = [name for name in kept if name]
        names: list[str] = []
        for item in getattr(before, field, None) or []:
            name = str(getattr(item, identity, "") or "").strip()
            if not name or name in names:
                continue
            if any(matcher(name, other) for other in kept):
                continue
            names.append(name)
        if names:
            removed.append({"section": source_key, "label": label, "names": names})
    return removed


def _preview(names: list[str]) -> str:
    shown = "、".join(f"「{name}」" for name in names[:_MAX_PREVIEW])
    extra = f"（共 {len(names)} 条）" if len(names) > _MAX_PREVIEW else ""
    return f"{shown}{extra}"


def _replacement_text(label: str, names: list[str], *, participated: bool) -> str:
    """两种情形的文案必须分开：下一步是"启用板块"还是"检查资料"。"""
    if not participated:
        return (
            f"模型生成了本次方案未启用的板块内容（{label}：{_preview(names)}），已自动移除。"
            "如需保留，请在方案中启用该板块后重新生成。"
        )
    return (
        f"{label}中有 {len(names)} 条内容在候选资料里找不到来源（{_preview(names)}）："
        f"已移除 {len(names)} 条，纸面上不再显示。请检查资料，若确有其事，补齐后重新生成。"
    )


def _is_entry_warning(warning: str, entry: dict[str, Any]) -> bool:
    """该警告是不是"某个分区里出现未包含条目「名字」"那一条。

    只在分区名 + 「条目名」都命中时认领：量化结果类警告的句式不同（没有"中出现"），
    所以永远留在原位。
    """
    return warning.startswith(f"{entry['label']}中出现") and any(
        f"「{name}」" in warning for name in entry["names"]
    )


def rewrite_removed_entry_warnings(
    warnings: list[str],
    removed: list[dict[str, Any]],
    candidate_data: dict[str, Any] | None,
) -> list[str]:
    """把"未包含条目"的逐条警告换成分区级说明；没有对应警告的移除保持静默。

    静默是刻意的：模型从项目 tech_stack 里提炼出的技能会被 grounding 删掉，但一致性
    检查用"正文里出现过"豁免了它——这类内容今天就不提示，本改动不该凭空造出新警告。
    """
    if not removed:
        return warnings
    data = candidate_data if isinstance(candidate_data, dict) else {}
    rewritten: list[str] = []
    emitted: set[str] = set()
    for warning in warnings:
        hit = next((entry for entry in removed if _is_entry_warning(warning, entry)), None)
        if hit is None:
            rewritten.append(warning)
            continue
        label = hit["label"]
        if label in emitted:
            continue
        emitted.add(label)
        rewritten.append(
            _replacement_text(label, hit["names"], participated=hit["section"] in data)
        )
    return rewritten


#: 问题 13：不美化档位下 grounding 会用资料原文覆盖改写，补充要求改不动正文。
_INSTRUCTION_IGNORED = (
    "本次未开启内容美化，补充要求不会改变正文。如需按补充要求调整表达，请开启内容美化后重新生成。"
)


def instruction_ignored_warning(options: Any) -> str | None:
    """enhance=False 却带了补充要求：如实说明它不会生效（而不是让用户以为填了白填）。"""
    if getattr(options, "enhance", False):
        return None
    if not str(getattr(options, "custom_instruction", "") or "").strip():
        return None
    return _INSTRUCTION_IGNORED


def finalize_generation_warnings(
    warnings: list[str],
    before: ResumeContent,
    after: ResumeContent,
    selection_data: dict[str, Any],
    options: Any,
    *,
    general: bool,
) -> list[str]:
    """警告的最终定型（生成链路唯一入口）：套话/篇幅 → 移除条目替换 → 补充要求告知。"""
    result = append_generation_warnings(
        warnings,
        after,
        selection_data,
        general=general,
        wording_enabled=bool(options.enhance),
    )
    result = rewrite_removed_entry_warnings(
        result, collect_removed_entries(before, after), selection_data.get("data")
    )
    ignored = instruction_ignored_warning(options)
    if ignored:
        result.append(ignored)
    return result


__all__ = [
    "collect_removed_entries",
    "finalize_generation_warnings",
    "instruction_ignored_warning",
    "rewrite_removed_entry_warnings",
]

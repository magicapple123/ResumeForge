# SPDX-License-Identifier: Apache-2.0
"""同分区锚点合并（FIX-9）与"这条到底是不是记录"的收尾清洗（FIX-10 / FIX-11）。

从 `profile_entry_merge` 拆出（2026-11-11，500 行预算）。分工：

* `profile_entry_merge` 负责**锚点判定**与 AI↔本地一对一配对；
* 这里负责**条目成形之后**的两件事：
  1. 同一条被模型输出成两种写法（``浙江大学`` / ``浙江大学 计算机科学与技术 本科``）时
     并回一条——这是"同一份资料被识别成多份"的主因；
  2. 姓名、电话邮箱、求职意向被当成技能，或任何分区的锚点等于 `name`/`phone`/`email`。

合并的最高风险是**过度合并**：同一家公司两段不连续任职并成一条会丢掉一整段履历，
所以日期保护是硬门槛（`_date_conflict`），角色不同也不并（`_role_conflict`）。
"""

from __future__ import annotations

import re
from typing import Any

from .profile_entry_merge import (
    IDENTITY_FIELDS,
    clean_identity_text,
    entry_anchor,
    has_value,
    is_label_value,
    normalized_key,
    same_anchor,
)
from .profile_parser.entry_constants import _DEGREE_TERMS

# FIX-9：只有"名字是多词实体"的分区才允许前缀合并。技能**不在此列**：
# `Java` 是 `JavaScript` 的前缀，合并会把两个真技能并成一个。
_PREFIX_MERGE_SECTIONS = frozenset(
    {"educations", "experiences", "campus_experiences", "projects", "awards"}
)
# 再保守一档：日期都非空且不相等时一律判为两条独立记录。同一家公司两段不连续任职
# （`阿里巴巴 2020.07-2021.06` / `2023.01-2024.06`）是合法的履历，绝不能并成一条。
_DATE_GUARD_FIELDS = ("start_date", "end_date")
# 合并时冲突值写进哪个字段（宁可在描述里多一行，也不静默丢掉一整段事实）。
_NOTE_FIELD_BY_SECTION = {
    "educations": "achievements",
    "experiences": "description",
    "campus_experiences": "description",
    "projects": "description",
}

# FIX-10：技能名的合法性。整句技能（「熟练掌握相机的使用，能独自完成视频拍摄与剪辑
# 工作」）是提示词明确要求保留的，所以长度阈值取 24 而不是更小。
_MAX_SKILL_NAME_CHARS = 24
_KV_SEPARATOR_CHARS = "：:｜|"
_HEADER_FIELD_WORDS = (
    "姓名",
    "电话",
    "手机",
    "邮箱",
    "微信",
    "性别",
    "年龄",
    "现居",
    "地址",
    "求职意向",
    "期望",
)
# FIX-11：任何分区的锚点等于这几个基础字段的值 → 这条不是记录（比 FIX-10 更通用）。
_HEADER_VALUE_FIELDS = ("name", "phone", "email")

_TAIL_TOKEN_RE = re.compile(r"[\s|｜/、,，;；]+")
_DEGREE_TOKEN_SET = frozenset(term.casefold() for term in _DEGREE_TERMS)


def is_legal_skill_name(name: str) -> bool:
    """FIX-10：技能名是否像个技能（而不是一整行头部信息被塞进技能分区）。

    三条判据都只挡"明显非法"，不做语义判断：过长、含键值冒号、命中头部字段词。
    `Power BI` / `Node.js` / `C#` / `C++` 这类带符号的真技能必须过。
    """
    text = name.strip()
    if not text:
        return False
    if len(text) > _MAX_SKILL_NAME_CHARS:
        return False
    if any(char in text for char in _KV_SEPARATOR_CHARS):
        return False
    compact = normalized_key(text)
    return not any(word in compact for word in _HEADER_FIELD_WORDS)


def _date_conflict(item: dict[str, Any], other: dict[str, Any]) -> bool:
    """两侧日期都非空且不相等 → 是两条独立记录（FIX-9 的硬门槛）。"""
    for field in _DATE_GUARD_FIELDS:
        left = normalized_key(str(item.get(field) or ""))
        right = normalized_key(str(other.get(field) or ""))
        if left and right and left != right:
            return True
    return False


def _role_conflict(section: str, item: dict[str, Any], other: dict[str, Any]) -> bool:
    """第二个身份字段（专业 / 角色）都非空且不是前缀关系 → 是两条独立记录。

    `腾讯 / 工程师` 与 `腾讯 / 高级工程师` 可能是两次任职，合并会把一段真实履历并掉，
    所以宁可不并。
    """
    for field in IDENTITY_FIELDS[section][1:]:
        left = normalized_key(str(item.get(field) or ""))
        right = normalized_key(str(other.get(field) or ""))
        if left and right and not same_anchor(left, right):
            return True
    return False


def merge_anchor_variants(section: str, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """FIX-9：同分区内按锚点把"同一条的两种写法"合成一条。

    合成时字段取并集：长锚点那条优先，空字段由另一条补；身份值回到**短锚点**的字面
    （`浙江大学 计算机科学与技术 本科` 的尾部被拆进 `major`/`degree`，校名保持干净）。
    """
    if section not in _PREFIX_MERGE_SECTIONS or len(entries) < 2:
        return entries
    result: list[dict[str, Any]] = []
    for item in entries:
        anchor = entry_anchor(section, item)
        target: int | None = None
        for index, existing in enumerate(result):
            other_anchor = entry_anchor(section, existing)
            if not other_anchor or not same_anchor(anchor, other_anchor):
                continue
            if _date_conflict(item, existing) or _role_conflict(section, item, existing):
                continue
            target = index
            break
        if target is None:
            result.append(item)
            continue
        long_entry, short_entry = _order_pair(section, result[target], item)
        result[target] = _merge_variant(section, long_entry, short_entry)
    return result


def _order_pair(
    section: str, left: dict[str, Any], right: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """返回（长锚点那条, 短锚点那条）。锚点等长时把字面更干净的那条当"长"。"""
    left_anchor = entry_anchor(section, left)
    right_anchor = entry_anchor(section, right)
    if len(right_anchor) != len(left_anchor):
        return (left, right) if len(left_anchor) > len(right_anchor) else (right, left)
    identity = IDENTITY_FIELDS[section][0]
    left_raw = str(left.get(identity) or "")
    right_raw = str(right.get(identity) or "")
    return (left, right) if len(left_raw) <= len(right_raw) else (right, left)


def _merge_variant(
    section: str, long_entry: dict[str, Any], short_entry: dict[str, Any]
) -> dict[str, Any]:
    """把 short 那条并进 long 那条：长锚点优先、空字段互补、冲突写进描述字段。"""
    identity = IDENTITY_FIELDS[section][0]
    merged: dict[str, Any] = {**short_entry}
    for field, value in long_entry.items():
        if has_value(value):
            merged[field] = value
    short_name = clean_identity_text(str(short_entry.get(identity) or ""))
    long_name = str(long_entry.get(identity) or "").strip()
    if short_name:
        merged[identity] = short_name
    _fill_from_anchor_tail(section, merged, short_name, long_name)
    for field, value in short_entry.items():
        if field == identity or field in _DATE_GUARD_FIELDS or not has_value(value):
            continue
        current = merged.get(field)
        if not has_value(current) or str(current) == str(value):
            continue
        if normalized_key(str(value)) in normalized_key(str(current)):
            continue
        _carry_conflict(section, merged, str(value))
    return merged


def _fill_from_anchor_tail(
    section: str, merged: dict[str, Any], short_name: str, long_name: str
) -> None:
    """把长锚点比短锚点多出来的那几段（`计算机科学与技术 本科`）拆进空字段。

    拆不进去的段不能静默丢，落到该分区的描述/获奖字段里（`_carry_conflict`）。
    """
    if not short_name or not long_name.startswith(short_name):
        return
    tail = long_name[len(short_name) :].strip()
    if not tail:
        return
    for token in _TAIL_TOKEN_RE.split(tail):
        token = token.strip()
        if not token:
            continue
        if section == "educations":
            if token.casefold() in _DEGREE_TOKEN_SET:
                merged["degree"] = merged.get("degree") or token
                continue
            if not merged.get("major"):
                merged["major"] = token
                continue
        elif len(IDENTITY_FIELDS[section]) > 1:
            role_field = IDENTITY_FIELDS[section][1]
            if not merged.get(role_field):
                merged[role_field] = token
                continue
        _carry_conflict(section, merged, token)


def _carry_conflict(section: str, merged: dict[str, Any], value: str) -> None:
    """合并后仍不一致的一段文字写进该分区的描述字段（不静默丢事实）。"""
    target = _NOTE_FIELD_BY_SECTION.get(section)
    note = value.strip()
    if not target or not note:
        return
    key = normalized_key(note)
    # 这段文字已经在别的字段里了（典型是 `计算机科学与技术` 既是 major 又是长锚点的尾段）
    # 就不要在描述里再抄一遍。
    if any(
        key in normalized_key(str(other))
        for field, other in merged.items()
        if field != target and has_value(other)
    ):
        return
    current = str(merged.get(target) or "").strip()
    if note in current:
        return
    merged[target] = f"{current}\n{note}".strip() if current else note


def finalize_sections(values: dict[str, Any]) -> list[str]:
    """分区级收尾清洗（FIX-7 / FIX-10 / FIX-11）：就地修改 `values`，返回用户可读说明。

    必须在**所有分区都合并完之后**调用一次——这三条都以"最终成形的条目"为输入。

    * FIX-11：锚点等于 `name` / `phone` / `email` 的值 → 丢弃（挡住"姓名被当成技能"）；
    * FIX-10：`skills` 里过长、含 `：/:/｜/|`、命中头部字段词的条目 → 丢弃；
    * FIX-2 兜底：身份字段的值是表头词/指代词/页码噪声 → 清空该字段（清空后没有任何
      身份锚点的条目直接丢弃，它本来就不是一条记录）；
    * FIX-7：同一锚点同时出现在 `educations` 与 `experiences` → 留 experiences。
      **不能**用"含大学/学院"当教育的必要条件——`MIT` 是合法校名。
    """
    notes: list[str] = []
    header_values = {
        normalized_key(str(values.get(field) or "")) for field in _HEADER_VALUE_FIELDS
    } - {""}
    dropped_headers = 0
    for section in IDENTITY_FIELDS:
        entries = values.get(section)
        if not isinstance(entries, list):
            continue
        kept: list[dict[str, Any]] = []
        for item in entries:
            if not isinstance(item, dict):
                continue
            _clear_label_fields(section, item)
            if _is_non_record(section, item, header_values):
                dropped_headers += 1
                continue
            kept.append(item)
        values[section] = kept
    if dropped_headers:
        notes.append(f"已忽略 {dropped_headers} 条疑似表头、联系方式或重复的记录，请核对。")
    dropped_cross = _drop_cross_section_duplicates(values)
    if dropped_cross:
        notes.append(f"已忽略 {dropped_cross} 条同时出现在教育和工作经历里的重复记录，请核对。")
    return notes


def _clear_label_fields(section: str, item: dict[str, Any]) -> None:
    """身份字段里写着表头词/指代词的，清空它（它不是一个实体名）。"""
    for field in IDENTITY_FIELDS[section]:
        value = item.get(field)
        if isinstance(value, str) and value.strip() and is_label_value(value):
            item[field] = ""


def _is_non_record(section: str, item: dict[str, Any], header_values: set[str]) -> bool:
    """这一条到底是不是一条记录（清空表头字段之后再判一次）。"""
    anchor = entry_anchor(section, item)
    if not anchor:
        return True
    if header_values and anchor in header_values:
        return True
    if section == "skills":
        name = str(item.get("name") or "")
        if not is_legal_skill_name(name):
            return True
        if header_values and normalized_key(name) in header_values:
            return True
    return False


def _drop_cross_section_duplicates(values: dict[str, Any]) -> int:
    """FIX-7：教育里那条其实是工作经历（锚点与某条 experiences 相同/前缀）→ 丢掉教育那条。"""
    educations = values.get("educations")
    experiences = values.get("experiences")
    if not isinstance(educations, list) or not isinstance(experiences, list):
        return 0
    company_anchors = [
        anchor for anchor in (entry_anchor("experiences", item) for item in experiences) if anchor
    ]
    if not educations or not company_anchors:
        return 0
    kept: list[dict[str, Any]] = []
    dropped = 0
    for item in educations:
        anchor = entry_anchor("educations", item)
        if anchor and any(same_anchor(anchor, company) for company in company_anchors):
            dropped += 1
            continue
        kept.append(item)
    values["educations"] = kept
    return dropped


__all__ = [
    "finalize_sections",
    "is_legal_skill_name",
    "merge_anchor_variants",
]

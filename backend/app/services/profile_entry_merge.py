# SPDX-License-Identifier: Apache-2.0
"""AI 条目与本地草稿的**合并与脏条目清洗**（锚点判定与一对一配对的唯一实现）。

从 `text_extraction_normalization` 拆出（2026-10-27，500 行预算）：那一侧负责字段边界、
来源锚定和最终装配，这一侧只回答两个问题——"模型给的这几条，和本地规则解析出的那几条，
怎么一对一配上？哪些根本不是记录？"

四条根因在这里：

1. **同名条目互相串值**：原实现用 `{anchor: item}` 字典，同名条目互相覆盖，只剩最后
   一条，于是每条同名 AI 条目都拿同一条本地条目 merge（用户实测：4 条「浙江大学」的
   日期全变成最后一条的）。现在按锚点一对一 FIFO 消费。
2. **锚点字面不等导致重复**：本地把学历粘进校名（`第一中学 高中`），模型给 `第一中学`，
   字面不等就 AI 一条 + 本地一条（4 条变 5 条）。现在先精确、再**前缀**配对。
3. **页眉页脚被当成记录**：`第 2 页` 让 1 条教育变 2 条。
4. **同一份内容粘贴两遍**：模型把整段再输出一遍 → 完全相同的条目去重。

同分区合并（FIX-9）、技能合法性（FIX-10）与头部字段兜底（FIX-11）在
``profile_entry_dedup``：它们在"条目已成形"之后收尾，与这里的配对是两件事。
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# 身份字段：条目靠它认"是不是同一条"。顺序即优先级（校名优先于专业）。
IDENTITY_FIELDS = {
    "educations": ("school", "major"),
    "experiences": ("company", "role"),
    "campus_experiences": ("organization", "role"),
    "projects": ("name", "role"),
    "skills": ("name",),
    "awards": ("name",),
}

# 身份锚点短于这个长度就不是名字（"0"、"1"、空串）：模型把一行劈成两条时，
# 常常多出一条只有序号/单个数字的脏条目。
_MIN_ANCHOR_CHARS = 2
# 这些分区的名字合法地可以很短（技能名 `C`、`R`、`Go`），不适用"锚点太短=脏条目"。
_SHORT_NAME_SECTIONS = frozenset({"skills"})
# 页眉页脚的排版噪声：模型偶尔把「第 2 页」「共 2 页」「1/2」当成一条记录的身份锚点
# （用户实测：噪声行让 1 条教育变成 2 条）。锚点已归一（去空白 + casefold），这里按整串匹配。
_NOISE_ANCHOR_RE = re.compile(
    r"^(?:第\d+页(?:[/／]共\d+页)?|共\d+页|页码\d*|简历编号\d*|\d+[/／]\d+|"
    r"page\d+(?:of\d+)?)$",
    re.IGNORECASE,
)

# FIX-1：装饰符号只剥首尾，而且**仅当字面长度 ≥4**。`C#`（2 字）必须原样保留，
# 一律剥会把 `C#` 变成 `C`、把 `.NET` 这类技术名改成另一个技能。
_DECORATION_CHARS = "*#_~"
_MIN_DECORATED_CHARS = 4

# FIX-2：表头字段词与指代词。**只做整串精确匹配**——`北京某某科技有限公司` 是
# 真公司名，用"含「公司」就杀"会把它和一堆真实企业名一起清掉。
_HEADER_LABEL_ANCHORS = frozenset(
    {
        "学校",
        "公司",
        "单位",
        "组织",
        "项目",
        "职位",
        "岗位",
        "时间",
        "姓名",
        "电话",
        "邮箱",
        "学历",
        "专业",
        "经历",
        "教育",
        "技能",
        "奖项",
    }
)
_PLACEHOLDER_ANCHORS = frozenset({"现在这家公司", "该公司", "某公司", "上家公司"})


def normalized_key(value: str) -> str:
    """锚定/比对用的归一：全半角折叠 + 去所有空白 + 大小写折叠 + 剥首尾装饰符号。

    全半角这一步是必需的：抄录文本常写成 ``２０１４．０９``（截图 OCR 的全角标点），
    模型输出却是 ``2014-09``；不折叠就会在"是否是同一条"上互相认不出。

    装饰符号（FIX-1）是 Markdown 抄录的残留：`*清华大学**` 与 `清华大学` 是同一条，
    但只有字面长度 ≥4 时才剥——`C#` 剥完就成了 `C`，那是另一个技能。
    """
    normalized = re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()
    stripped = normalized.strip(_DECORATION_CHARS)
    if len(normalized) >= _MIN_DECORATED_CHARS and stripped:
        return stripped
    return normalized


def clean_identity_text(value: str) -> str:
    """身份字段的写回值：与 `normalized_key` 同一套剥法，但保留原大小写与空格。"""
    text = value.strip()
    stripped = text.strip(_DECORATION_CHARS)
    if len(text) >= _MIN_DECORATED_CHARS and stripped:
        return stripped.strip()
    return text


def entry_anchor(section: str, item: dict[str, Any]) -> str:
    """条目的身份锚点（归一后的第一个非空身份字段）；没有身份字段时返回空串。"""
    for field in IDENTITY_FIELDS[section]:
        value = item.get(field, "")
        if value:
            return normalized_key(str(value))
    return ""


def is_label_value(value: str) -> bool:
    """这个字面值是不是表头标签 / 指代词 / 页码噪声（而不是一个实体名）。"""
    normalized = normalized_key(value)
    if not normalized:
        return False
    if normalized in _HEADER_LABEL_ANCHORS or normalized in _PLACEHOLDER_ANCHORS:
        return True
    return bool(_NOISE_ANCHOR_RE.match(normalized))


def is_usable_anchor(section: str, anchor: str) -> bool:
    """这个锚点够不够指向一条记录（表头词、指代词、噪声行与过短锚点都不算）。

    **唯一定义**：合并阶段（`prune_entries`）、识别归一化（`_ground_entries` 决定
    "这条有没有身份锚点"）与收尾清洗（`finalize_sections`）必须用同一套判定，否则
    同一条记录会在三处得到不同结论——典型是技能名 `C` / `R` / `Go`：技能分区里合法
    的短名字，在另一处被当成脏条目清掉。

    参数可以是原文，也可以是已经归一过的锚点（`normalized_key` 幂等）。
    """
    normalized = normalized_key(anchor)
    if not normalized:
        return False
    if _NOISE_ANCHOR_RE.match(normalized):
        return False
    if normalized in _HEADER_LABEL_ANCHORS or normalized in _PLACEHOLDER_ANCHORS:
        return False
    return section in _SHORT_NAME_SECTIONS or len(normalized) >= _MIN_ANCHOR_CHARS


def same_anchor(anchor: str, other: str) -> bool:
    """两个身份锚点是否指同一条记录（先精确，再前缀包含）。

    前缀这一档是为**字面不等但同一条**准备的：``第一中学 高中``（学历没拆出来）与
    模型给的 ``第一中学`` 是同一条；同分区里 ``浙江大学`` 与
    ``浙江大学 计算机科学与技术 本科`` 也是同一条（FIX-9）。要求短的一侧至少 2 个字，
    避免 ``一`` 这种字匹配一切。
    """
    if anchor == other:
        return True
    if len(anchor) < 2 or len(other) < 2:
        return False
    return anchor.startswith(other) or other.startswith(anchor)


def has_value(value: Any) -> bool:
    """字段是否"有内容"（空串、None、空列表都算没有）。"""
    return bool(str(value).strip()) if isinstance(value, str) else bool(value)


def _take_local(
    section: str,
    anchor: str,
    local_entries: list[dict[str, Any]],
    used: set[int],
    exact: bool,
) -> int | None:
    """按锚点取一条**尚未被消费**的本地条目（FIFO：同名多条各取一条）。"""
    if not anchor:
        return None
    for index, item in enumerate(local_entries):
        if index in used:
            continue
        local_anchor = entry_anchor(section, item)
        if not local_anchor:
            continue
        matched = local_anchor == anchor if exact else same_anchor(anchor, local_anchor)
        if matched:
            return index
    return None


def merge_entries(
    section: str, ai_entries: list[dict[str, str]], local_entries: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """AI 条目与本地草稿**一对一**配对（同名条目各取一条，见模块头第 1 条）。"""
    if not ai_entries:
        return local_entries
    used: set[int] = set()
    merged: list[dict[str, Any]] = []
    for ai_item in ai_entries:
        anchor = entry_anchor(section, ai_item)
        index = _take_local(section, anchor, local_entries, used, exact=True)
        if index is None:
            index = _take_local(section, anchor, local_entries, used, exact=False)
        if index is None:
            merged.append(ai_item)
            continue
        used.add(index)
        # 已通过原文锚定的 AI 字段可纠正本地分类；空字段仍保留本地草稿。
        merged.append(
            {
                **local_entries[index],
                **{field: value for field, value in ai_item.items() if value},
            }
        )
    # 没被任何 AI 条目认领的本地条目仍然补在后面（原来这个"补漏"是对的）。
    for index, item in enumerate(local_entries):
        if index not in used:
            merged.append(item)
    return prune_entries(section, merged)[:200]


def prune_entries(section: str, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """丢掉**脏条目**，并把同一条的两种写法并回一条。

    模型偶尔把一行劈成两条（``项目8号`` + 名字叫 ``0`` 的条目，用户实测 20 条项目变
    21 条）、把页眉页脚当成记录，或把同一份内容粘贴两遍时整段再输出一遍。规则：
    1. 锚点是排版噪声 / 表头标签 / 指代词 / 过短 → 不是记录（`is_usable_anchor`）；
    2. 同一锚点（相等或前缀）的两条 → 合成一条（FIX-9，含日期保护）；
    3. 除 ``reference_*`` 外全部字段相同的两条 —— 同一条记录被输出了两次；
    4. 整条只有身份字段有值，且这个锚点能在一段**其他条目的文字**里整段找到 ——
       它是被重复输出的一段文字，不是独立记录。

    单条分区不做任何清洗：没有"邻条"可比，且短名字在那里是合法的。
    """
    # 局部 import：`profile_entry_dedup` 反过来要这里的锚点判定，模块级互相 import 会成环。
    from .profile_entry_dedup import merge_anchor_variants

    if len(entries) <= 1:
        return entries
    kept = [item for item in entries if is_usable_anchor(section, entry_anchor(section, item))]
    kept = merge_anchor_variants(section, kept)
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for item in kept:
        fingerprint = tuple(
            sorted(
                (field, str(value))
                for field, value in item.items()
                if value and not field.startswith("reference_")
            )
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(item)
    if len(deduped) <= 1:
        return deduped
    return [
        item
        for index, item in enumerate(deduped)
        if not _is_fragment(section, item, deduped, index)
    ]


def _is_fragment(
    section: str, item: dict[str, Any], all_items: list[dict[str, Any]], index: int
) -> bool:
    """整条只有身份字段、且其中文字在其他条目里整段出现过。"""
    identity_fields = IDENTITY_FIELDS[section]
    filled_others = [
        field for field, value in item.items() if field not in identity_fields and value
    ]
    if filled_others:
        return False
    anchor = entry_anchor(section, item)
    if not anchor:
        return True
    for other_index, other in enumerate(all_items):
        if other_index == index:
            continue
        for field, value in other.items():
            if field in identity_fields or not isinstance(value, str) or not value:
                continue
            if anchor in normalized_key(value):
                return True
    return False


__all__ = [
    "IDENTITY_FIELDS",
    "clean_identity_text",
    "entry_anchor",
    "has_value",
    "is_label_value",
    "is_usable_anchor",
    "merge_entries",
    "normalized_key",
    "prune_entries",
    "same_anchor",
]

# SPDX-License-Identifier: Apache-2.0
"""焦点面板「清单数据」的英文显示名（按**稳定 key** 索引，绝不按中文串匹配）。

**为什么需要这一层**：面板上跳转条、分组树、行内标签显示的板块名与字段名属于**清单数据**，
从后端下发后原样 `textContent`；``panel_copy.localize_panel`` 的整句替换够不到它们，于是英文
界面里仍然是一整片中文（用户截图：「基本信息」「项目名称」「教育经历 1」）。

四条纪律：

1. **只加显示字段**。``display`` / ``display_group`` 是新增键；``label`` / ``group`` 一个字都
   不动——它们被 ``accept(item.label, item.value)`` 回传、被 ``row.dataset.group`` 用于定位 /
   折叠 / 配色、被跳转条按组名聚合。改动语义会连带改掉写入链路。
2. **按稳定 key 索引**：板块用 ``ConsumedSection.key``、内置字段用 ``ConsumedFieldSpec.field_id``、
   网申目录字段用 ``FormField.key``。中文串是**源语言**，改一次文案就断，不能当 key。
3. **中文逐字不变**：``zh-CN`` 下 ``display_*`` 直接返回原值；英文缺失同样回退原中文
   ——宁可露一句中文，也不要空串。
4. **用户内容永不翻译**：自建板块（``custom:…``）、自定义字段（``CUSTOM_*``，含用户改名）
   都是用户自己写的名字，查不到就原样返回（见 ``with_display_fields`` 的回退）。

英文文案**不是这里发明的**，逐条抄自已校对的前端词表（``frontend/src/i18n/messages``）：
板块名 → ``en-US.profileLibrary.ts`` 的 ``sectionFallback.<section_key>``；内置字段名 →
``en-US.profileField.ts``（键即 field_id）；网申目录字段名 → ``en-US.webformFields.ts``。
``backend/tests/test_webform_panel_labels.py`` 会回读这三份文件逐条校验，防止这里慢慢写出
一套"另一个英文版"。
"""

from __future__ import annotations

import re

from ...models.web_form_profile import CUSTOM_KEY_PREFIX
from .panel_label_tables import (
    FIELD_LABELS,
    FORM_FIELD_FALLBACKS,
    FORM_FIELD_LABELS,
    SECTION_LABELS,
)
from .panel_repeat_labels import is_repeat_key, repeat_field_label, repeat_group_label
from .repeated_fields import field_label_for_key, split_repeated_key
from .webform_copy import copy_for, locale_key

# 重叠字段（R-75）那一支把行归在「基本信息 / 网申资料」两组，它不是板块 key 而是**分组标识**：
# 前者就是 basic_info 板块，后者是网申侧补充。
WEBFORM_GROUP_KEY = "webform_extra"

# ``项目名称（第一条）`` 这类展示层序号后缀；英文行改写成 ``(Entry N)``。
_ZH_ORDINAL_SUFFIX = re.compile(
    r"\s*[（(]\s*第[0-9０-９一二三四五六七八九十百千万]+\s*条\s*[）)]\s*$"
)

__all__ = [
    "FIELD_LABELS",
    "FORM_FIELD_LABELS",
    "SECTION_LABELS",
    "WEBFORM_GROUP_KEY",
    "field_display_name",
    "form_field_display_name",
    "group_display_name",
    "indexed_field_label",
    "panel_field_display_name",
    "section_display_name",
    "with_display_fields",
]


def _english(locale: str | None) -> bool:
    """目标语言是不是英文。未知语言按源语言处理（与 ``panel_copy`` 同一口径）。"""
    return locale_key(locale) == "en-US"


def section_display_name(section_key: str, fallback: str, locale: str | None) -> str:
    """板块显示名。自建板块（``custom:…``）不在表里，返回原值。"""
    if not _english(locale):
        return fallback
    return SECTION_LABELS.get(str(section_key or ""), fallback)


def field_display_name(field_id: str, fallback: str, locale: str | None) -> str:
    """内置字段显示名（key 是 ``<section>.<field>``）；自建字段返回原值。"""
    if not _english(locale):
        return fallback
    return FIELD_LABELS.get(str(field_id or ""), fallback)


def _form_label(key: str) -> str:
    """网申目录键 → 英文名；动态键（``experience_2_company``）先拆回基础键再查。"""
    base, _index = split_repeated_key(str(key or ""))
    return (
        FORM_FIELD_LABELS.get(base)
        or FORM_FIELD_FALLBACKS.get(base)
        # 「重复网申补充」那一支的字段（作品 / 社交 / 论文附件说明…），表在
        # ``panel_repeat_labels``（拆文件是为了守住单文件行数预算）。
        or repeat_field_label(base)
        or ""
    )


def form_field_display_name(field_key: str, fallback: str, locale: str | None) -> str:
    """网申目录字段显示名。"""
    if not _english(locale):
        return fallback
    return _form_label(field_key) or fallback


def panel_field_display_name(field_key: str, fallback: str, locale: str | None) -> str:
    """面板标题（``.h``）上的字段名。

    自定义字段（``CUSTOM_*``）的显示名是**用户自己起的名字**，任何语言下都原样返回。
    """
    if str(field_key or "").startswith(CUSTOM_KEY_PREFIX):
        return fallback
    return form_field_display_name(field_key, fallback, locale)


def indexed_field_label(field_key: str, label: str, locale: str | None) -> str:
    """给序列字段补序号后缀。

    ``zh-CN`` 走既有 ``field_label_for_key`` 口径（「项目名称（第二条）」逐字不变）；
    英文改成 ``Project name (Entry 2)``，并先去掉标签自带的「（第一条）」。
    """
    _base, index = split_repeated_key(str(field_key or ""))
    if index is None:
        return label
    if not _english(locale):
        return field_label_for_key(field_key, label)
    stripped = _ZH_ORDINAL_SUFFIX.sub("", label).strip()
    return f"{stripped or label} (Entry {index})"


def group_display_name(
    group_key: str, group_index: object, fallback: str, locale: str | None
) -> str:
    """分组显示名。无 key / 无译文时返回原值（用户自建板块名原样显示）。"""
    if not _english(locale):
        return fallback
    key = str(group_key or "")
    if not key:
        return fallback
    if key == WEBFORM_GROUP_KEY:
        # 与面板顶部那个来源徽标同一句（``panel.source.webform``），不另写一份措辞。
        return copy_for(locale).get("panel.source.webform") or fallback
    # 「重复网申补充」组（``repeat:<group>``）：「项目经历补充」→「Project details」。
    # 它与简历侧板块名不撞（后者是「Projects」），所以两组能共存而不混淆。
    name = repeat_group_label(key) or SECTION_LABELS.get(key)
    if not name:
        return fallback
    index = str(group_index or "").strip()
    return f"{name} {index}" if index else name


def _row_label(row: dict[str, str], fallback: str) -> str:
    """一行清单的显示名；查不到就回退原中文（宁可露中文，不要空串）。"""
    label_key = str(row.get("label_key") or "")
    if is_repeat_key(label_key):
        # 补充记录行：序号已由分组名表达（「Project details 1」），标签上不再重复
        # 一遍——否则一行里会出现两个序号，读起来像两条。字段名先查补充表，
        # 再回落到网申目录（紧急联系人姓名这类字段两边都有）。
        return repeat_field_label(label_key) or _form_label(str(row.get("key") or "")) or fallback
    if label_key:
        return FIELD_LABELS.get(label_key, fallback)
    key = str(row.get("key") or "")
    if not key or key.startswith(CUSTOM_KEY_PREFIX):
        return fallback
    shown = _form_label(key)
    if not shown:
        return fallback
    _base, index = split_repeated_key(key)
    return f"{shown} (Entry {index})" if index is not None else shown


def _row_group(row: dict[str, str], fallback: str, locale: str | None) -> str:
    """一行的分组显示名。

    只认 ``group_key``：没有 key 的行（协议分组 / 用户自建组）保持原值——协议分组
    （``identity`` / ``contact`` …）由面板脚本自己的 ``groupLabel`` 翻（它带中英两套文案）。
    带 key 的行一律走 ``group_display_name``，包括「重复网申补充」的 ``repeat:<group>``。
    """
    group_key = str(row.get("group_key") or "")
    if not group_key:
        return fallback
    return group_display_name(group_key, row.get("group_index"), fallback, locale)


def with_display_fields(rows: list[dict[str, str]], locale: str | None) -> list[dict[str, str]]:
    """给清单行补 ``display`` / ``display_group``（**`label` / `group` 原样保留**）。

    ``zh-CN`` 下两者恒等于原值——中文界面与改造前逐字一致。
    """
    english = _english(locale)
    result: list[dict[str, str]] = []
    for row in rows:
        item = dict(row)
        label = str(item.get("label") or "")
        group = str(item.get("group") or "")
        item["display"] = _row_label(item, label) if english else label
        item["display_group"] = _row_group(item, group, locale) if english else group
        result.append(item)
    return result

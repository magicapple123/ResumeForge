# SPDX-License-Identifier: Apache-2.0
"""布局规划器：唯一真相（D10）。

输入一份 v2 文档 + 该简历的 format_config + 语言，输出 DocumentPlan。HTML / PDF / Word /
Markdown / TXT 五个出口都**只消费 plan**：字段拼装、排序、换行、分页所需的"什么内容放在
哪里、哪个角色、哪条路径"只在这里决定一次；模板只画外壳 + CSS，渲染器只画 Inline 段。

**纯函数**：不依赖 Jinja / PDF / Word / DB / 网络，可单独单测（tests/test_document_plan.py）。
不缩字号：plan 里没有任何缩放系数；PDF 装不下时按页数上限截断并标 overflow。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from ...schemas.resume_document import (
    DocumentPlan,
    EntryLayout,
    EntryPlan,
    HeaderPlan,
    HeadPlan,
    Inline,
    ResumeDocument,
    ResumeEntry,
    ResumeHeader,
    ResumeSection,
    RowLayout,
    SectionPlan,
    TextItem,
    parse_document,
)
from . import document_catalog as catalog
from .document_plan_rows import (
    _body_blocks,
    _inline_rows,
    _joined_segments,
    _pack_rows,
)
from .document_plan_text import plan_to_text
from .resume_contact import (
    CONTACT_SEPARATOR_KEY,
    contact_separator_text,
    validate_contact_breaks,
)
from .resume_labels import (
    field_labels,
    gender_text,
    normalize_language,
)
from .resume_rich_marks import item_text

#: I-02：照片 data URI 的前缀判据。只 match 前缀、不做 base64 解码——
#: `validate_photo_data_url` 会 decode，5MB 照片每次渲染都解一遍，热路径不能用。
_PHOTO_DATA_URL_RE = re.compile(r"^data:image/(?:jpeg|jpg|png|webp|gif);base64,", re.IGNORECASE)

__all__ = [
    "build_document_plan",
    "plan_header",
    "plan_section",
    "plan_to_text",
]

#: 联系方式里带「标签：」前缀的字段（与 resume_contact.LABELLED_FIELDS 同口径）。
_LABELLED_CONTACT = {"github": "github", "personal_website": "website"}

#: inline 板块里条目之间的分隔符（计划 §5.2：中文「；」/英文 "; "）。
_INLINE_ROW_SEPARATOR = {"zh-CN": "；", "en-US": "; "}


def build_document_plan(
    document: ResumeDocument | Mapping[str, Any],
    format_config: Mapping[str, Any] | None = None,
    language: str | None = None,
) -> DocumentPlan:
    """v2 文档 -> DocumentPlan。**只接受 v2**（v1 先经 ensure_document_version 转换）。"""
    doc = _as_document(document)
    lang = normalize_language(language or doc.language)
    sections = [
        plan
        for section in doc.sections
        if (plan := plan_section(section, format_config, lang)) is not None
    ]
    separator = contact_separator_text(
        format_config.get(CONTACT_SEPARATOR_KEY) if isinstance(format_config, Mapping) else None
    )
    return DocumentPlan(
        language=lang,
        header=plan_header(doc.header, lang, separator),
        sections=sections,
    )


def _as_document(document: ResumeDocument | Mapping[str, Any]) -> ResumeDocument:
    if isinstance(document, ResumeDocument):
        return document
    if isinstance(document, Mapping):
        raw = dict(document)
        if raw.get("version") != 2:
            raise ValueError("planner 只接受 v2 文档；v1 请先经 ensure_document_version 转换")
        return parse_document(raw)
    raise ValueError("planner 输入必须是 ResumeDocument 或 v2 dict")


def _label_mode(item: Any) -> str:
    """页眉字段名的三态（F20）：auto / show / hide。

    旧文档没有 `label_mode`：按 `show_label is False ? "hide" : "auto"` 回落。必须看
    `model_fields_set` 而不是取值——Pydantic 会给缺失字段补默认 `"auto"`，只看值就分不出
    "用户选了自动"和"老文档根本没有这个键"（后者带 `show_label:false` 时不许印前缀）。
    """
    if "label_mode" not in getattr(item, "model_fields_set", set()):
        return "hide" if getattr(item, "show_label", True) is False else "auto"
    mode = getattr(item, "label_mode", "auto")
    return mode if mode in ("auto", "show", "hide") else "auto"


def plan_header(header: ResumeHeader, language: str, contact_separator: str = "") -> HeaderPlan:
    """页眉：name 行 / name_meta 行 / subtitle 行 / 联系方式的强制换行与同行分隔。

    `contact_separator` 是**同行字段之间**的可见文本（空串 = 各出口沿用历史分隔符），
    与 `contact_breaks`（强制换行）正交：换行决定哪几个字段同处一行，分隔符决定同一行
    里它们之间印什么。

    字段名前缀由 `label_mode` 三态决定（F20）：`auto` 保持历史行为（电话只印值、
    GitHub/自定义/求职意向印前缀），`show` 一律印「标签：」，`hide` 一律只印值。

    **QW-6：标签与值拆成两段**。两段共用同一条 `header.{id}` 路径，标签段带
    `role="field_label"`、值段带 `role="meta"`——这样"只把字段名改红"和"只把字段值放大"
    都能落到各自的段上。最终可见文本逐字节不变（`：` 只出现一次，跟着标签段走）；
    值段为空时仍合成**一段**，与拆分前的节点数一致（空字段没有可区分的两块）。
    """
    labels = field_labels(language)
    name: list[Inline] = []
    name_meta: list[Inline] = []
    subtitle: list[Inline] = []
    contact_items = []
    photo: str | None = None

    def label_segment(text: str, path: str) -> Inline:
        """字段名段：`：` 归属标签段（跟着标签一起被样式化），不另起标点段。"""
        return Inline(text=text + "：", role="field_label", path=path)

    def field_segments(label: str, value: str, path: str) -> list[Inline]:
        """标签 + 值 → 段列表；值为空时退回一段（节点数与拆分前相同）。"""
        if not value:
            return [Inline(text=label + "：" if label else "", role="meta", path=path)]
        segments = [label_segment(label, path)] if label else []
        segments.append(Inline(text=value, role="meta", path=path))
        return segments

    for item in header.items:
        mode = _label_mode(item)
        path = "header." + item.id
        # I-12：页眉自由文本字段同样优先读 `rich.runs`（`item_text` 是唯一读路径入口；
        # 没有 rich 时原样返回 value，页眉产物逐字节不变）。性别是**枚举**，不参与投影
        # ——它的值要过 `gender_text` 词表，标记串会破坏匹配。
        text = item_text(item)
        if item.placement == "name":
            name.append(Inline(text=text, role="meta", path=path))
        elif item.placement == "name_meta":
            if item.key != "gender":
                name_meta.append(Inline(text=text, role="meta", path=path))
                continue
            # v1 的「姓名（性别）」口径：gender 在自己的字段里，渲染时套语言括号。
            # show 改「性别：男」并不再叠括号；hide 只印值（F20）。
            if mode == "show" and item.value:
                name_meta.extend(field_segments(labels.get("gender", "性别"), text, path))
            elif mode == "hide":
                name_meta.append(Inline(text=text, role="meta", path=path))
            else:
                name_meta.append(
                    Inline(text=gender_text(item.value, language), role="meta", path=path)
                )
        elif item.placement == "subtitle":
            # 求职意向行沿用 v1 的「求职意向：值」前缀（标签文案来自目录 + 语言包，
            # 四个出口都只画 plan，不各写一份）。标签段与值段共用同一条路径，点标签与
            # 点值定位到同一个字段（QW-6）。
            spec = catalog.header_field_spec(item.key)
            prefix = labels.get(spec.label_key, "") if spec is not None else ""
            if prefix and (mode == "show" or (mode == "auto" and item.show_label)):
                subtitle.append(label_segment(prefix, path))
            subtitle.append(Inline(text=text, role="meta", path=path))
        elif item.placement == "contact":
            # I-02 读取侧容忍：历史缺陷（页眉 hide→show 把 placement 写死成 contact）会把
            # 照片的 data URI 留在这里。它一旦进 contact_items，HTML 因 nowrap 横向溢出，
            # PDF 因 `_has_header_field_style` 走逐字符分行 → 每页都刷满 base64。
            # 判据只用**前缀正则**，不调 validate_photo_data_url（那个会 base64 decode，
            # 5MB 照片每次渲染都解一遍）。
            if _PHOTO_DATA_URL_RE.match(item.value):
                if photo is None:
                    photo = item.value
                continue
            contact_items.append(item)
        elif item.placement == "photo":
            photo = item.value
    breaks = set(validate_contact_breaks(header.contact_breaks))
    lines: list[list[Inline]] = []
    current: list[Inline] = []
    for item in contact_items:
        if item.key in breaks and current:
            lines.append(current)
            current = []
        mode = _label_mode(item)
        label_key = _LABELLED_CONTACT.get(item.key)
        if mode == "hide":
            # F20：hide 一律只印值——包括 GitHub/主页/自定义字段。
            label = ""
        elif label_key:
            label = labels.get(label_key, label_key)
        elif item.label.strip():
            # #10：自定义页眉字段把用户起的名字印在值前面（与 github/website 同形），
            # 否则纸面上只剩裸值「13800000000」，看不出这项是什么。
            label = item.label.strip()
        else:
            # auto 对电话/邮箱/城市/出生年份只印值（历史行为）；show 才补前缀。
            label = labels.get(item.key, "") if mode == "show" else ""
        current.extend(field_segments(label, item_text(item), "header." + item.id))
    if current:
        lines.append(current)
    return HeaderPlan(
        name=name,
        name_meta=name_meta,
        subtitle=subtitle,
        contact_lines=lines,
        contact_separator=contact_separator,
        photo=photo,
    )


def plan_section(
    section: ResumeSection,
    format_config: Mapping[str, Any] | None,
    language: str,
) -> SectionPlan | None:
    if section.kind == "inline":
        rows = _inline_rows(section, language)
        if not rows:
            return None
        return SectionPlan(
            key=section.key,
            title=_section_title(section, language),
            kind="inline",
            layout=section.layout,
            rows=rows,
            row_separator=_INLINE_ROW_SEPARATOR.get(
                normalize_language(language), _INLINE_ROW_SEPARATOR["zh-CN"]
            ),
        )
    entries: list[EntryPlan] = []
    for entry in section.entries:
        if entry.hidden:
            continue
        plan = _plan_entry(section, entry, language)
        if plan is not None:
            entries.append(plan)
    if not entries:
        return None
    return SectionPlan(
        key=section.key,
        title=_section_title(section, language),
        kind=section.kind,
        layout=section.layout,
        entries=entries,
    )


def _section_title(section: ResumeSection, language: str) -> str:
    override = str(section.layout.title_override or "").strip()
    if override:
        return override
    if catalog.section_spec(section.key) is None:
        return str(section.title or section.key)
    return catalog.resolve_section_title(section.key, section.title, language)


def _effective_layout(section: ResumeSection, entry: ResumeEntry) -> EntryLayout:
    """条目级覆盖叠在分区默认上的生效列布局（渲染器不再自己算继承）。

    这里只保留**两侧共用**的那一套（旧口径）与分页 / head 开关；正文前 / 正文后各自的
    生效列布局由 `_effective_row_layout` 单独算（问题 4）。
    """
    return EntryLayout(
        head=entry.layout.head,
        columns=entry.layout.columns or section.layout.columns,
        align=entry.layout.align or section.layout.align,
        justify=entry.layout.justify or section.layout.justify,
        gap=entry.layout.gap if entry.layout.gap is not None else section.layout.gap,
        # 逐列宽度 / 逐间隔同口径继承。长度是否等于生效列数由渲染器判定
        # （`resolved_column_geometry`）：对不上就整体回落等宽，不会"半个宽度生效"。
        column_widths=(
            entry.layout.column_widths
            if entry.layout.column_widths is not None
            else section.layout.column_widths
        ),
        column_gaps=(
            entry.layout.column_gaps
            if entry.layout.column_gaps is not None
            else section.layout.column_gaps
        ),
        # 分页只带**条目自己的**开关：分区级「另起一页」由渲染器在分区开头处理，
        # 若在这里与分区级取或，会让分区内每个条目都断页（不是生效值的语义）。
        start_on_new_page=bool(entry.layout.start_on_new_page),
        keep_together=bool(entry.layout.keep_together),
    )


#: 侧别 → 该层"分侧覆盖"的字段名。lead/trail 之外没有第三种侧别。
_ROLES = ("lead", "trail")


def _effective_row_layout(section: ResumeSection, entry: ResumeEntry, side: str) -> RowLayout:
    """正文前 / 正文后各自的**生效**列布局（问题 4）。

    继承链（scope 由近到远）：

        entry.<side>.X ?? entry.X ?? section.<side>.X ?? section.X ?? 默认值

    「条目共用值优先于板块分侧值」是刻意的：条目的共用值（`entry.columns` 等）是用户在
    **这一条**上做的决定，比板块级的分侧默认更贴近使用场景。默认值取"1 列 / equal /
    start"，与拆开之前完全一致，所以旧文档（lead/trail 都是 None）产物逐字节不变。

    Args:
        section: 所属分区。
        entry: 当前条目。
        side: ``"lead"`` 或 ``"trail"``。

    Returns:
        已解析的 `RowLayout`；``gap`` / ``column_widths`` / ``column_gaps`` 可能仍是 None
        （= 交给渲染器按对齐方式取兜底值），与拆开之前的语义一致。
    """
    if side not in _ROLES:
        raise ValueError(f"未知的灰字段侧别：{side!r}")
    entry_side = getattr(entry.layout, side)
    section_side = getattr(section.layout, side)

    def pick(name: str):
        """按继承链取第一个非 None 的值。"""
        for layer in (entry_side, entry.layout, section_side, section.layout):
            if layer is None:
                continue
            value = getattr(layer, name)
            if value is not None:
                return value
        return None

    columns = pick("columns")
    align = pick("align")
    justify = pick("justify")
    return RowLayout(
        columns=1 if columns is None else columns,
        align="equal" if align is None else align,
        justify="start" if justify is None else justify,
        gap=pick("gap"),
        column_widths=pick("column_widths"),
        column_gaps=pick("column_gaps"),
    )


def _plan_entry(section: ResumeSection, entry: ResumeEntry, language: str) -> EntryPlan | None:
    layout = _effective_layout(section, entry)
    lead_layout = _effective_row_layout(section, entry, "lead")
    trail_layout = _effective_row_layout(section, entry, "trail")
    entry_id = entry.id or ""
    head_items = [
        item
        for item in entry.items
        if not isinstance(item, TextItem) and item.placement in ("title", "meta")
    ]
    title_items = [item for item in head_items if item.placement == "title"]  # type: ignore[attr-defined]
    meta_items = [item for item in head_items if item.placement == "meta"]  # type: ignore[attr-defined]
    title_segments = _joined_segments(title_items, section.key, entry_id, language, "entry_title")
    meta_segments = _joined_segments(meta_items, section.key, entry_id, language, "meta")
    if not entry.items:
        return None
    lead = [
        item for item in entry.items if not isinstance(item, TextItem) and item.placement == "lead"
    ]
    trail = [
        item for item in entry.items if not isinstance(item, TextItem) and item.placement == "trail"
    ]
    return EntryPlan(
        id=entry_id,
        layout=layout,
        lead_layout=lead_layout,
        trail_layout=trail_layout,
        head=HeadPlan(
            layout=layout.head,
            title=title_segments,
            meta=meta_segments,
            path=section.key + "." + entry_id,
        ),
        lead_rows=_pack_rows(lead, lead_layout, section.key, entry_id, language),
        body=_body_blocks(entry, section.key, entry_id, language),
        trail_rows=_pack_rows(trail, trail_layout, section.key, entry_id, language),
    )

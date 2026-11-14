# SPDX-License-Identifier: Apache-2.0
"""布局规划器：唯一真相（D10）。

输入一份 v2 文档 + 该简历的 format_config + 语言，输出 DocumentPlan。HTML / PDF / Word /
Markdown / TXT 五个出口都**只消费 plan**：字段拼装、排序、换行、分页所需的"什么内容放在
哪里、哪个角色、哪条路径"只在这里决定一次；模板只画外壳 + CSS，渲染器只画 Inline 段。

**纯函数**：不依赖 Jinja / PDF / Word / DB / 网络，可单独单测（tests/test_document_plan.py）。
不缩字号：plan 里没有任何缩放系数；PDF 装不下时按页数上限截断并标 overflow。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ...schemas.resume_document import (
    BlockPlan,
    CellPlan,
    DocumentPlan,
    EntryLayout,
    EntryPlan,
    HeaderPlan,
    HeadPlan,
    Inline,
    ResumeDocument,
    ResumeEntry,
    ResumeHeader,
    ResumeItem,
    ResumeSection,
    RowLayout,
    SectionPlan,
    TextItem,
    parse_document,
)
from . import document_catalog as catalog
from .document_plan_format import body_style_of, item_inlines, wants_paren
from .document_plan_text import plan_to_text
from .resume_contact import (
    CONTACT_SEPARATOR_KEY,
    contact_separator_text,
    validate_contact_breaks,
)
from .resume_labels import (
    field_labels,
    gender_text,
    list_separator,
    normalize_language,
)

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
    """
    labels = field_labels(language)
    name: list[Inline] = []
    name_meta: list[Inline] = []
    subtitle: list[Inline] = []
    contact_items = []
    photo: str | None = None
    for item in header.items:
        display = item.value
        mode = _label_mode(item)
        if item.placement == "name_meta" and item.key == "gender":
            # v1 的「姓名（性别）」口径：gender 在自己的字段里，渲染时套语言括号。
            # show 改「性别：男」并不再叠括号；hide 只印值（F20）。
            if mode == "show" and item.value:
                display = f"{labels.get('gender', '性别')}：{item.value}"
            elif mode == "hide":
                display = item.value
            else:
                display = gender_text(item.value, language)
        segments = [Inline(text=display, role="meta", path="header." + item.id)]
        if item.placement == "name":
            name.extend(segments)
        elif item.placement == "name_meta":
            name_meta.extend(segments)
        elif item.placement == "subtitle":
            # 求职意向行沿用 v1 的「求职意向：值」前缀（标签文案来自目录 + 语言包，
            # 四个出口都只画 plan，不各写一份）。标签段不带 path（点标签不定位字段）。
            spec = catalog.header_field_spec(item.key)
            prefix = labels.get(spec.label_key, "") if spec is not None else ""
            if prefix and (mode == "show" or (mode == "auto" and item.show_label)):
                subtitle.append(Inline(text=prefix + "：", role="field_label"))
            subtitle.extend(segments)
        elif item.placement == "contact":
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
            display = item.value
        elif label_key:
            display = labels.get(label_key, label_key) + "：" + item.value
        elif item.label.strip():
            # #10：自定义页眉字段把用户起的名字印在值前面（与 github/website 同形），
            # 否则纸面上只剩裸值「13800000000」，看不出这项是什么。
            display = item.label.strip() + "：" + item.value
        else:
            # auto 对电话/邮箱/城市/出生年份只印值（历史行为）；show 才补前缀。
            prefix = labels.get(item.key, "") if mode == "show" else ""
            display = prefix + "：" + item.value if prefix else item.value
        current.append(Inline(text=display, role="meta", path="header." + item.id))
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


def _joined_segments(
    items: Sequence[ResumeItem],
    section_key: str,
    entry_id: str,
    language: str,
    role: str,
) -> list[Inline]:
    segments: list[Inline] = []
    for item in items:
        if isinstance(item, TextItem):
            continue
        part = item_inlines(item, section_key, entry_id, language, show_label=False, role=role)
        if not part:
            continue
        if segments:
            segments.append(Inline(text=" · ", role=role))
        segments.extend(part)
    return segments


def _pack_rows(
    items: Sequence[ResumeItem],
    layout: RowLayout,
    section_key: str,
    entry_id: str,
    language: str,
) -> list[list[CellPlan]]:
    """lead/trail 装箱：solo 先冲行再独占整行；equal 每行 columns 个；flow 一行顺排。

    入参是**这一侧**的生效布局（问题 4）：正文前 2 列、正文后 3 列时，两侧的行数与每行
    cell 数各不相同——这正是"分侧列数"的全部意义。
    """
    columns = layout.columns or 1
    align = layout.align or "equal"
    cells: list[CellPlan] = []
    for item in items:
        if isinstance(item, TextItem):
            continue
        segments = item_inlines(item, section_key, entry_id, language, role="meta")
        if not segments:
            continue
        cells.append(CellPlan(segments=segments, solo=bool(item.solo)))
    rows: list[list[CellPlan]] = []
    current: list[CellPlan] = []
    for cell in cells:
        if cell.solo:
            if current:
                rows.append(current)
                current = []
            rows.append([cell])
            continue
        current.append(cell)
        if align == "equal" and len(current) >= columns:
            rows.append(current)
            current = []
    if current:
        rows.append(current)
    if align == "flow":
        separator = list_separator(language)
        for row in rows:
            for index in range(len(row) - 1):
                row[index].segments.append(Inline(text=separator, role="meta"))
    return rows


def _body_blocks(
    entry: ResumeEntry, section_key: str, entry_id: str, language: str
) -> list[BlockPlan]:
    blocks: list[BlockPlan] = []
    for item in entry.items:
        path = section_key + "." + entry_id + "." + item.id
        if isinstance(item, TextItem):
            if item.hidden:
                continue
            blocks.append(
                BlockPlan(
                    kind=item.style,
                    segments=[Inline(text=item.text, role="body", path=path)],
                    path=path,
                )
            )
            continue
        if item.placement != "body":
            continue
        segments = item_inlines(
            item,
            section_key,
            entry_id,
            language,
            role="body",
            wrap_paren=wants_paren(item),
        )
        if not segments:
            continue
        blocks.append(BlockPlan(kind=body_style_of(item), segments=segments, path=path))
    return blocks


#: inline 板块里条目的稳定排序：黑字（body）在前、灰字（trail/lead 等）在后。
#: 为什么需要它：converter 按字段目录顺序产出 item（技能 = category(trail) → name/level(body)），
#: 不排的话一行会以「技能分类：编程语言」开头，而 v1 的标签观感是「Python（熟练）· 编程语言」。
#: 只在**同一 placement 组内**保持数据顺序（sorted 稳定），不改变用户对条目内字段顺序的调整。
_INLINE_PLACEMENT_ORDER = {"body": 0}


def _inline_sort_key(item: ResumeItem) -> int:
    return _INLINE_PLACEMENT_ORDER.get(getattr(item, "placement", ""), 1)


def _inline_rows(section: ResumeSection, language: str) -> list[list[CellPlan]]:
    """inline 板块：每个条目一行；黑字（body）在前、灰字（trail）在后；wrap=paren 值加括号。"""
    rows: list[list[CellPlan]] = []
    for entry in section.entries:
        if entry.hidden:
            continue
        entry_id = entry.id or ""
        row: list[CellPlan] = []
        order = sorted(entry.items, key=_inline_sort_key)
        for item in order:
            if isinstance(item, TextItem):
                continue
            if item.placement == "hidden":
                continue
            role = "body" if item.placement == "body" else "meta"
            segments = item_inlines(
                item,
                section.key,
                entry_id,
                language,
                role=role,
                show_label=item.placement != "body",
                wrap_paren=wants_paren(item),
            )
            if segments:
                row.append(CellPlan(segments=segments))
        if row:
            rows.append(row)
    return rows



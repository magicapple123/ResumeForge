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
    SectionPlan,
    TextItem,
    parse_document,
)
from . import document_catalog as catalog
from .document_plan_format import item_inlines, plain_text
from .resume_contact import validate_contact_breaks
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
    return DocumentPlan(language=lang, header=plan_header(doc.header, lang), sections=sections)


def _as_document(document: ResumeDocument | Mapping[str, Any]) -> ResumeDocument:
    if isinstance(document, ResumeDocument):
        return document
    if isinstance(document, Mapping):
        raw = dict(document)
        if raw.get("version") != 2:
            raise ValueError("planner 只接受 v2 文档；v1 请先经 ensure_document_version 转换")
        return parse_document(raw)
    raise ValueError("planner 输入必须是 ResumeDocument 或 v2 dict")


def plan_header(header: ResumeHeader, language: str) -> HeaderPlan:
    """页眉：name 行 / name_meta 行 / subtitle 行 / 联系方式的强制换行。"""
    labels = field_labels(language)
    name: list[Inline] = []
    name_meta: list[Inline] = []
    subtitle: list[Inline] = []
    contact_items = []
    photo: str | None = None
    for item in header.items:
        display = item.value
        if item.placement == "name_meta" and item.key == "gender":
            # v1 的「姓名（性别）」口径：gender 在自己的字段里，渲染时套语言括号。
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
            if prefix:
                subtitle.append(Inline(text=prefix + "：", role="meta"))
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
        label_key = _LABELLED_CONTACT.get(item.key)
        display = labels.get(label_key, label_key) + "：" + item.value if label_key else item.value
        current.append(Inline(text=display, role="meta", path="header." + item.id))
    if current:
        lines.append(current)
    return HeaderPlan(
        name=name, name_meta=name_meta, subtitle=subtitle, contact_lines=lines, photo=photo
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
    """条目级覆盖叠在分区默认上的生效列布局（渲染器不再自己算继承）。"""
    return EntryLayout(
        head=entry.layout.head,
        columns=entry.layout.columns or section.layout.columns,
        align=entry.layout.align or section.layout.align,
        gap=entry.layout.gap if entry.layout.gap is not None else section.layout.gap,
        # 分页只带**条目自己的**开关：分区级「另起一页」由渲染器在分区开头处理，
        # 若在这里与分区级取或，会让分区内每个条目都断页（不是生效值的语义）。
        start_on_new_page=bool(entry.layout.start_on_new_page),
        keep_together=bool(entry.layout.keep_together),
    )


def _plan_entry(section: ResumeSection, entry: ResumeEntry, language: str) -> EntryPlan | None:
    layout = _effective_layout(section, entry)
    head_items = [
        item
        for item in entry.items
        if not isinstance(item, TextItem) and item.placement in ("title", "meta")
    ]
    title_items = [item for item in head_items if item.placement == "title"]  # type: ignore[attr-defined]
    meta_items = [item for item in head_items if item.placement == "meta"]  # type: ignore[attr-defined]
    title_segments = _joined_segments(title_items, section.key, entry.id, language, "entry_title")
    meta_segments = _joined_segments(meta_items, section.key, entry.id, language, "meta")
    if not entry.items:
        return None
    entry_id = entry.id or ""
    lead = [
        item for item in entry.items if not isinstance(item, TextItem) and item.placement == "lead"
    ]
    trail = [
        item for item in entry.items if not isinstance(item, TextItem) and item.placement == "trail"
    ]
    return EntryPlan(
        id=entry_id,
        layout=layout,
        head=HeadPlan(
            layout=layout.head,
            title=title_segments,
            meta=meta_segments,
            path=section.key + "." + entry_id,
        ),
        lead_rows=_pack_rows(lead, layout, section.key, entry_id, language),
        body=_body_blocks(entry, section.key, entry_id, language),
        trail_rows=_pack_rows(trail, layout, section.key, entry_id, language),
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
    layout: EntryLayout,
    section_key: str,
    entry_id: str,
    language: str,
) -> list[list[CellPlan]]:
    """lead/trail 装箱：solo 先冲行再独占整行；equal 每行 columns 个；flow 一行顺排。"""
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
            wrap_paren=item.wrap == "paren",
        )
        if not segments:
            continue
        blocks.append(BlockPlan(kind=item.body_style, segments=segments, path=path))
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
                wrap_paren=item.wrap == "paren",
            )
            if segments:
                row.append(CellPlan(segments=segments))
        if row:
            rows.append(row)
    return rows


def plan_to_text(plan: DocumentPlan) -> list[str]:
    """plan 展平成纯文本行（文本等价/对拍/测试用；Markdown/TXT 不直接用这个）。"""
    lines: list[str] = []
    header = plan.header
    header_parts = [
        plain_text(header.name),
        plain_text(header.name_meta),
        plain_text(header.subtitle),
    ]
    header_parts.extend(plain_text(line) for line in header.contact_lines)
    lines.extend(part for part in header_parts if part.strip())
    for section in plan.sections:
        lines.append(section.title)
        for row in section.rows:
            lines.append(" ".join(plain_text(cell.segments) for cell in row))
        for entry in section.entries:
            head = [plain_text(entry.head.title), plain_text(entry.head.meta)]
            lines.extend(part for part in head if part.strip())
            for row in entry.lead_rows:
                lines.append(" ".join(plain_text(cell.segments) for cell in row))
            for block in entry.body:
                lines.append(plain_text(block.segments))
            for row in entry.trail_rows:
                lines.append(" ".join(plain_text(cell.segments) for cell in row))
    return [line for line in lines if line.strip()]

# SPDX-License-Identifier: Apache-2.0
"""Markdown 正文导出（v2 字段级文档模型）。

**口径**：Markdown 是 TXT 的正文来源（txt_exporter 剥标记复用本模块），四个出口必须
说同一件事——分区标题、顺序、每个字段值都来自同一份 DocumentPlan（planner 是字段
位置/顺序的唯一真相），本模块只负责把 plan 展平成 Markdown 行：

* 页眉：姓名 + 姓名附带字段 + 求职意向一行；联系方式一行；
* 分区标题：## 标题（hide_title 时不输出）；
* 条目：### 标题 元信息 → lead 行（- 标签：值）→ 正文（- 要点 / 段落）→ trail 行；
* inline 板块（技能/语言）：一行一条（planner 已拼好条目与分隔符）；
* text 板块（个人总结）：段落 / 要点直出。

入口接受 v1 ResumeContent（读时转换）或 v2 文档/JSON；隐藏条目与 placement=hidden
字段在规划前用 paper_document 剔除，与 HTML / PDF / Word 同一份过滤。
"""

from __future__ import annotations

from ...schemas.resume_document_plan import BlockPlan, DocumentPlan, Inline
from .document_html import coerce_document, join_cell_texts, paper_document
from .resume_labels import DEFAULT_RESUME_LANGUAGE, normalize_language


def _inline_text(segments: list[Inline], *, strong_marks: bool = True) -> str:
    """行内段拼成纯文本；strong 段用 Markdown 加粗（与 HTML 的 strong 对等）。"""
    parts: list[str] = []
    for seg in segments:
        text = str(seg.text or "")
        if not text:
            continue
        if strong_marks and seg.strong and not text.startswith("**"):
            text = "**" + text + "**"
        parts.append(text)
    return "".join(parts)


def _row_text(row, *, cell_separator: str) -> str:
    """一行单元格 → Markdown 行内文本（列之间用列表分隔符连接）。"""
    return cell_separator.join(_inline_text(cell.segments) for cell in row)


def _grid_lines(rows, *, cell_separator: str) -> list[str]:
    """lead / trail 的行：一行一个 Markdown 列表项（planner 已按列布局装箱）。"""
    return ["- " + _row_text(row, cell_separator=cell_separator) for row in rows]


def _body_lines(blocks: list[BlockPlan]) -> list[str]:
    """正文块 → Markdown：要点用短横线前缀，段落原样（空块已由 planner 跳过）。"""
    lines: list[str] = []
    for block in blocks:
        text = _inline_text(block.segments)
        if not text:
            continue
        lines.append("- " + text if block.kind == "bullet" else text)
    return lines


def _entry_lines(entry, *, sep: str) -> list[str]:
    lines: list[str] = []
    head_parts = [
        _inline_text(entry.head.title).strip(),
        _inline_text(entry.head.meta).strip(),
    ]
    head = " ".join(part for part in head_parts if part)
    if head:
        lines.append("### " + head)
    lines.extend(_grid_lines(entry.lead_rows, cell_separator=sep))
    lines.extend(_body_lines(entry.body))
    lines.extend(_grid_lines(entry.trail_rows, cell_separator=sep))
    return lines


def _section_lines(section, *, sep: str) -> list[str]:
    lines: list[str] = []
    if section.title and not section.layout.hide_title:
        lines.append("## " + section.title)
    if section.kind == "inline":
        for row in section.rows:
            text = join_cell_texts(_inline_text(cell.segments) for cell in row)
            if text:
                lines.append("- " + text)
    elif section.kind == "text":
        if section.entries:
            lines.extend(_body_lines(section.entries[0].body))
    else:
        for entry in section.entries:
            lines.extend(_entry_lines(entry, sep=sep))
    return lines


def _header_lines(plan: DocumentPlan, *, sep: str) -> list[str]:
    lines: list[str] = []
    title = _inline_text(plan.header.name).strip()
    # name_meta 的段间空格有语义（英文性别括号前有空格、中文没有），不能用 _inline_text
    # 的逐段 strip 把它吃掉，也不能在拼接时补空格。
    name_meta = "".join(str(seg.text or "") for seg in plan.header.name_meta).strip()
    subtitle = _inline_text(plan.header.subtitle).strip()
    if name_meta:
        # 与 v1 的「姓名（性别）」一致：name_meta 自带语言括号（en 的括号带前导空格），
        # 这里不再额外补空格/不再逐段 strip，否则中文变「林致远 （男）」、英文变「(男)」。
        meta_raw = "".join(str(seg.text or "") for seg in plan.header.name_meta)
        title = (title + meta_raw).strip() if title else meta_raw.strip()
    if subtitle:
        title = title + " · " + subtitle if title else subtitle
    if title:
        lines.append("# " + title)
    for line in plan.header.contact_lines:
        # 行内字段之间用 · 分隔（HTML 靠 CSS 间距、PDF/Word 靠各自的字段分隔符，同义）。
        text = sep.join(
            str(seg.text or "").strip() for seg in line if str(seg.text or "").strip()
        )
        if text:
            lines.append(text)
    return lines


def export_markdown(
    resume,
    *,
    section_order: list[str] | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
    format_config: dict | None = None,
) -> str:
    """导出不包含照片的 Markdown 文本（四个出口的正文同源：同一份 DocumentPlan）。

    section_order 仅为兼容旧调用方保留：v2 的分区顺序在文档的 sections 里，由 converter
    把 v1 的 format_config.section_order 迁进去，渲染器不再自行重排。

    language 决定分区标题/字段标签/分隔符的文案（converter 写入文档、planner 解析），
    与 PDF / Word / HTML 同源；缺省 zh-CN，与历史输出一致。
    """
    resolved_language = normalize_language(language)
    document = paper_document(
        coerce_document(resume, language=resolved_language, format_config=format_config)
    )
    # planner 是字段位置 / 顺序 / 格式化（日期、枚举、作者、列表）的唯一真相。
    from .document_plan import build_document_plan

    plan = build_document_plan(document, format_config, resolved_language)
    sep = " · "
    lines = _header_lines(plan, sep=sep)
    for section in plan.sections:
        section_lines = _section_lines(section, sep=sep)
        if not section_lines:
            continue
        lines.extend(section_lines)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


__all__ = ["export_markdown"]

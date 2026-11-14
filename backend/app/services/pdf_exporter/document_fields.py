# SPDX-License-Identifier: Apache-2.0
"""条目头 / 字段标签的**字段级**绘制：只在该字段有覆盖时才接管。

为什么要单独一层：普通条目的条目头仍走 ``document_render`` 里的既有路径——那条路径被
金样指纹钉着，任何"顺手"的改动都会改 PDF 字节。而字段级排版（``object_roles["<path>:<role>"]``）
只该影响**一个字段**，不能为了它重写普通路径。所以这里做成"检测到差异才接管"：
:func:`draw_field_head` / :func:`draw_label_segments` 返回 ``False`` 时，调用方继续走原路径，
普通条目产物逐字节不变。

两条约定（改之前先看）：

- 取样式先看 ``is_field_path(path)``：字段路径命中才用"这个字段"的覆盖，否则继承条目角色
  （``object_id=entry.id``）——反过来会把条目的设置复制到字段上，表现为"只改了一个字段，
  整条都变了"；
- 接管后仍用同一套字号比例与颜色回退（``_scale`` / ``_color``），不引入第二套口径。
"""

from dataclasses import dataclass
from itertools import groupby

from fpdf.enums import XPos, YPos

from ..resume.document_label_styles import has_styled_labels
from ..resume.field_style_target import is_field_path
from ..resume.resume_inline_style import hex_to_rgb
from ..resume.resume_rich_text import parse_rich_runs
from .fonts import FONT_FAMILY
from .layout import _PX_TO_PT
from .line_break import _ranges
from .meta_lines import sub_gaps
from .style_blocks import _color, _scale


@dataclass(frozen=True)
class _Glyph:
    text: str
    size: float
    bold: bool
    color: tuple[int, int, int]
    width: float
    spacing: float = 0


def _glyphs(pdf, segments, base, query, entry_id, *, meta_ratio=None):
    glyphs = []
    for segment in segments:
        role = segment.role
        target = segment.path if is_field_path(segment.path) else entry_id
        style = query(role, object_id=target)
        ratio = {"entry_title": pdf.layout.entry_title_ratio, "body": 1.0}.get(
            role, meta_ratio or pdf.layout.entry_meta_ratio
        )
        size = base * ratio * _scale(style)
        fallback = pdf.body_text if role in ("entry_title", "body") else pdf.muted_text
        bold_default = style.bold if style and style.bold is not None else role == "entry_title"
        spacing = pdf.layout.gap_mm(float(style.letter_spacing or 0)) if style else 0
        for run in parse_rich_runs(segment.text):
            bold = run.bold or segment.strong or bold_default
            # 行内 `{@size=…,color=…}`：字号既用于 set_font **也用于量宽**——只改绘制不改
            # 量宽的话，折行仍按旧字号算，纸面上会错位。颜色只影响这一段的字形填充。
            run_size = size * (run.size or 1.0)
            color = hex_to_rgb(run.color) or _color(style, fallback)
            pdf.set_font(FONT_FAMILY, "B" if bold else "", run_size * _PX_TO_PT)
            for char in run.readable(with_link=True):
                glyphs.append(
                    _Glyph(
                        char,
                        run_size,
                        bold,
                        color,
                        pdf.get_string_width(char) + spacing,
                        spacing,
                    )
                )
    return glyphs


def _lines(glyphs, width):
    text = "".join(glyph.text for glyph in glyphs)
    return [
        glyphs[start:end] for start, end in _ranges(text, width, [glyph.width for glyph in glyphs])
    ]


def _draw_lines(pdf, lines, left, top, width, *, right=False, center=False):
    y = top
    old_margin = pdf.c_margin
    pdf.c_margin = 0
    try:
        for line in lines:
            height = max((pdf.line_advance(glyph.size) for glyph in line), default=0)
            pdf.set_y(y)
            pdf.ensure_space(height)
            y = pdf.get_y()
            slack = max(0, width - sum(glyph.width for glyph in line))
            x = left + (slack if right else slack / 2 if center else 0)
            for _style, group in groupby(line, key=lambda g: (g.size, g.bold, g.color, g.spacing)):
                group = list(group)
                glyph = group[0]
                run_width = sum(g.width for g in group)
                pdf.set_font(FONT_FAMILY, "B" if glyph.bold else "", glyph.size * _PX_TO_PT)
                pdf.set_text_color(*glyph.color)
                pdf.set_char_spacing(glyph.spacing * pdf.k)
                pdf.set_xy(x, y)
                pdf.cell(
                    run_width,
                    height,
                    "".join(g.text for g in group),
                    new_x=XPos.RIGHT,
                    new_y=YPos.TOP,
                )
                x += run_width
            y += height
    finally:
        pdf.c_margin = old_margin
        pdf.set_char_spacing(0)
    return y - top


def label_lines(pdf, segments, *, base, role_style, width, entry_id=None, ratio=None):
    return _lines(_glyphs(pdf, segments, base, role_style, entry_id, meta_ratio=ratio), width)


def label_height(lines, pdf):
    return sum(max((pdf.line_advance(g.size) for g in line), default=0) for line in lines)


def draw_label_segments(
    pdf,
    segments,
    *,
    base,
    role_style,
    width=None,
    left=None,
    entry_id=None,
    ratio=None,
    align="left",
):
    if not has_styled_labels(segments, role_style, entry_id):
        return False
    width = pdf.frame_width if width is None else width
    left = pdf.frame_left if left is None else left
    lines = label_lines(
        pdf, segments, base=base, role_style=role_style, width=width, entry_id=entry_id, ratio=ratio
    )
    top = pdf.get_y()
    height = _draw_lines(
        pdf, lines, left, top, width, right=align == "right", center=align == "center"
    )
    pdf.set_xy(pdf.frame_left, top + height)
    pdf.set_text_color(*pdf.body_text)
    return True


def draw_field_head(pdf, entry, *, base, role_style, section_key):
    """Return False unless at least one head field differs from its entry role."""
    if role_style is None:
        return False
    head = entry.head
    if not has_styled_labels([*head.title, *head.meta], role_style, entry.id) and not any(
        is_field_path(segment.path)
        and role_style(segment.role, object_id=segment.path)
        != role_style(segment.role, object_id=entry.id)
        for segment in [*head.title, *head.meta]
    ):
        return False
    title = _glyphs(pdf, head.title, base, role_style, entry.id)
    meta = _glyphs(pdf, head.meta, base, role_style, entry.id)
    width = pdf.frame_width
    gap = 2.5
    left_width = min(sum(g.width for g in title) + gap, width * 0.68) if title and meta else width
    title_lines = _lines(
        title, max(1, left_width - gap if meta and head.layout == "split" else width)
    )
    meta_width = max(1, width - left_width) if title and head.layout == "split" else width
    meta_lines = _lines(meta, meta_width)

    def height(lines):
        return sum(max((pdf.line_advance(g.size) for g in line), default=0) for line in lines)

    def gaps(segments):
        styles = [role_style(seg.role, object_id=seg.path) for seg in segments]
        return tuple(
            max(
                (pdf.layout.gap_mm(float(getattr(style, prop) or 0)) for style in styles), default=0
            )
            for prop in ("space_before", "space_after")
        )

    title_before, title_after = gaps(head.title)
    meta_before, meta_after = gaps(head.meta)
    title_height = title_before + height(title_lines) + title_after
    meta_height = meta_before + height(meta_lines) + meta_after
    total = max(title_height, meta_height) if head.layout == "split" else title_height + meta_height
    pdf.ensure_space(total)
    top = pdf.get_y()
    if head.layout == "split":
        _draw_lines(pdf, title_lines, pdf.frame_left, top + title_before, left_width)
        _draw_lines(
            pdf,
            meta_lines,
            pdf.frame_left + (left_width if title else 0),
            top + meta_before,
            meta_width,
            right=not any(
                role_style(seg.role, object_id=seg.path).meta_align == "inline" for seg in head.meta
            ),
        )
    else:
        groups = [(title_lines, title_before, title_height), (meta_lines, meta_before, meta_height)]
        if head.layout == "meta_first":
            groups.reverse()
        offset = 0
        for lines, before, group_height in groups:
            _draw_lines(pdf, lines, pdf.frame_left, top + offset + before, width)
            offset += group_height
    pdf.set_xy(pdf.frame_left, top + total)
    pdf.set_text_color(*pdf.body_text)
    pdf.record(
        kind="entry",
        section=section_key,
        y_top=top,
        object_id=entry.id,
        text="".join(segment.text for segment in head.title),
    )
    return True


def draw_field_flow(pdf, cells, *, base, role_style, entry_id):
    """Use individual field colors in a natural-flow meta row only when changed."""
    segments = [segment for cell in cells for segment in cell.segments]
    if not role_style or (
        not has_styled_labels(segments, role_style, entry_id)
        and not any(
            is_field_path(seg.path)
            and role_style("meta", object_id=seg.path) != role_style("meta", object_id=entry_id)
            for seg in segments
        )
    ):
        return False
    glyphs = _glyphs(
        pdf, segments, base, role_style, entry_id, meta_ratio=pdf.layout.entry_sub_ratio
    )
    lines = _lines(glyphs, pdf.frame_width)
    gap_top, gap_bottom = sub_gaps(pdf.layout, first=True, last=True)
    height = sum(max((pdf.line_advance(g.size) for g in line), default=0) for line in lines)
    pdf.ensure_space(gap_top + height)
    pdf.ln(gap_top)
    top = pdf.get_y()
    _draw_lines(pdf, lines, pdf.frame_left, top, pdf.frame_width)
    pdf.set_xy(pdf.frame_left, top + height + gap_bottom)
    pdf.set_text_color(*pdf.body_text)
    return True


def draw_label_row(pdf, cells, widths, gap, *, base, role_style, entry_id, first, last):
    segments = [seg for cell in cells for seg in cell.segments]
    if not has_styled_labels(segments, role_style, entry_id):
        return False
    if len(cells) > len(widths) or any(w < 8 for w in widths[: len(cells)]):
        return draw_field_flow(pdf, cells, base=base, role_style=role_style, entry_id=entry_id)
    planned = [
        label_lines(
            pdf,
            cell.segments,
            base=base,
            role_style=role_style,
            width=widths[i],
            entry_id=entry_id,
            ratio=pdf.layout.entry_sub_ratio,
        )
        for i, cell in enumerate(cells)
    ]
    gap_top, gap_bottom = sub_gaps(pdf.layout, first=first, last=last)
    height = max((label_height(lines, pdf) for lines in planned), default=0)
    pdf.ensure_space(gap_top + height)
    pdf.ln(gap_top)
    top, left = pdf.get_y(), pdf.frame_left
    for i, lines in enumerate(planned):
        _draw_lines(pdf, lines, left, top, widths[i])
        left += widths[i] + (
            gap[i]
            if isinstance(gap, (list, tuple)) and i < len(gap)
            else 0
            if isinstance(gap, (list, tuple))
            else gap
        )
    pdf.set_xy(pdf.frame_left, top + height + gap_bottom)
    pdf.set_text_color(*pdf.body_text)
    return True

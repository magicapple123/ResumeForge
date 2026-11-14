# SPDX-License-Identifier: Apache-2.0
"""Word 里"条目头按字段拆开画"的那条路：只在字段有覆盖时才接管。

为什么单独：普通条目的条目头由 ``docx_document_parts.draw_header`` 一次画完，产物被金样
指纹钉着；字段级覆盖只影响一个字段，不能为了它改普通路径。这里的返回值就是开关——
``False`` = 调用方继续走原路径，普通条目字节不变。

两个细节：
- 标题与灰字仍用"右对齐制表位"分隔（与普通路径同一几何）；只有 ``meta_align=inline``
  时才退化成 `` · `` 连接；
- 逐段应用字段间距（``apply_field_spacing``）：字段有自己的段前/段后时，必须落在承载这个
  字段的 run 上，落在整段会把间距叠加成两倍。
"""

from docx.enum.text import WD_TAB_ALIGNMENT
from docx.shared import Mm

from .docx_blocks import paragraph
from .docx_document_body import apply_field_spacing
from .pdf_exporter.layout import PAGE_WIDTH_MM
from .resume.document_label_styles import has_styled_labels
from .resume.field_style_target import is_field_path


def draw_field_split_head(doc, entry, *, base, layout, theme, role_style, space_before_mm):
    from .docx_document_parts import add_segments, style_of

    segments = [*entry.head.title, *entry.head.meta]
    if not has_styled_labels(segments, role_style, entry.id) and not any(
        (
            is_field_path(seg.path)
            and style_of(role_style, seg.role, seg.path) != style_of(role_style, seg.role, entry.id)
        )
        for seg in segments
    ):
        return False
    title_style = style_of(role_style, "entry_title", entry.id)
    extra = layout.gap_mm(float(title_style.space_before or 0)) if title_style else 0
    node = paragraph(
        doc, space_before_mm=layout.gap_mm(0.2) + space_before_mm + extra, keep_with_next=True
    )
    add_segments(
        node,
        entry.head.title,
        base=base,
        layout=layout,
        theme=theme,
        role_style=role_style,
        default_role="entry_title",
        object_id=entry.id,
        bold_default=True,
    )
    if entry.head.meta:
        meta_style = style_of(role_style, "meta", entry.id)
        if meta_style and meta_style.meta_align == "inline":
            node.add_run(" · ")
        else:
            node.paragraph_format.tab_stops.add_tab_stop(
                Mm(PAGE_WIDTH_MM - layout.margin_left - layout.margin_right), WD_TAB_ALIGNMENT.RIGHT
            )
            node.add_run("\t")
        add_segments(
            node,
            entry.head.meta,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            default_role="meta",
            object_id=entry.id,
        )
    for segment in segments:
        if is_field_path(segment.path):
            apply_field_spacing(node, style_of(role_style, segment.role, segment.path), layout)
    return True

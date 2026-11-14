# SPDX-License-Identifier: Apache-2.0
"""Word 正文块：批量项目符号 vs 逐块重画，以及字段级段距的落点。

为什么要分两条路：

- 连续的项目符号先攒成一批交给 ``docx_blocks.bullets``：它一次建好列表缩进与符号，
  逐条建会得到 N 份互不相干的缩进；
- 一旦某条正文有自己的字段样式或行内标记，就必须先把攒着的那批 ``flush()`` 掉，再用
  ``add_segments`` 逐段画（并从 bullets 生成的段落里剥掉占位 run）——否则样式会作用到
  整批项目符号上。

``apply_field_spacing`` 只改承载该字段的段落：字段有自己的段前/段后时，落错层级会把间距
叠加到整段（Word 的 paragraph spacing 不继承，重复设置就是两倍）。
"""

from collections.abc import Sequence

from docx.shared import Mm

from ..schemas.resume_document_plan import BlockPlan
from .docx_blocks import bullets, paragraph
from .pdf_exporter.layout import _PX_TO_MM
from .resume.document_label_styles import has_styled_labels
from .resume.field_style_target import is_field_path


def draw_blocks(
    doc,
    blocks: Sequence[BlockPlan],
    *,
    base: float,
    layout,
    theme,
    role_style,
    object_id: str | None,
) -> None:
    # Compatibility facade owns inline helpers; resolve after module initialization.
    from .docx_document_parts import add_segments, align_value, rich_text, style_of

    body_style = style_of(role_style, "body", object_id)
    pending: list[str] = []
    pending_style = body_style

    def flush() -> None:
        if not pending:
            return
        start = len(doc.paragraphs)
        bullets(
            doc,
            list(pending),
            base=base,
            indent_mm=layout.gap_mm(layout.li_indent),
            theme=theme,
            style=pending_style,
        )
        if pending_style != body_style:
            for node in doc.paragraphs[start:]:
                apply_field_spacing(node, pending_style, layout)
        pending.clear()

    for block in blocks:
        text = rich_text(block.segments).strip()
        if not text:
            continue
        block_style = (
            style_of(role_style, "body", block.path) if is_field_path(block.path) else body_style
        )
        if block.kind == "bullet":
            if has_styled_labels(block.segments, role_style, object_id):
                flush()
                bullets(
                    doc,
                    [text],
                    base=base,
                    indent_mm=layout.gap_mm(layout.li_indent),
                    theme=theme,
                    style=block_style,
                )
                node = doc.paragraphs[-1]
                prefix = node.text[: -len(text)]
                first = node.runs[0]
                first.text = prefix
                for run in node.runs[1:]:
                    node._p.remove(run._r)
                add_segments(
                    node,
                    block.segments,
                    base=base,
                    layout=layout,
                    theme=theme,
                    role_style=role_style,
                    default_role="body",
                    object_id=object_id,
                )
                if block_style != body_style:
                    apply_field_spacing(node, block_style, layout)
                continue
            if block_style != pending_style:
                flush()
                pending_style = block_style
            pending.append(text)
            continue
        flush()
        indent_mm = (
            base * _PX_TO_MM * float(block_style.indent)
            if block_style and block_style.indent is not None
            else 0.0
        )
        node = paragraph(doc, indent_mm=indent_mm, keep_together=True)
        if block_style and block_style.align is not None:
            node.paragraph_format.alignment = align_value(block_style.align)
        if block_style and block_style.line_height:
            node.paragraph_format.line_spacing = float(block_style.line_height)
        if block_style != body_style:
            apply_field_spacing(node, block_style, layout)
        add_segments(
            node,
            block.segments,
            base=base,
            layout=layout,
            theme=theme,
            role_style=role_style,
            default_role="body",
            object_id=object_id,
        )
    flush()


def apply_field_spacing(node, style, layout) -> None:
    if style is None:
        return
    for prop, target in (("space_before", "space_before"), ("space_after", "space_after")):
        value = getattr(style, prop, None)
        if value is not None:
            setattr(node.paragraph_format, target, Mm(layout.gap_mm(float(value))))

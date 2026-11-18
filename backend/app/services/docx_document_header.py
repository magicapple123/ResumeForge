# SPDX-License-Identifier: Apache-2.0
"""Word 渲染的**页眉**专用件（v2）：姓名 / 性别 / 求职意向 / 联系方式行。

为什么从 `docx_document_parts.py` 拆出来：那个文件当时是 499 行，而 I-03 要在
`draw_header` 里加字段级样式取值，**加任何一行都破 500 行预算**（项目硬闸门，不许写豁免）。
拆分取「页眉 vs 其余」这条现成的语义边界——`draw_cell_rows` 与各类工具函数留在原文件，
本文件单向依赖它，没有循环。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import partial
from io import BytesIO

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Mm

from ..schemas.resume_document_plan import DocumentPlan, Inline
from .docx_blocks import (
    DocxTheme,
    decorate_paragraph,
    float_picture,
    paragraph,
    set_run_font,
)
from .docx_column_geometry import apply_column_geometry as apply_column_geometry
from .docx_decorate import border_sz_from_px
from .docx_document_body import draw_blocks as draw_blocks

# 这三个是原 `docx_document_parts` 里的模块级工具，拆分后仍留在那边；
# 单向依赖（header → parts），没有循环。
from .docx_document_parts import _has_header_field_style, add_segments, plain_text
from .docx_photo import outline_picture
from .docx_rich import add_rich_runs
from .docx_text_measure import make_text_measure
from .pdf_exporter import _PX_TO_PT, PAGE_WIDTH_MM, _photo_bytes, fit_photo_size
from .pdf_exporter.theme import _hex_to_rgb
from .resume.document_label_styles import has_styled_labels
from .resume.resume_contact import WORD_SEPARATOR, contact_field_groups, pack_contact_lines
from .resume.resume_header_style import name_block_styles
from .resume.resume_style import RoleStyle, clamp_letter_spacing

logger = logging.getLogger(__name__)

#: 毫米 → 磅（1pt = 25.4/72 mm）。Word 的段落边框 `space` 只认磅。
_MM_TO_PT = 72.0 / 25.4

#: 角色/对象覆盖查询函数（与 PDF / HTML 同一形态）；None = 模板默认。
RoleStyleQuery = Callable[..., RoleStyle | None]

_ALIGN = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


def draw_header(
    doc,
    plan: DocumentPlan,
    *,
    layout,
    base: float,
    include_photo: bool,
    theme: DocxTheme,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
    font_key: str | None = None,
    role_style: RoleStyleQuery | None = None,
) -> None:
    """页眉：姓名 + 姓名附带字段 + 意向 + 联系方式（planner 已给好每行）+ 浮动照片。

    `font_key` 是这份简历选的字体键（`format_config` 的字体项）：联系方式装行要用它
    解析字体文件来量文本宽度（与 PDF 同一条解析链），不传则跟随当前全局字体/系统候选。
    """
    set_font = partial(set_run_font, font_name=theme.font_name)
    name_text = plain_text(plan.header.name)
    meta_text = plain_text(plan.header.name_meta)
    subtitle_text = plain_text(plan.header.subtitle)

    # I-03：姓名/性别不再写死 `bold=True` / `accent` / `name_ratio`。
    # 之前 Word 侧连角色级样式都没用（联系方式与副标题在同一函数里却查了），
    # 于是"把姓名改红"在草稿生效、导出的 Word 里完全没反应。
    # 无覆盖时的空查询：接受 `field_only` 等关键字，与真实查询函数同形。
    style = role_style or (lambda role, object_id=None, **_kwargs: None)
    name_style, gender_style = name_block_styles(plan.header, style)
    name_bold = name_style.bold if name_style is not None and name_style.bold is not None else True
    name_scale = (
        float(name_style.font_scale) if name_style is not None and name_style.font_scale else 1.0
    )
    name_color = (
        _hex_to_rgb(str(name_style.color)) if name_style is not None and name_style.color else None
    ) or accent
    gender_scale = (
        float(gender_style.font_scale)
        if gender_style is not None and gender_style.font_scale
        else 1.0
    )
    gender_color = (
        _hex_to_rgb(str(gender_style.color))
        if gender_style is not None and gender_style.color
        else None
    ) or theme.muted_text
    # I-41：字距只在 `name` 角色上存在（角色白名单不含 meta），单位与 PDF 同源
    # （`base × 系数 × _PX_TO_PT`），负值走同一条 -0.1em 下限夹取。
    name_letter_spacing_pt = (
        base * float(clamp_letter_spacing(name_style.letter_spacing) or 0.0) * _PX_TO_PT
        if name_style is not None
        else 0.0
    )
    # I-42：性别段的字重也取合并结果（默认 False = 历史行为）。
    gender_bold = (
        gender_style.bold if gender_style is not None and gender_style.bold is not None else False
    )

    name_node = paragraph(doc)
    header_paragraphs = [name_node]
    if name_text:
        add_rich_runs(
            name_node,
            name_text,
            set_font,
            bold=name_bold,
            size_pt=base * layout.name_ratio * name_scale * _PX_TO_PT,
            color=name_color,
            letter_spacing_pt=name_letter_spacing_pt or None,
        )
    if meta_text:
        add_rich_runs(
            name_node,
            "　" + meta_text,
            set_font,
            bold=gender_bold,
            size_pt=base * layout.name_extra_ratio * gender_scale * _PX_TO_PT,
            color=gender_color,
        )

    photo = _photo_bytes(plan.header.photo) if (plan.header.photo and include_photo) else None
    # 照片栏宽度（mm）：装行时要从可用宽度里扣掉，与 PDF 的 `text_width = inner - photo_box`
    # 同口径。照片坏了/没有时为 0。
    photo_box_mm = 0.0
    if photo:
        try:
            photo_w = layout.gap_mm(layout.photo_width_ratio)
            photo_h = layout.gap_mm(layout.photo_height_ratio)
            draw_w, draw_h = fit_photo_size(photo, photo_w, photo_h)
            picture_run = name_node.add_run()
            picture_run.add_picture(BytesIO(photo), width=Mm(draw_w))
            # R-10：偏移换算成"照片左沿相对版心左缘"的绝对位置；没设偏移时仍走
            # align（旧产物的 XML 逐字节不变）。
            header_left = float(layout.margin_left) + layout.gap_mm(layout.header_pad_x)
            inner_width_mm = (
                PAGE_WIDTH_MM
                - float(layout.margin_left)
                - float(layout.margin_right)
                - 2 * layout.gap_mm(layout.header_pad_x)
            )
            natural_x = (
                header_left
                if layout.header_photo_side == "left"
                else header_left + inner_width_mm - photo_w
            )
            shifted_x = min(
                max(natural_x + layout.photo_offset_x, header_left),
                header_left + inner_width_mm - photo_w,
            )
            float_picture(
                picture_run,
                align="left" if layout.header_photo_side == "left" else "right",
                vertical_offset_mm=max(0.0, (photo_h - draw_h) / 2) + layout.photo_offset_y,
                horizontal_offset_mm=(
                    None
                    if abs(layout.photo_offset_x) < 1e-6
                    else shifted_x - float(layout.margin_left)
                ),
            )
            # R-07：边框与圆角（与 PDF 的 rect 同口径；边框贴图片而不是照片框，
            # 因为 Word 的图片边框只能作用于图片本身——已在报告里披露）。
            if layout.photo_border_width > 0:
                outline_picture(
                    picture_run,
                    width_px=layout.photo_border_width,
                    color_hex=layout.photo_border_color or theme.line_text,
                    radius_px=layout.photo_radius,
                    width_mm=draw_w,
                    height_mm=draw_h,
                )
            photo_box_mm = photo_w + 6
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            logger.warning("简历照片无法写入 Word，已跳过", exc_info=True)

    if subtitle_text:
        subtitle_node = paragraph(doc)
        header_paragraphs.append(subtitle_node)
        if has_styled_labels(plan.header.subtitle, role_style):
            add_segments(
                subtitle_node,
                plan.header.subtitle,
                base=base,
                layout=layout,
                theme=theme,
                role_style=role_style,
                default_role="meta",
                ratio_override=layout.intent_ratio,
            )
        else:
            add_rich_runs(
                subtitle_node,
                subtitle_text,
                set_font,
                size_pt=base * layout.intent_ratio * _PX_TO_PT,
                color=theme.muted_text,
            )

    # 联系方式：与 PDF 同一套装行算法（2026-11 #9）。QW-6：planner 把「电话：」与号码拆成两段
    # （同路径），必须**按字段**合并后再装行，否则标签与值之间会多出一个分隔符。
    contact_fields = [
        [field for field in contact_field_groups(line) if plain_text(field)]
        for line in plan.header.contact_lines
    ]
    contact_fields = [group for group in contact_fields if group]
    contact_groups = [[plain_text(field) for field in group] for group in contact_fields]
    packed: list[list[str]] = []
    flat: list[list[Inline]] = []  # 装行后的扁平字段（按段写 run 时按行切）
    styled_contact = _has_header_field_style(plan.header, role_style)
    if contact_groups:
        # 可用宽度 = 版心宽 − 页头左右内边距（PDF 的 inner_width）− 照片栏。
        contact_width_mm = (
            PAGE_WIDTH_MM
            - float(layout.margin_left)
            - float(layout.margin_right)
            - 2 * layout.gap_mm(layout.header_pad_x)
            - photo_box_mm
        )
        measure = make_text_measure(base * layout.contact_ratio, font_key)
        separator = plan.header.contact_separator or WORD_SEPARATOR
        packed = pack_contact_lines(contact_groups, contact_width_mm, measure, separator)
        flat = [field for group in contact_fields for field in group]
    else:
        separator = plan.header.contact_separator or WORD_SEPARATOR
    if packed:
        contact_node = paragraph(doc)
        header_paragraphs.append(contact_node)
        offset = 0  # 当前行在 flat 里的起点
        for index, line in enumerate(packed):
            if index:
                contact_node.add_run().add_break()
            if not styled_contact:
                add_rich_runs(
                    contact_node,
                    separator.join(line),
                    set_font,
                    size_pt=base * layout.contact_ratio * _PX_TO_PT,
                    color=theme.muted_text,
                )
                continue
            fields_here = flat[offset : offset + len(line)]
            offset += len(line)
            for position, field in enumerate(fields_here):
                if position:
                    add_rich_runs(
                        contact_node,
                        separator,
                        set_font,
                        size_pt=base * layout.contact_ratio * _PX_TO_PT,
                        color=theme.muted_text,
                    )
                add_segments(
                    contact_node,
                    field,
                    base=base,
                    layout=layout,
                    theme=theme,
                    role_style=role_style,
                    default_role="meta",
                    ratio_override=layout.contact_ratio,
                )

    # 页头底色块（modern 的浅色块）：三段各加同色底纹，段距为 0 时连成一整块。
    if getattr(layout, "header_bg", "none") == "soft_accent":
        for node in header_paragraphs:
            decorate_paragraph(
                node,
                fill=accent_soft,
                edges=("top", "left", "bottom", "right"),
                border_color=accent_soft,
                border_sz=4,
                space_pt=6,
            )

    # 页头底边线（1-A）：`header_border_width` / `header_border_color` / `header_pad_bottom`
    # 早就在 `resolve_layout()` 的返回值里，PDF 画了、Word 没读（同一份简历，PDF 在联系方式
    # 下方有一条 2px 强调色横线，Word 直接接到「实习/工作经历」）。2px ≈ 1.5pt ≈ `w:sz=12`。
    # `soft_accent` 色块（modern / split）不叠线：它们的 `header_border_width` 本来就是 0。
    border_width_px = float(getattr(layout, "header_border_width", 0.0) or 0.0)
    if border_width_px > 0 and getattr(layout, "header_bg", "none") != "soft_accent":
        decorate_paragraph(
            header_paragraphs[-1],
            edges=("bottom",),
            border_color=_hex_to_rgb(str(getattr(layout, "header_border_color", ""))) or accent,
            border_sz=border_sz_from_px(border_width_px),
            # I-31：段落底边框的 space 加上用户微调（mm → pt），与草稿/PDF 同口径。
            space_pt=base * float(getattr(layout, "header_pad_bottom", 0.0) or 0.0) * _PX_TO_PT
            + float(getattr(layout, "header_rule_gap", 0.0) or 0.0) * _MM_TO_PT,
        )

# SPDX-License-Identifier: Apache-2.0
"""PDF 页头绘制（v2）：HeaderPlan → 姓名 / 姓名附带字段 / 意向 / 联系方式 / 照片 / 装饰。

## 为什么单独成文件

`document_render.py` 贴着 500 行生产代码预算，而页头是"版式计算 + 照片 + 三段文字 +
装饰"的四合一：它既不属于哪个分区，也不该把主绘制流程顶过线。

## 与预览对齐的三条硬约束（改这里之前先读）

1. **照片按原图比例装进照片框**（object-fit: contain）：不能再按框比例 cover 裁切——
   服务端已经按 format_config.photo_crop 派生过裁剪图，再裁一次用户就看不到取景。
2. **联系方式是"整字段不拆行、字段之间可换行"**：planner 已按 contact_breaks 分好行并
   给好每个字段的展示文本（含「GitHub：」这类前缀），这里只负责按宽度装行——
   multi_cell 会在超宽处按字符劈开，长网址被截成两行正是用户截图里的问题。
3. **空字段零输出**：没有意向 / 没有联系方式 / 没有照片时，页头高度与底边线位置都按
   "没有这一段"算。

页头内部的所有文案（含字段前缀）都来自 planner；本模块不再读语言包，也就不会出现
"HTML 有 GitHub、PDF 没有"这种四个出口各拼一套的分叉。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from io import BytesIO

from fpdf.enums import XPos, YPos

from ...schemas.resume_document_plan import HeaderPlan
from ..resume.resume_contact import PDF_SEPARATOR, pack_contact_lines

# 别名导入：本模块的 RoleStyle 是"查询函数"的类型别名（见下），与同名 dataclass 不同义。
from ..resume.resume_style import RoleStyle as _RoleStyle
from .canvas import _ResumePDF
from .document_fields import draw_label_segments, has_styled_labels, label_height, label_lines
from .fonts import FONT_FAMILY
from .layout import _PX_TO_MM, _PX_TO_PT, PAGE_WIDTH_MM
from .media import _photo_bytes, fit_photo_size
from .name_gender import draw_name_gender, plan_name_gender
from .style_blocks import parse_color

logger = logging.getLogger(__name__)

#: 角色/对象覆盖的查询函数：role_style(role, object_id=None)，无覆盖返回 None。
RoleStyle = Callable[..., _RoleStyle | None]


def _plain(segments) -> str:
    """行内段拼成页头上的一段纯文本（页头的姓名/意向不做逐段样式，整段统一字号）。"""
    return "".join(str(getattr(seg, "text", "") or "") for seg in segments).strip()


def _contact_segment_text(segment) -> str:
    """联系方式里**单个字段段**的展示文本：字段之间由 `PDF_SEPARATOR` 分隔，不能再 join 掉。"""
    return str(getattr(segment, "text", "") or "").strip()


def _pack_contact_lines(
    pdf: _ResumePDF,
    groups: list[list[str]],
    width: float,
    separator: str = PDF_SEPARATOR,
) -> list[str]:
    """把联系方式按字段装行：字段整体换行，**绝不拆字段内部**。

    groups 是 planner 分好的行（每行是若干字段文本）；行内字段之间用 PDF_SEPARATOR
    （与历史输出一致的四空格）。单个字段本身比整行还宽时也让它独占一行并如实溢出：
    字段内不折行是硬约束（HTML 的 white-space: nowrap 同义）。

    **2026-11 #9**：贪心循环已抽到 `resume.resume_contact.pack_contact_lines`，Word 侧
    传字体度量、这里传画布度量，两端行分布因此只差字体本身——不再各写一份装行。
    """
    packed = pack_contact_lines(groups, width, pdf.rich_text_width, separator)
    return [separator.join(line) for line in packed]


def draw_header(
    pdf: _ResumePDF,
    header: HeaderPlan,
    *,
    layout,
    base: float,
    include_photo: bool,
    role_style: RoleStyle | None,
) -> None:
    """画出整块页头，并把画布 y 移到页头底部（后续分区从那里开始）。

    include_photo=False 时连照片预留空间都不给：导出选项里关掉照片意味着这一版内容就
    没有照片，页头高度与后面的分页都要按"无照片"来算。
    """
    style = role_style or (lambda role, object_id=None: None)
    name_text = _plain(header.name)
    name_meta_text = _plain(header.name_meta)
    subtitle_text = _plain(header.subtitle)
    # planner 的 contact_lines 是"每行若干字段段"；这里必须**按段**保留分隔符再交给
    # `_pack_contact_lines` 装行。整行 `"".join` 会把字段粘成一串（2026-10-30 实机六出口
    # 检查：PDF 页头 "138-0000-0000zhang@example.com上海2001"，HTML / Word 正常）。
    contact_groups = [
        [text for text in (_contact_segment_text(segment) for segment in line) if text]
        for line in header.contact_lines
    ]

    photo_w = layout.gap_mm(layout.photo_width_ratio)
    photo_h = layout.gap_mm(layout.photo_height_ratio)
    hdr_pad_x = layout.gap_mm(layout.header_pad_x)
    hdr_pad_y = layout.gap_mm(layout.header_pad_y)
    hdr_pad_bottom = layout.gap_mm(layout.header_pad_bottom)
    hdr_radius = layout.gap_mm(layout.header_radius)
    hdr_border_w = layout.header_border_width * _PX_TO_MM
    header_has_bg = layout.header_bg == "soft_accent"

    header_top = pdf.get_y()
    content_left = layout.margin_x + hdr_pad_x
    content_right = PAGE_WIDTH_MM - layout.margin_right - hdr_pad_x
    content_top = header_top + hdr_pad_y
    inner_width = pdf.content_width - 2 * hdr_pad_x

    photo = _photo_bytes(header.photo) if (header.photo and include_photo) else None
    photo_draw_w = photo_draw_h = 0.0
    if photo:
        try:
            photo_draw_w, photo_draw_h = fit_photo_size(photo, photo_w, photo_h)
        except Exception:  # noqa: BLE001 - 坏图不能阻断导出（下面按"无照片"处理）
            logger.warning("简历照片无法读取尺寸，已跳过")
            photo = None
    photo_left = bool(photo) and layout.header_photo_side == "left"
    photo_box = photo_w + 6 if photo else 0.0
    text_width = inner_width - photo_box
    text_left = content_left + photo_box if photo_left else content_left
    header_centered = layout.header_align == "center"
    header_text_align = "C" if header_centered else "L"

    name_style = style("name")
    meta_style = style("meta")
    name_scale = (
        float(name_style.font_scale) if name_style is not None and name_style.font_scale else 1.0
    )
    meta_scale = (
        float(meta_style.font_scale) if meta_style is not None and meta_style.font_scale else 1.0
    )
    name_size = base * layout.name_ratio * name_scale
    extra_size = base * layout.name_extra_ratio
    name_color = (
        parse_color(name_style.color) if name_style is not None and name_style.color else None
    )
    name_bold = name_style.bold if name_style is not None and name_style.bold is not None else True
    meta_color = (
        parse_color(meta_style.color) if meta_style is not None and meta_style.color else None
    )

    contact_size = base * layout.contact_ratio * meta_scale
    contact_lines: list[str] = []
    if contact_groups:
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        contact_lines = _pack_contact_lines(
            pdf,
            contact_groups,
            text_width,
            # planner 给了可见分隔文本（bar/dot）就用它，否则沿用历史的四空格。
            header.contact_separator or PDF_SEPARATOR,
        )

    # 先量页头正文高度（不落笔）：modern 的底色块按它定尺寸、画在文字之下。
    if name_text:
        name_plan = plan_name_gender(
            pdf,
            name_text,
            name_meta_text,
            width=text_width,
            name_size=name_size,
            extra_size=extra_size,
        )
        text_height = name_plan.height
    else:
        name_plan = None
        text_height = 0.0
    if subtitle_text:
        text_height += layout.gap_mm(layout.intent_gap)
        if has_styled_labels(header.subtitle, role_style):
            text_height += label_height(
                label_lines(
                    pdf,
                    header.subtitle,
                    base=base,
                    role_style=role_style,
                    width=text_width,
                    ratio=layout.intent_ratio,
                ),
                pdf,
            )
        else:
            text_height += pdf.text_block_height(
                subtitle_text, width=text_width, size_px=base * layout.intent_ratio * meta_scale
            )
    if contact_lines:
        text_height += layout.gap_mm(layout.contact_gap)
        text_height += len(contact_lines) * pdf.line_advance(contact_size)
    photo_span = photo_h if photo else 0.0
    header_content_h = max(text_height, photo_span)

    if header_has_bg:
        pdf.set_fill_color(*pdf.accent_soft)
        pdf.rect(
            layout.margin_x,
            header_top,
            pdf.content_width,
            hdr_pad_y + header_content_h + hdr_pad_y,
            style="F",
            round_corners=hdr_radius > 0,
            corner_radius=hdr_radius,
        )

    if photo:
        try:
            # R-10：偏移作用在**照片框**上（与 HTML 的 `transform: translate()` 同义），
            # 夹紧到页头范围内——偏移再大也不会把照片推出纸张或压到标题上沿。
            box_x = content_left if photo_left else content_right - photo_w
            box_x += layout.photo_offset_x
            box_x = min(
                max(box_x, layout.margin_x + hdr_pad_x),
                layout.margin_x + pdf.content_width - hdr_pad_x - photo_w,
            )
            box_y = content_top + layout.photo_offset_y
            box_y = min(max(box_y, header_top + hdr_pad_y), header_top + header_content_h)
            pdf.image(
                BytesIO(photo),
                x=box_x + (photo_w - photo_draw_w) / 2,
                y=box_y + (photo_h - photo_draw_h) / 2,
                w=photo_draw_w,
                h=photo_draw_h,
            )
            # R-07：边框与圆角。默认值（1px / 模板线色 / 4px）与模板 CSS 的
            # `.profile-photo` 一致，所以默认态三个出口终于画的是同一个框。
            border_px = float(getattr(layout, "photo_border_width", 1) or 0)
            if border_px > 0:
                border_color = parse_color(layout.photo_border_color or "") or pdf.line_color
                radius_px = float(getattr(layout, "photo_radius", 4) or 0)
                radius_mm = radius_px * _PX_TO_MM
                # fpdf2 的 `rect()` 不接受 `color` / `width` 关键字（会抛 TypeError），
                # 画笔颜色与线宽必须先用 set_* 设出来，画完再还原——否则后面的分隔线
                # 会跟着变成照片边框的颜色与粗细。
                # `pdf.draw_color` 在 fpdf2 里可能是 DeviceGray 等对象（不可解包），
                # 所以还原一律回到这一页一直在用的线色，而不是"读回来的旧值"。
                saved_width = pdf.line_width
                pdf.set_draw_color(*border_color)
                pdf.set_line_width(border_px * _PX_TO_MM)
                pdf.rect(
                    box_x,
                    box_y,
                    photo_w,
                    photo_h,
                    style="D",
                    round_corners=radius_mm > 0,
                    corner_radius=radius_mm,
                )
                pdf.set_draw_color(*pdf.line_color)
                pdf.set_line_width(saved_width)
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            logger.warning("简历照片无法写入 PDF，已跳过", exc_info=True)

    pdf.set_y(content_top)
    pdf.set_x(text_left)
    if name_plan is not None:
        draw_name_gender(
            pdf,
            name_text,
            name_plan,
            width=text_width,
            name_size=name_size,
            extra_size=extra_size,
            align=layout.header_align,
            name_color=name_color,
            name_bold=bool(name_bold),
        )
    pdf.set_text_color(*pdf.body_text)
    if subtitle_text:
        subtitle_size = base * layout.intent_ratio * meta_scale
        pdf.set_font(FONT_FAMILY, "", subtitle_size * _PX_TO_PT)
        pdf.set_text_color(*(meta_color or pdf.muted_text))
        if name_plan is not None:
            pdf.ln(layout.gap_mm(layout.intent_gap))
        pdf.set_x(text_left)
        if not draw_label_segments(
            pdf,
            header.subtitle,
            base=base,
            role_style=role_style,
            width=text_width,
            left=text_left,
            ratio=layout.intent_ratio,
            align="center" if header_centered else "left",
        ):
            pdf.multi_cell(
                text_width,
                pdf.line_advance(subtitle_size),
                subtitle_text,
                align=header_text_align,
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
    if contact_lines:
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        pdf.set_text_color(*(meta_color or pdf.muted_text))
        if name_plan is not None or subtitle_text:
            pdf.ln(layout.gap_mm(layout.contact_gap))
        contact_line_height = pdf.line_advance(contact_size)
        for contact_line in contact_lines:
            x = text_left
            if header_centered:
                x += max(0.0, (text_width - pdf.rich_text_width(contact_line)) / 2)
            pdf.set_x(x)
            pdf.cell(
                text_width,
                contact_line_height,
                contact_line,
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
    pdf.set_text_color(*pdf.body_text)

    header_bottom = max(pdf.get_y(), content_top + photo_span)
    if header_has_bg:
        header_bottom += hdr_pad_y
    if hdr_border_w > 0:
        header_bottom += hdr_pad_bottom
        line_y = header_bottom
        pdf.set_draw_color(*pdf.accent)
        pdf.set_line_width(hdr_border_w)
        pdf.line(layout.margin_left, line_y, PAGE_WIDTH_MM - layout.margin_right, line_y)
    pdf.set_y(header_bottom)


__all__ = ["draw_header"]

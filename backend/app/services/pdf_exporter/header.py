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

from ...schemas.resume_document_plan import HeaderPlan, Inline
from ..resume.field_style_target import is_field_path
from ..resume.resume_contact import (
    PDF_SEPARATOR,
    contact_field_groups,
    contact_field_texts,
    pack_contact_lines,
)
from ..resume.resume_header_style import name_block_styles

# 别名导入：本模块的 RoleStyle 是"查询函数"的类型别名（见下），与同名 dataclass 不同义。
from ..resume.resume_style import RoleStyle as _RoleStyle
from ..resume.resume_style import clamp_letter_spacing
from .canvas import _ResumePDF
from .document_fields import (
    _draw_lines,
    _glyphs,
    _lines,
    draw_label_segments,
    has_styled_labels,
    label_height,
    label_lines,
)
from .fonts import FONT_FAMILY
from .layout import _PX_TO_MM, _PX_TO_PT, PAGE_WIDTH_MM
from .media import _photo_bytes, fit_photo_size
from .name_gender import draw_name_gender, plan_name_gender
from .style_blocks import parse_color

logger = logging.getLogger(__name__)

#: I-29：页眉线让开照片时的端点内缩。圆角照片的角是空的，紧贴会像线插进照片里。
_PHOTO_LINE_GAP_MM = 0.5
#: 让开之后短于这个长度的线段直接丢弃：画出来只是一个小点，反而像脏。
_MIN_LINE_SEGMENT_MM = 2.0


def _line_segments_around_photo(
    x_start: float,
    x_end: float,
    line_y: float,
    photo_rect: tuple[float, float, float, float] | None,
) -> list[tuple[float, float]]:
    """把一条横线按"让开照片"拆成若干段（纯函数，几何可直接测）。

    ``photo_rect`` 是 ``(x, y, w, h)``：只有照片真的画出来了才有值。线不在照片的
    纵向区间内时原样返回整条；在区间内就左右各让 0.5mm，过短的段丢掉。
    """
    if photo_rect is None:
        return [(x_start, x_end)]
    box_x, box_y, photo_w, photo_h = photo_rect
    if not (box_y <= line_y <= box_y + photo_h):
        return [(x_start, x_end)]
    candidates = (
        (x_start, min(box_x - _PHOTO_LINE_GAP_MM, x_end)),
        (max(box_x + photo_w + _PHOTO_LINE_GAP_MM, x_start), x_end),
    )
    return [(start, end) for start, end in candidates if end - start >= _MIN_LINE_SEGMENT_MM]

#: 角色/对象覆盖的查询函数：role_style(role, object_id=None)，无覆盖返回 None。
RoleStyle = Callable[..., _RoleStyle | None]


def _plain(segments) -> str:
    """行内段拼成页头上的一段纯文本（页头的姓名/意向不做逐段样式，整段统一字号）。"""
    return "".join(str(getattr(seg, "text", "") or "") for seg in segments).strip()


def _has_header_field_style(header: HeaderPlan, style: RoleStyle) -> bool:
    """页眉字段是否有**字段级**覆盖（与角色层不同才算）。

    这个判据决定走哪条绘制路径：没有字段级覆盖时继续用"整行字符串 + cell"，
    PDF 产物逐字节不变；有覆盖时改用按段的 glyph 渲染，标签段与值段各取自己的样式。
    """
    for line in header.contact_lines:
        for segment in line:
            if not is_field_path(segment.path):
                continue
            if style(segment.role, object_id=segment.path) != style(segment.role):
                return True
    return False


def _contact_glyph_lines(
    pdf: _ResumePDF,
    header: HeaderPlan,
    *,
    base: float,
    style: RoleStyle,
    width: float,
    ratio: float,
    separator: str,
) -> list[list]:
    """联系方式按**字段段**排版：同一字段的标签段与值段之间不插分隔符（QW-6）。"""
    lines: list[list] = []
    for line in header.contact_lines:
        group: list[Inline] = []
        for field in contact_field_groups(line):
            if group:
                group.append(Inline(text=separator, role="meta"))
            group.extend(field)  # type: ignore[arg-type]
        if not group:
            continue
        lines.extend(
            _lines(_glyphs(pdf, group, base, style, None, meta_ratio=ratio), width)
        )
    return lines


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
    # 无覆盖时的空查询：接受 `field_only` 等关键字，与真实查询函数同形。
    style = role_style or (lambda role, object_id=None, **_kwargs: None)
    name_text = _plain(header.name)
    name_meta_text = _plain(header.name_meta)
    subtitle_text = _plain(header.subtitle)
    # planner 的 contact_lines 是"每行若干字段段"；这里必须**按段**保留分隔符再交给
    # `_pack_contact_lines` 装行。整行 `"".join` 会把字段粘成一串（2026-10-30 实机六出口
    # 检查：PDF 页头 "138-0000-0000zhang@example.com上海2001"，HTML / Word 正常）。
    contact_groups = [contact_field_texts(line) for line in header.contact_lines]

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

    # I-03：姓名段/性别段的样式走**同一份** resolver（字段级 > 姓名角色级 > 无覆盖）。
    # 之前这里只查 `style("name")`（没有 object_id），字段级永远不生效，
    # 于是"把姓名改成红色"在草稿生效、在 PDF 里没反应。
    name_style, gender_style = name_block_styles(header, style)
    meta_style = style("meta")
    name_scale = (
        float(name_style.font_scale) if name_style is not None and name_style.font_scale else 1.0
    )
    meta_scale = (
        float(meta_style.font_scale) if meta_style is not None and meta_style.font_scale else 1.0
    )
    gender_scale = (
        float(gender_style.font_scale)
        if gender_style is not None and gender_style.font_scale
        else 1.0
    )
    name_size = base * layout.name_ratio * name_scale
    # 性别字号同受字段级 font_scale 影响（量高与画字用同一个值，否则页头高度会错）。
    extra_size = base * layout.name_extra_ratio * gender_scale
    name_color = (
        parse_color(name_style.color) if name_style is not None and name_style.color else None
    )
    name_bold = name_style.bold if name_style is not None and name_style.bold is not None else True
    # I-41：字距只在 `name` 角色上存在（`letter_spacing` 的角色白名单不含 meta，字段级
    # 无处可存），所以合并结果里出现它必然是角色级设置。三端同一条下限夹取。
    name_letter_spacing = (
        base * float(clamp_letter_spacing(name_style.letter_spacing) or 0.0)
        if name_style is not None
        else 0.0
    )
    extra_color = (
        parse_color(gender_style.color) if gender_style is not None and gender_style.color else None
    )
    extra_bold = (
        gender_style.bold
        if gender_style is not None and gender_style.bold is not None
        else False
    )
    meta_color = (
        parse_color(meta_style.color) if meta_style is not None and meta_style.color else None
    )

    contact_size = base * layout.contact_ratio * meta_scale
    contact_lines: list[str] = []
    # QW-6：有页眉字段级覆盖时，联系方式改按**段**渲染（标签段与值段各取自己的样式）；
    # 否则沿用"整行字符串 + cell"，没有字段覆盖的简历产物逐字节不变。
    contact_segment_lines: list[list] | None = None
    if contact_groups:
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        separator = header.contact_separator or PDF_SEPARATOR
        if _has_header_field_style(header, style):
            contact_segment_lines = _contact_glyph_lines(
                pdf,
                header,
                base=base,
                style=style,
                width=text_width,
                ratio=layout.contact_ratio,
                separator=separator,
            )
        else:
            contact_lines = _pack_contact_lines(pdf, contact_groups, text_width, separator)

    # 先量页头正文高度（不落笔）：modern 的底色块按它定尺寸、画在文字之下。
    if name_text:
        name_plan = plan_name_gender(
            pdf,
            name_text,
            name_meta_text,
            width=text_width,
            name_size=name_size,
            extra_size=extra_size,
            name_bold=bool(name_bold),
            name_letter_spacing=name_letter_spacing,
            extra_bold=bool(extra_bold),
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
    if contact_segment_lines is not None:
        text_height += layout.gap_mm(layout.contact_gap)
        text_height += sum(
            max((pdf.line_advance(glyph.size) for glyph in line), default=0)
            for line in contact_segment_lines
        )
    elif contact_lines:
        text_height += layout.gap_mm(layout.contact_gap)
        text_height += len(contact_lines) * pdf.line_advance(contact_size)
    # I-31：照片**脱流**（绝对定位）——页眉高度只跟文字，照片可以压住下方正文。
    # 这与草稿侧一致（模板里照片 `position: absolute`），也符合"背景块底边跟文字"。
    header_content_h = text_height
    # I-29：照片矩形只有在 `pdf.image()` 成功之后才赋值。放函数级而不是 if 块内，
    # 是因为后面的分隔线要按它决定"在哪让开"；画失败时保持 None，线照旧整条画。
    photo_rect: tuple[float, float, float, float] | None = None

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
            # 脱流后只夹上沿：下沿**允许越出页眉**（会压到正文，编辑器负责提示）。
            box_y = max(content_top + layout.photo_offset_y, header_top + hdr_pad_y)
            pdf.image(
                BytesIO(photo),
                x=box_x + (photo_w - photo_draw_w) / 2,
                y=box_y + (photo_h - photo_draw_h) / 2,
                w=photo_draw_w,
                h=photo_draw_h,
            )
            photo_rect = (box_x, box_y, photo_w, photo_h)
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
            name_letter_spacing=name_letter_spacing,
            extra_color=extra_color,
            extra_bold=bool(extra_bold),
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
    if contact_segment_lines is not None:
        if name_plan is not None or subtitle_text:
            pdf.ln(layout.gap_mm(layout.contact_gap))
        _draw_lines(
            pdf,
            contact_segment_lines,
            text_left,
            pdf.get_y(),
            text_width,
            center=header_centered,
        )
    elif contact_lines:
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

    header_bottom = pdf.get_y()
    if header_has_bg:
        header_bottom += hdr_pad_y
    if hdr_border_w > 0:
        header_bottom += hdr_pad_bottom
        # I-31：线跟**文字底部 + 微调**（0–12mm），不跟照片。Word 侧是段落底边框，
        # 草稿侧 border 挂在 .header-main 上，三个出口同一口径。
        line_y = pdf.get_y() + hdr_pad_bottom + layout.header_rule_gap
        pdf.set_draw_color(*pdf.accent)
        pdf.set_line_width(hdr_border_w)
        # I-29：照片允许越界（偏移作用在照片框上），线压在照片上会像"穿透"。
        # 线按照片的横向区间拆成两段让开，端点各内缩 0.5mm；任一段短于 2mm 直接丢掉。
        # **不动 header_bottom**：它决定页眉高度与分页，改了会连锁影响 fit.py 的
        # 18 组「1 页 + 填充率」校验。
        for start, end in _line_segments_around_photo(
            layout.margin_left, PAGE_WIDTH_MM - layout.margin_right, line_y, photo_rect
        ):
            pdf.line(start, line_y, end, line_y)
    pdf.set_y(header_bottom)


__all__ = ["draw_header"]

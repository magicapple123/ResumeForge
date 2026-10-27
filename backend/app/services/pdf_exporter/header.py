# SPDX-License-Identifier: Apache-2.0
"""PDF 页头绘制：照片取景、装饰（底边线 / 浅底色块）与姓名-意向-联系方式三段。

## 为什么单独成文件

`render.py` 贴着 500 行生产代码硬预算（`test_file_size_budget.py` 零豁免），而页头是
"版式计算 + 照片 + 三段文字 + 装饰"的四合一：它既不属于哪个分区，也不该把
`_draw_resume` 顶过线。抽出来之后 `_draw_resume` 只留一行 `draw_header(...)`，
**行为零变化**（照片尺寸、颜色、对齐、换行口径全部原样搬过来）。

## 与预览对齐的三条硬约束（改这里之前先读）

1. **照片按原图比例装进照片框**（`object-fit: contain`，2026-10 #10）：不能再按框比例
   cover 裁切——服务端已经按 `format_config.photo_crop` 派生过裁剪图，再裁一次用户就
   看不到自己选的取景。照片框本身（`photo_width_ratio × photo_height_ratio`）仍是
   版式与页头高度预留的单位；图片内容在框内居中、不溢出、不变形。
2. **联系方式是"整字段不拆行、字段之间可换行"**（2026-10 #3）：字段顺序 / 文案 /
   强制换行来自 `resume_contact`（HTML / Word 同一份），这里只负责按宽度装行。
   `multi_cell` 会在超宽处按字符劈开——长网址被截成两行正是用户截图里的问题。
3. **空字段零输出**：没有意向 / 没有联系方式 / 没有照片时，页头高度与底边线位置都
   按"没有这一段"算，旧产物不受影响。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from io import BytesIO

from fpdf.enums import XPos, YPos

from ...schemas.resume import ResumeContent
from ..resume.resume_contact import (
    CONTACT_BREAKS_KEY,
    PDF_SEPARATOR,
    contact_groups,
    contact_items,
)
from .canvas import _ResumePDF
from .fonts import FONT_FAMILY
from .layout import _PX_TO_MM, _PX_TO_PT, PAGE_WIDTH_MM
from .media import _photo_bytes, fit_photo_size
from .name_gender import draw_name_gender, plan_name_gender
from .style_blocks import parse_color

logger = logging.getLogger(__name__)

#: 角色/对象覆盖的查询函数：`role_style(role, object_id=None)`，无覆盖返回 None。
RoleStyle = Callable[..., object]


def _pack_contact_lines(pdf: _ResumePDF, groups: list[list[str]], width: float) -> list[str]:
    """把联系方式按字段装行：字段整体换行，**绝不拆字段内部**（#3）。

    HTML 侧由 `white-space: nowrap` 表达"字段是一个不可拆单元"，PDF 没有 CSS，
    只能自己量：逐字段测宽，装不下就把**整个字段**移到下一行（而不是像 `multi_cell`
    那样在超宽处按字符劈开——长网址被截成两行正是用户截图里的问题）。

    `groups` 是 `resume_contact.contact_groups` 的结果：组与组之间是用户设置的强制换行，
    组内字段可以自动装行；同一行里字段之间用 `PDF_SEPARATOR`（与历史输出一致的四空格）。
    """
    lines: list[str] = []
    for group in groups:
        current = ""
        for text in group:
            candidate = f"{current}{PDF_SEPARATOR}{text}" if current else text
            # 单个字段本身比整行还宽时也让它独占一行并如实溢出：字段内不折行是硬约束。
            if current and pdf.rich_text_width(candidate) > width:
                lines.append(current)
                current = text
            else:
                current = candidate
        if current:
            lines.append(current)
    return lines


def draw_header(
    pdf: _ResumePDF,
    resume: ResumeContent,
    *,
    layout,
    base: float,
    fields: dict[str, str],
    include_photo: bool,
    format_config: dict | None,
    role_style: RoleStyle,
) -> None:
    """画出整块页头，并把画布 y 移到页头底部（后续分区从那里开始）。

    ``include_photo=False`` 时**连页头也不给照片预留空间**（不只是不画图）：导出选项里
    关掉照片意味着这一版内容就没有照片，页头高度与后面的分页都要按"无照片"来算，
    否则会量出一个实际不存在的照片高度。

    ``fields`` 是 `resume_labels.field_labels(language)`（意向 / GitHub / 个人主页的标签）；
    ``format_config`` 只读其中的 ``contact_breaks``（#3 的强制换行），其余渲染域由
    ``overrides`` 负责——所以这里不需要 ``RenderOverrides``。
    """
    # 照片尺寸由模板 `.profile-photo` 的宽高（× 字号）派生——预览里它随字号/缩放走，
    # PDF 此前却是固定 22×28mm，字号一大一小就对不上（用户看到"照片大小与字号不协调"）。
    photo_w = layout.gap_mm(layout.photo_width_ratio)
    photo_h = layout.gap_mm(layout.photo_height_ratio)

    # ===== 页头（含装饰：底边线 / modern 的浅底色块）=====
    # 页头的装饰同样只来自模板 `.header` 的 CSS：底边线（宽度固定 px、强调色）、文字与线之间的
    # padding-bottom，以及 modern 那种浅底色块（`background: var(--accent-soft)` + 圆角 + 四周内边距）。
    hdr_pad_x = layout.gap_mm(layout.header_pad_x)
    hdr_pad_y = layout.gap_mm(layout.header_pad_y)
    hdr_pad_bottom = layout.gap_mm(layout.header_pad_bottom)
    hdr_radius = layout.gap_mm(layout.header_radius)
    # 底边线宽度是固定的 px（CSS `border-bottom: Npx`），不随字号/一页适配缩放，与预览一致。
    hdr_border_w = layout.header_border_width * _PX_TO_MM
    header_has_bg = layout.header_bg == "soft_accent"

    header_top = pdf.get_y()
    content_left = layout.margin_x + hdr_pad_x
    content_right = PAGE_WIDTH_MM - layout.margin_right - hdr_pad_x
    content_top = header_top + hdr_pad_y
    inner_width = pdf.content_width - 2 * hdr_pad_x

    photo = _photo_bytes(resume.photo) if (resume.photo and include_photo) else None
    # 照片在纸面上的实际尺寸：按原图比例装进模板照片框（object-fit: contain 等价物）。
    # 不能再用 cover 把照片裁成框比例——那会把 `photo_crop` 已经派生好的取景再裁一次，
    # 用户就"看不到裁剪效果"（#10 的根因之一）。照片框本身（photo_w × photo_h）仍是
    # 版式计算与页头高度预留的单位，只是图片内容在里面居中、不溢出、不变形。
    photo_draw_w = photo_draw_h = 0.0
    if photo:
        try:
            photo_draw_w, photo_draw_h = fit_photo_size(photo, photo_w, photo_h)
        except Exception:  # noqa: BLE001 - 坏图不能阻断导出（下面按"无照片"处理）
            logger.warning("简历照片无法读取尺寸，已跳过")
            photo = None
    # 照片占哪一侧由模板 `.header` 的 `flex-direction` 决定（elegant 是 `row-reverse`，
    # DOM 顺序 `[文字块, 照片]` ⇒ 照片在**左**）。此前 PDF 恒画右侧、文字恒从左边距起笔。
    # 两侧的"文字块宽度"是同一个式子（少掉照片宽 + 固定 6mm 间隙），差别只在**起点**平移；
    # `header_photo_side` 缺省 `"right"` 时 `text_left` 就退回原 `content_left`，逐字节不变。
    photo_left = bool(photo) and layout.header_photo_side == "left"
    photo_box = photo_w + 6 if photo else 0.0
    text_width = inner_width - photo_box
    text_left = content_left + photo_box if photo_left else content_left
    # 页头文字对齐：模板 `.header` 的 `text-align`（elegant 是 `center`）。
    # `left` 是**原行为**，其余 7 个模板读到的就是它。
    header_centered = layout.header_align == "center"
    header_text_align = "C" if header_centered else "L"

    name_style = role_style("name")
    meta_style = role_style("meta")
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
    gender = (resume.gender or "").strip()
    intent_text = f"{fields['intent']}：{resume.job_intent}" if resume.job_intent else ""
    # 与预览 `_resume_sections.j2` 的 `.contact` 同字段、同顺序、同文案（唯一实现在
    # `resume_contact`）。此前只拼了前四个，GitHub 与个人网站整段丢失（预览有、PDF 没有）；
    # 2026-10 #3 起还要求"整字段不拆行 + 字段之间可自动换行"，所以这里按字段装行，
    # 而不是把整串交给 multi_cell 按字符断（那样长网址会被从中间劈开）。
    contact_size = base * layout.contact_ratio * meta_scale
    contact_field_groups = contact_groups(
        contact_items(resume, fields, (format_config or {}).get(CONTACT_BREAKS_KEY))
    )
    contact_lines: list[str] = []
    if contact_field_groups:
        # 量宽度用联系方式自己的字号：沿用上一个块的字体度量会把行数算少（或算多）。
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        contact_lines = _pack_contact_lines(pdf, contact_field_groups, text_width)

    # 先量页头正文的高度（不落笔）：modern 的底色块要按它定尺寸、并画在文字之下。
    # 姓名与性别**各量各的**（`plan_name_gender`，与绘制同一逻辑），性别不再并入
    # 姓名行的字号计算——此前拼成一条 name_line，性别被按姓名字号量与画。
    name_plan = plan_name_gender(
        pdf, resume.name, gender, width=text_width, name_size=name_size, extra_size=extra_size
    )
    text_height = name_plan.height
    if intent_text:
        # 段前留白 `.header .intent { margin-top }` 与正文一样占高度，必须计入（下面画的时候
        # 也用同一个 `ln`），否则 modern 的底色块会比文字矮一截。
        text_height += layout.gap_mm(layout.intent_gap)
        text_height += pdf.text_block_height(
            intent_text, width=text_width, size_px=base * layout.intent_ratio * meta_scale
        )
    if contact_lines:
        text_height += layout.gap_mm(layout.contact_gap)
        # 每行一个 line_advance：与 `multi_cell` 的行高是同一口径（干跑量高换成真装行，
        # 行数才是实际要画的那些行）。
        text_height += len(contact_lines) * pdf.line_advance(contact_size)
    photo_span = photo_h if photo else 0.0
    header_content_h = max(text_height, photo_span)

    if header_has_bg:
        # 页头底色块用模板 `:root` 的 `--accent-soft` 真值（split 现场调淡约得 #edeae5，
        # 模板写死的是 #f3eee6，两者有色差——见 `theme.resolve_accent_soft`）。
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
            # 按 contain 口径画：`photo_draw_w/h` 与图片自身宽高比完全一致，同时给 fpdf2 的
            # w/h 不会拉伸（它只会把图片缩放成给定矩形——比例相同 ⇒ 不变形）。
            # 内容在照片框内**水平/垂直居中**，与 CSS `object-fit: contain` 的定位一致。
            pdf.image(
                BytesIO(photo),
                # 照片在左时贴着文字起点画；在右时贴着正文右边界（原行为）。
                x=(content_left if photo_left else content_right - photo_w)
                + (photo_w - photo_draw_w) / 2,
                y=content_top + (photo_h - photo_draw_h) / 2,
                w=photo_draw_w,
                h=photo_draw_h,
            )
        except Exception:  # noqa: BLE001 - 照片坏了不能阻断导出
            logger.warning("简历照片无法写入 PDF，已跳过")

    pdf.set_y(content_top)
    pdf.set_x(text_left)
    # 姓名（姓名字号/粗体/强调色）与性别（extra 字号/常规/muted）同块绘制，见 plan。
    # `align` 决定这一块在 `text_width` 内居中还是贴左（模板 `.header` 的 `text-align`）。
    draw_name_gender(
        pdf,
        resume.name,
        name_plan,
        width=text_width,
        name_size=name_size,
        extra_size=extra_size,
        align=layout.header_align,
        name_color=name_color,
        name_bold=bool(name_bold),
    )
    pdf.set_text_color(*pdf.body_text)
    if intent_text:
        intent_size = base * layout.intent_ratio * meta_scale
        pdf.set_font(FONT_FAMILY, "", intent_size * _PX_TO_PT)
        pdf.set_text_color(*(meta_color or pdf.muted_text))
        # 模板 `.header .intent { margin-top: calc(var(--fs) * N) }`；`ln` 会把 x 复位到左边距，
        # 所以紧跟着重新 `set_x(text_left)`。
        pdf.ln(layout.gap_mm(layout.intent_gap))
        pdf.set_x(text_left)
        pdf.multi_cell(
            text_width,
            pdf.line_advance(intent_size),
            intent_text,
            align=header_text_align,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
    if contact_lines:
        pdf.set_font(FONT_FAMILY, "", contact_size * _PX_TO_PT)
        pdf.set_text_color(*(meta_color or pdf.muted_text))
        # 同上：`.header .contact { margin-top: calc(var(--fs) * N) }`。
        pdf.ln(layout.gap_mm(layout.contact_gap))
        contact_line_height = pdf.line_advance(contact_size)
        for contact_line in contact_lines:
            x = text_left
            if header_centered:
                # 与 multi_cell(align="C") 同效：每行在文字块宽度内居中。
                x += max(0.0, (text_width - pdf.rich_text_width(contact_line)) / 2)
            pdf.set_x(x)
            # 一行一个 cell（**不换行**）：整字段已是不可拆单元，超宽时如实溢出而不是
            # 在字段中间断行——与 HTML 的 white-space: nowrap 同一条口径。
            pdf.cell(
                text_width,
                contact_line_height,
                contact_line,
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
    pdf.set_text_color(*pdf.body_text)

    # 页头块的底：文字底与照片底取更靠下者；modern 再补下内边距，其余模板补 padding-bottom 后画底边线。
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

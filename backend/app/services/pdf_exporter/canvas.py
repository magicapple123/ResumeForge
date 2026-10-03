"""fpdf2 画布子类 ``_ResumePDF``（所有行距/页边距都从 ``self.layout`` 取）。"""
from __future__ import annotations

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from .fonts import FONT_FAMILY
from .layout import (
    _BODY_TEXT,
    _MUTED_TEXT,
    _PX_TO_MM,
    _PX_TO_PT,
    PAGE_WIDTH_MM,
    ResumeLayout,
)
from .skill_tags import skill_tag_metrics, soft_accent, wrap_skill_tags


class _ResumePDF(FPDF):
    """PDF 画布。所有行距/页边距都从 ``self.layout`` 取，模块里没有第二份系数。"""

    def __init__(
        self,
        accent: tuple[int, int, int],
        layout: ResumeLayout,
        *,
        line: tuple[int, int, int] = (217, 222, 231),
        measuring: bool = False,
    ) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.accent = accent
        # 分隔线颜色（区块标题的下划线用它），来自模板 `--line`。
        self.line_color = line
        self.layout = layout
        # 测量模式：不翻页，让整份内容连续排下来，末尾的 y 就是真实内容高度。
        self.measuring = measuring
        self.set_auto_page_break(auto=not measuring, margin=layout.margin_bottom)
        self.set_margins(layout.margin_x, layout.margin_top, layout.margin_x)
        self.set_title("简历")
        self.alias_nb_pages()

    @property
    def content_width(self) -> float:
        """正文可用宽度（mm）。"""
        return PAGE_WIDTH_MM - 2 * self.layout.margin_x

    def line_advance(self, font_px: float) -> float:
        """某个字号的一行推进量（mm）= 字号 × mm/px × 行高系数。

        行高系数来自模板（`ResumeLayout.line_height`），所以 PDF 的行距与预览是**同一个
        口径**——这正是原来"PDF 比预览紧、看起来被压扁"要修的地方。
        """
        return font_px * _PX_TO_MM * self.layout.line_height

    def text_block_height(self, text: str, *, width: float, size_px: float, bold: bool = False) -> float:
        """量一段 `multi_cell` 文本的高度（mm），**不落笔**。

        页头的 modern 底色块要画在文字**之下**，就必须先知道文字多高——否则要么底色盖住
        文字，要么先画文字再补底色（把文字也盖住）。`dry_run=True` 只算不画。
        """
        self.set_font(FONT_FAMILY, "B" if bold else "", size_px * _PX_TO_PT)
        return float(
            self.multi_cell(
                width, self.line_advance(size_px), text, dry_run=True, output="HEIGHT"
            )
        )

    def ensure_space(self, height: float) -> None:
        """剩余空间不足时换页，避免条目被从中间截断。测量模式不换页。"""
        if self.measuring:
            return
        if self.get_y() + height > self.page_break_trigger:
            self.add_page()

    def _section_title_color(self) -> tuple[int, int, int]:
        """区块标题文字颜色：按模板 `.section-title` 的配色（accent / body / muted / white）。"""
        choice = self.layout.section_title_text
        if choice == "accent":
            return self.accent
        if choice == "white":
            return (255, 255, 255)
        if choice == "muted":
            return _MUTED_TEXT
        return _BODY_TEXT

    def section_title(self, text: str, base: float, *, leading_gap: float) -> None:
        """画一个区块标题——**形状与颜色由模板 `.section-title` 决定**，与预览同口径。

        此前这里对所有模板统一画一条"贯穿正文宽度的横向下划线"，而预览其实各不相同：
        classic 是**左侧竖条**、modern 是浅底色块、compact/elegant 是细下划线、technical
        是实心底色块、minimal 什么装饰都没有。统一画下划线正是"PDF 与预览不一致"里最显眼
        的一处。现在形状由 `section_title_style` 驱动，各模板各画各的。

        ``leading_gap`` 是标题**之前**的留白系数（× 基准字号）：第一个区块之前是页头
        `.header` 的 margin-bottom，之后是上一区块 `.section` 的 margin-bottom——预览里
        `.section` 只有 bottom 边距，所以必须把"前一段的间距"显式带进来，否则第一段会比预览紧。
        """
        layout = self.layout
        size = base * layout.section_title_ratio
        title_height = self.line_advance(size)
        pad_x = layout.gap_mm(layout.section_title_pad_x)
        pad_y = layout.gap_mm(layout.section_title_pad_y)
        gap_after = layout.gap_mm(layout.section_title_gap)
        style = layout.section_title_style
        bar_w = 4 * _PX_TO_MM  # classic 的左竖条是固定 4px（与预览 border-left 一致）

        if style in ("soft_box", "accent_box"):
            block_height = title_height + 2 * pad_y
        elif style == "underline":
            block_height = title_height + pad_y
        else:
            block_height = title_height

        self.ensure_space(layout.gap_mm(leading_gap) + block_height + gap_after)
        self.ln(layout.gap_mm(leading_gap))
        top = self.get_y()

        self.set_font(FONT_FAMILY, "B", size * _PX_TO_PT)
        text_width = self.get_string_width(text)
        text_x = layout.margin_x + pad_x

        if style == "left_bar":
            text_x = layout.margin_x + bar_w + pad_x
            self.set_fill_color(*self.accent)
            self.rect(layout.margin_x, top, bar_w, title_height, style="F")
        elif style == "soft_box":
            self.set_fill_color(*soft_accent(self.accent))
            self.rect(
                layout.margin_x,
                top,
                text_width + 2 * pad_x,
                block_height,
                style="F",
                round_corners=True,
                corner_radius=base * _PX_TO_MM * 0.4,
            )
        elif style == "accent_box":
            self.set_fill_color(*self.accent)
            self.rect(layout.margin_x, top, text_width + 2 * pad_x, block_height, style="F")

        if layout.section_title_align == "center":
            text_x = layout.margin_x + max(0.0, (self.content_width - text_width) / 2)

        self.set_text_color(*self._section_title_color())
        self.set_xy(text_x, top + pad_y)
        self.cell(0, title_height, text, new_x=XPos.RIGHT, new_y=YPos.TOP)

        if style == "underline":
            line_y = top + title_height + pad_y
            self.set_draw_color(*self.line_color)
            self.set_line_width(0.3)
            self.line(layout.margin_x, line_y, PAGE_WIDTH_MM - layout.margin_x, line_y)

        self.set_y(top + block_height + gap_after)
        self.set_x(layout.margin_x)
        self.set_text_color(*_BODY_TEXT)

    def bullets(self, items: list[str], base: float, indent: float = 3.0) -> None:
        """画一段带圆点的列表项（项间留白对齐模板的 li margin）。"""
        layout = self.layout
        line_height = self.line_advance(base)
        li_gap = layout.gap_mm(layout.li_gap)
        self.set_font(FONT_FAMILY, "", base * _PX_TO_PT)
        first = True
        for item in items:
            text = str(item).strip()
            if not text:
                continue
            # 列表项之间的留白 = 模板 `li { margin-bottom }`（此前 PDF 完全没有这一项）。
            if not first:
                self.ln(li_gap)
            first = False
            self.ensure_space(line_height * 2)
            self.set_x(layout.margin_x + indent)
            self.multi_cell(
                self.content_width - indent,
                line_height,
                f"· {text}",
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )

    def entry_head(self, left: str, right: str, base: float) -> None:
        """画条目头（左标题加粗、右时间戳淡化右对齐）。"""
        title_size = base * self.layout.entry_title_ratio
        line_height = self.line_advance(title_size)
        self.ensure_space(line_height * 2)
        available = self.content_width
        left_width = available * 0.68
        right_width = available - left_width
        self.set_font(FONT_FAMILY, "B", title_size * _PX_TO_PT)
        self.set_x(self.layout.margin_x)
        self.cell(left_width, line_height, left, new_x=XPos.RIGHT, new_y=YPos.TOP)
        if right:
            self.set_font(FONT_FAMILY, "", base * self.layout.entry_meta_ratio * _PX_TO_PT)
            self.set_text_color(*_MUTED_TEXT)
            self.cell(right_width, line_height, right, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.set_text_color(*_BODY_TEXT)
        else:
            self.ln(line_height)

    def skill_tags(self, labels: list[str], base: float) -> None:
        """把专业技能画成**带底色的小标签**，与 HTML 预览保持一致。

        以前这里是用「、」连起来的**一行纯文本**：预览里明明是带底色的圆角小框，导出的 PDF
        却完全看不出标签的样子（用户实测反馈："预览里是蓝色小框，导出 PDF 后没有了"）。
        其余排版都在对齐预览，这一项没有理由例外。
        """
        items = [str(label).strip() for label in labels if str(label).strip()]
        if not items:
            return
        metrics = skill_tag_metrics(
            base, line_height=self.layout.line_height, tag_ratio=self.layout.tag_font_ratio
        )
        available = self.content_width
        self.set_font(FONT_FAMILY, "", metrics.font_pt)
        widths = [self.get_string_width(label) + 2 * metrics.padding_x for label in items]
        fill = soft_accent(self.accent)

        for row in wrap_skill_tags(widths, max_width=available, gap=metrics.gap_x):
            self.ensure_space(metrics.height + metrics.gap_y)
            top = self.get_y()
            left = self.layout.margin_x
            for index in row:
                width = widths[index]
                self.set_fill_color(*fill)
                self.set_draw_color(*fill)
                self.rect(
                    left,
                    top,
                    width,
                    metrics.height,
                    style="F",
                    round_corners=True,
                    corner_radius=metrics.radius,
                )
                self.set_text_color(*self.accent)
                self.set_xy(left + metrics.padding_x, top)
                self.cell(width - 2 * metrics.padding_x, metrics.height, items[index])
                left += width + metrics.gap_x
            self.set_y(top + metrics.height + metrics.gap_y)
            self.set_x(self.layout.margin_x)
        # 标签用强调色写字，用完必须把文字颜色还原，否则后面的正文也会变成强调色。
        self.set_text_color(*_BODY_TEXT)

    def meta_line(self, text: str, base: float) -> None:
        """条目下的副行（绩点 / 核心课程 / 技术栈）。

        对应模板里的 `.entry .sub`，所以字号比例取 `entry_sub_ratio`——**不是**条目头右侧
        `.entry-head .meta` 的 `entry_meta_ratio`（两者多数模板相同，technical 却是 0.9 vs 0.86）。
        上下留白也取 `.entry .sub` 的 `margin`（`sub_gap_top` / `sub_gap_bottom`）——此前 PDF
        完全没有这两段间距，是"被压扁"的一部分。
        """
        if not text.strip():
            return
        layout = self.layout
        size = base * layout.entry_sub_ratio
        line_height = self.line_advance(size)
        self.ensure_space(layout.gap_mm(layout.sub_gap_top) + line_height)
        self.ln(layout.gap_mm(layout.sub_gap_top))
        self.set_font(FONT_FAMILY, "", size * _PX_TO_PT)
        self.set_text_color(*_MUTED_TEXT)
        self.set_x(layout.margin_x)
        self.multi_cell(
            self.content_width,
            line_height,
            text,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        self.ln(layout.gap_mm(layout.sub_gap_bottom))
        self.set_text_color(*_BODY_TEXT)

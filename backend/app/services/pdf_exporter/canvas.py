# SPDX-License-Identifier: Apache-2.0
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
    ResumeLayout,
)
from .skill_tags import draw_skill_tags, soft_accent

# 列表项符号（含它后面那个空格）。它由 `bullets()` **单独画一次 `cell`**（不拼进正文的
# `multi_cell`）：拼进去只有首行能对齐缩进线，续行会跟着整块左移，而且 fpdf2 的 WORD 断行
# 会把「· 」当成一个词、在正文贴着行宽时留下"一整行只有圆点"的怪行。它的宽度一律用
# `get_string_width` 现量（随字号与字体变），不写死毫米数。
_BULLET_MARK = "· "


class _ResumePDF(FPDF):
    """PDF 画布。所有行距/页边距都从 ``self.layout`` 取，模块里没有第二份系数。"""

    def __init__(
        self,
        accent: tuple[int, int, int],
        layout: ResumeLayout,
        *,
        line: tuple[int, int, int] = (217, 222, 231),
        body_text: tuple[int, int, int] = _BODY_TEXT,
        muted_text: tuple[int, int, int] = _MUTED_TEXT,
        accent_soft: tuple[int, int, int] | None = None,
        measuring: bool = False,
    ) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.accent = accent
        # 分隔线颜色（区块标题的下划线用它），来自模板 `--line`。
        self.line_color = line
        # 正文与辅助文字颜色，来自模板 `--text` / `--muted`（各自可被 format_config 覆盖）。
        # 此前它们是模块常量、对所有模板一个值，于是 minimal 的 `#17181a`、technical 的
        # `#1c2430` 导出来都是 classic 的 `#1f2937`——**模板配色对 PDF 完全不生效**。
        self.body_text = body_text
        self.muted_text = muted_text
        # 强调色的浅底（页头底色块 / soft_box 区块标题 / 部分模板的标签底色）：模板
        # `:root` 的 `--accent-soft` 真值；没人给时现场按 `soft_accent(accent)` 兜底
        # （自定义模板缺这个键时走这条）。
        self.accent_soft = accent_soft if accent_soft is not None else soft_accent(accent)
        self.layout = layout
        # 测量模式：不翻页，让整份内容连续排下来，末尾的 y 就是真实内容高度。
        self.measuring = measuring
        # ===== 列框（当前绘制区域的水平范围）=====
        # 默认就是整页正文宽度（单栏模板、页头、以及"还没进分栏"的时刻都是这一档）。双栏模板
        # 由 `columns.render_sections` 用 `set_frame` 把绘制收窄到半栏、画完 `reset_frame()`
        # 还原。**页头不读这两个属性**：草稿的 `.header` 在 `.resume-sections` 之外，永远整页宽。
        self.frame_left: float = layout.margin_x
        self.frame_width: float = layout.usable_width_mm
        # 绘制时**永远按自然分页**排（auto=True）：页数上限是渲染之后由 `truncate_pdf`
        # 裁出来的唯一口径（2026-10-21）。此前这里还有一个 `max_pages` 开关，它到上限后
        # 把余下内容继续画在最后一页上——两条截断路径会让"预览看到的末页"与"裁剪得到的
        # 末页"悄悄不同，且要多走一整趟绘制。
        self.set_auto_page_break(auto=not measuring, margin=layout.margin_bottom)
        # 左/上/右**各读各的边**：右边界此前写死成左（`margin_x`），四边一旦不对称，
        # 折行宽度会比正文框宽出「右 − 左」，`multi_cell` 就会越过右边距。
        self.set_margins(layout.margin_left, layout.margin_top, layout.margin_right)
        self.set_title("简历")
        self.alias_nb_pages()
        # 这一趟**真正画出去**的每一个字。字体预子集化靠它（见 `font_subset`）：
        # 只有从真实渲染里收，才不会漏掉渲染器自己写的标题与分隔符。
        self.drawn_chars: set[str] = set()

    # ===== 收集画出去的字（供字体预子集化）=====

    def _remember_text(self, args: tuple, kwargs: dict) -> None:
        """记下 `cell` / `multi_cell` 的正文参数。

        只认第一个 `str` 形参：fpdf2 的签名是 ``(w, h, text="", ...)``，但历史上允许
        位置/关键字两种写法，返回 `output=...` 等模式时也可能没有文本。取不到就跳过——
        这是一条"顺手记录"，不该因为签名细节挡住绘制。
        """
        text = kwargs.get("text")
        if text is None and len(args) > 2:
            text = args[2]
        if isinstance(text, str) and text:
            self.drawn_chars.update(text)

    def cell(self, *args, **kwargs):  # noqa: ANN002, ANN003 - 只是转发并记录，签名随 fpdf2
        self._remember_text(args, kwargs)
        return super().cell(*args, **kwargs)

    def multi_cell(self, *args, **kwargs):  # noqa: ANN002, ANN003 - 同上
        self._remember_text(args, kwargs)
        return super().multi_cell(*args, **kwargs)

    @property
    def content_width(self) -> float:
        """整页正文可用宽度（mm）。**列框的当前宽度是 ``frame_width``**，不是这个。

        这两个概念必须分开：页头、页脚与单栏模板用整页宽度；双栏正文里每一栏用半页宽度。
        把 `content_width` 换成"当前列宽"会让页头在双栏模板下缩成半页宽。
        """
        return self.layout.usable_width_mm

    # ===== 列框（双栏正文用；单栏模板永远停在默认的整页宽度）=====

    def set_frame(self, left: float, width: float) -> None:
        """把随后的绘制收进一个**列框**：``left`` 起、``width`` 宽（mm）。

        只影响"画在哪、多宽"，不影响分页：`ensure_space` 与 `page_break_trigger` 仍按整页
        高度算——双栏是并排两栏，不是两个独立的流。
        """
        self.frame_left = left
        self.frame_width = width
        self.set_x(left)

    def reset_frame(self) -> None:
        """恢复整页正文宽度（页头与单栏模板用的就是这一档）。"""
        self.frame_left = self.layout.margin_x
        self.frame_width = self.content_width
        self.set_x(self.frame_left)

    def measuring_twin(self) -> _ResumePDF | None:
        """造一份"只量不画"的同版式画布（双栏量高用），量不了返回 ``None``。

        `columns.render_sections` 要先知道每个分区在**半栏宽度**下有多高，才能把两栏并排放；
        而"量的就是画的"要求用同一批 drawer 函数，所以必须有一个 `measuring=True` 的孪生画布。

        **字体对象直接共享**（``fonts.update``）：fpdf2 解析一次中文字体要 ~280ms，重解析一遍
        等于让双栏模板的导出慢一倍。共享的是已解析的字形度量表，孪生画布只读它、从不输出，
        因此不会与正式画布的嵌子集互相干扰。极端情况下（字体还没注册）退回 ``None``，
        调用方转走"顺序渲染"——宁可版式退回单栏，也不能导不出。
        """
        probe = _ResumePDF(
            self.accent,
            self.layout,
            line=self.line_color,
            body_text=self.body_text,
            muted_text=self.muted_text,
            accent_soft=self.accent_soft,
            measuring=True,
        )
        probe.fonts.update(self.fonts)
        if not probe.fonts:
            return None
        probe.add_page()
        return probe

    def line_advance(self, font_px: float) -> float:
        """某个字号的一行推进量（mm）= 字号 × mm/px × 行高系数。

        行高系数来自模板（`ResumeLayout.line_height`），所以 PDF 的行距与预览是**同一个
        口径**——这正是原来"PDF 比预览紧、看起来被压扁"要修的地方。
        """
        return font_px * _PX_TO_MM * self.layout.line_height

    def _dry_run_height(self, width: float, line_height: float, text: str) -> float:
        """`multi_cell` 的"只算不画"高度（mm）。

        fpdf2 的返回类型是"取决于 `output` 取值的联合"（`float | list[str] | 元组`），
        所以不能直接 `float(...)`。这里只取 `HEIGHT` 那一支：真的拿到了别的类型就
        明确报错——把量高错误静默成 0 会让页头条压到文字上，比崩更难查。
        """
        measured = self.multi_cell(width, line_height, text, dry_run=True, output="HEIGHT")
        if not isinstance(measured, (int, float)):
            raise TypeError(f"multi_cell(output='HEIGHT') 返回了 {type(measured).__name__}")
        return float(measured)

    def text_block_height(
        self, text: str, *, width: float, size_px: float, bold: bool = False
    ) -> float:
        """量一段 `multi_cell` 文本的高度（mm），**不落笔**。

        页头的 modern 底色块要画在文字**之下**，就必须先知道文字多高——否则要么底色盖住
        文字，要么先画文字再补底色（把文字也盖住）。`dry_run=True` 只算不画。
        """
        self.set_font(FONT_FAMILY, "B" if bold else "", size_px * _PX_TO_PT)
        return self._dry_run_height(width, self.line_advance(size_px), text)

    def ensure_space(self, height: float) -> None:
        """剩余空间不足时换页，避免条目被从中间截断。测量模式不换页。

        换页只由这里（区块之间）与 fpdf2 的 `multi_cell`（行级）负责，两者都按自然分页
        走到底；"最多几页"由渲染后的 `truncate_pdf` 决定，绘制阶段不参与。
        """
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
            return self.muted_text
        return self.body_text

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

        # 预留量 = 前导间距 + 标题块 + 标题下间距 + **一行正文**。最后这一行对应草稿的
        # `body .section-title { break-after: avoid }`：标题后面必须至少跟一行正文，否则
        # 标题会孤零零地落在页尾、它下面的内容全在下一页（PDF 侧此前就是这样）。
        self.ensure_space(
            layout.gap_mm(leading_gap) + block_height + gap_after + self.line_advance(base)
        )
        self.ln(layout.gap_mm(leading_gap))
        top = self.get_y()

        self.set_font(FONT_FAMILY, "B", size * _PX_TO_PT)
        text_width = self.get_string_width(text)
        # 区块标题**跟着列框走**：双栏模板里标题色块/竖条/下划线只覆盖所在那一栏。
        text_x = self.frame_left + pad_x

        if style == "left_bar":
            text_x = self.frame_left + bar_w + pad_x
            self.set_fill_color(*self.accent)
            self.rect(self.frame_left, top, bar_w, title_height, style="F")
        elif style == "soft_box":
            self.set_fill_color(*self.accent_soft)
            self.rect(
                self.frame_left,
                top,
                text_width + 2 * pad_x,
                block_height,
                style="F",
                round_corners=True,
                corner_radius=base * _PX_TO_MM * 0.4,
            )
        elif style == "accent_box":
            self.set_fill_color(*self.accent)
            self.rect(self.frame_left, top, text_width + 2 * pad_x, block_height, style="F")

        if layout.section_title_align == "center":
            text_x = self.frame_left + max(0.0, (self.frame_width - text_width) / 2)

        self.set_text_color(*self._section_title_color())
        self.set_xy(text_x, top + pad_y)
        self.cell(0, title_height, text, new_x=XPos.RIGHT, new_y=YPos.TOP)

        if style == "underline":
            line_y = top + title_height + pad_y
            self.set_draw_color(*self.line_color)
            self.set_line_width(0.3)
            self.line(self.frame_left, line_y, self.frame_left + self.frame_width, line_y)

        self.set_y(top + block_height + gap_after)
        self.set_x(self.frame_left)
        self.set_text_color(*self.body_text)

    def bullets(self, items: list[str], base: float) -> None:
        """画一段带圆点的列表项（缩进与项间留白都来自模板 `ul` / `li` 的 CSS）。

        换页口径对齐草稿的 `body li { break-inside: avoid }`：**一条 li 不会被劈到两页**。
        旧实现只 `ensure_space(line_height * 2)`——预留两行就去画，`multi_cell` 会按行自动
        换页，于是任何超过两行的 li 都被劈开；而草稿永不劈开，两边"第 N 页显示到哪"因此对
        不上。现在每条先 `dry_run` 量出整条（含折行）的真实高度，再决定是否换页。

        **缩进对齐草稿的 `ul { padding-left: calc(var(--fs) * N) }`**（`layout.li_indent`，
        逐模板不同）：列表**正文**从 ``frame_left + N × 字号`` 起、宽度取
        ``frame_width − N × 字号``（即 CSS 里 `li` 内容盒的宽度），符号「·」**单独画一次**
        `cell`，落在正文左侧的留白里——等价于 CSS 的 `list-style-position: outside`。
        符号必须单独画：把它拼进同一个 `multi_cell` 就只有**首行**能对齐（整块得左移一个
        符号宽，续行会跟着左移，比首行缩回去一个符号宽），而且 fpdf2 的 WORD 断行会把
        「· 」当成一个"词"，正文贴着行宽时会出现"**一整行只有圆点**"的怪行。
        量高也只用**纯文本**（宽度与那次 `multi_cell` 完全相同）：符号画在原地的第一行行盒
        里，不占正文宽度，因此不会让这一条更高——预留值与"整条实际占地"仍然是同一个数。
        """
        layout = self.layout
        line_height = self.line_advance(base)
        li_gap = layout.gap_mm(layout.li_gap)
        self.set_font(FONT_FAMILY, "", base * _PX_TO_PT)
        # 符号宽度必须用**正文的字体与字号**量（`set_font` 已在上一行设好）。
        marker_width = float(self.get_string_width(_BULLET_MARK))
        indent_mm = layout.gap_mm(layout.li_indent)
        text_left = self.frame_left + indent_mm
        width = self.frame_width - indent_mm
        # fpdf2 在 `cell` / `multi_cell` 内部左右各留 `c_margin`（默认 1mm）。画符号那次 cell
        # 把这 1mm 补回来，符号的**字形右沿**才正好落在正文的设计左沿上（与正文那次
        # multi_cell 同一个内边距口径），否则圆点会挤进正文 1mm。
        pad = float(self.c_margin)
        # 整条 li 最多能占的高度。超过它就说明"单条比一页还高"——此时不能强留整条，否则
        # 每次换页后仍然放不下，会留出整页空白甚至陷进"换页—量高—再换页"的循环。浏览器对
        # 这类元素也是这个兜底：`break-inside: avoid` 放不下时照常劈开。
        max_fit = layout.usable_height_per_page - 2 * line_height
        first = True
        for item in items:
            text = str(item).strip()
            if not text:
                continue
            # 先量整条高度：**纯文本**、与下面绘制时同一个宽度（`dry_run` 只算不画）。
            height = self._dry_run_height(width, line_height, text)
            # 列表项之间的留白 = 模板 `li { margin-bottom }`。gap 必须**并进预留量**里
            # 一起算：先换页再补 gap，gap 就落到了新页顶端，段落之间凭空多一截空白。
            gap = 0.0 if first else li_gap
            if height <= max_fit:
                self.ensure_space(gap + height)
            else:
                # 单条高于一页：不强留整条（那会留整页空白、甚至陷进"换页—量高—再换页"的
                # 循环），但**符号与首行必须同页**——符号现在是单独画的，不跟着正文流走，
                # 若页底只剩不到一行，圆点会孤零零留在上一页。预留一行不会死循环。
                self.ensure_space(gap + line_height)
            if gap:
                self.ln(gap)
            first = False
            top = self.get_y()
            # 符号：与正文首行同一个行盒（同 y、同 line_height，因而同一基线），右沿对齐
            # 正文的设计左沿。颜色沿用正文色（上一段可能刚画过 muted 的副行）。
            self.set_text_color(*self.body_text)
            self.set_xy(text_left - marker_width - pad, top)
            self.cell(
                marker_width + 2 * pad,
                line_height,
                _BULLET_MARK,
                new_x=XPos.LEFT,
                new_y=YPos.TOP,
            )
            # 正文：**每一行**（首行与折行后的续行）都从 `text_left` 起，与 CSS 的 `li`
            # 内容盒左沿一致。`multi_cell` 的续行起点就是它的 x，所以这里不需要别的处理。
            self.set_x(text_left)
            self.multi_cell(
                width,
                line_height,
                text,
                align="L",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )

    def entry_head(self, left: str, right: str, base: float) -> None:
        """画条目头（左标题加粗、右时间戳淡化右对齐）。"""
        title_size = base * self.layout.entry_title_ratio
        line_height = self.line_advance(title_size)
        # 条目头 + **至少一行正文**：只留两行标题高时，条目头会和它的正文分处两页，读起来
        # 是"一条没有内容的条目"。草稿的 `.entry` 不会这样。
        self.ensure_space(line_height + self.line_advance(base))
        available = self.frame_width
        left_width = available * 0.68
        right_width = available - left_width
        self.set_font(FONT_FAMILY, "B", title_size * _PX_TO_PT)
        self.set_x(self.frame_left)
        self.cell(left_width, line_height, left, new_x=XPos.RIGHT, new_y=YPos.TOP)
        if right:
            self.set_font(FONT_FAMILY, "", base * self.layout.entry_meta_ratio * _PX_TO_PT)
            self.set_text_color(*self.muted_text)
            self.cell(
                right_width, line_height, right, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT
            )
            self.set_text_color(*self.body_text)
        else:
            self.ln(line_height)

    def skill_tags(self, labels: list[str], base: float) -> None:
        """把专业技能画成**模板真实的标签形状**，与 HTML 预览一致。

        以前这里是用「、」连起来的**一行纯文本**（用户实测反馈："预览里是蓝色小框，导出 PDF
        后没有了"）；后来补成标签，但把 8 个模板统一画成"带底色的圆角框 + 强调色文字"——预览
        里 classic 是硬编码浅灰底、modern 是描边胶囊、technical 是左侧色条、compact 用「·」
        分隔、minimal 是纯文字，导出的 PDF 全长得一样。现在形状由 `layout.tag_style` 驱动，
        五种形态各画各的。

        绘制主体在 `skill_tags.draw_skill_tags`：标签几何本属那个模块，而本类已经贴着 500 行
        预算（见 `tests/test_file_size_budget.py`）。
        """
        draw_skill_tags(
            self,
            labels,
            base,
            layout=self.layout,
            accent=self.accent,
            line_color=self.line_color,
            body_text=self.body_text,
            muted_text=self.muted_text,
        )

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
        self.set_text_color(*self.muted_text)
        self.set_x(self.frame_left)
        self.multi_cell(
            self.frame_width,
            line_height,
            text,
            align="L",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        self.ln(layout.gap_mm(layout.sub_gap_bottom))
        self.set_text_color(*self.body_text)

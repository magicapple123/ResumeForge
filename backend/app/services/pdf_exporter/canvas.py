# SPDX-License-Identifier: Apache-2.0
"""fpdf2 画布子类 ``_ResumePDF``（所有行距/页边距都从 ``self.layout`` 取）。"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from fpdf import FPDF

from ..resume.resume_rich_text import has_bold
from .fonts import FONT_FAMILY
from .layout import (
    _BODY_TEXT,
    _MUTED_TEXT,
    _PX_TO_MM,
    _PX_TO_PT,
    PAGE_HEIGHT_MM,
    ResumeLayout,
)
from .meta_columns import draw_meta_columns
from .rich_text import disable_markdown_links, drawn_text, to_fpdf_markup
from .skill_tags import draw_skill_tags, soft_accent
from .style_blocks import (
    _BULLET_MARK as _BULLET_MARK,
)
from .style_blocks import (
    draw_bullets,
    draw_entry_head,
    draw_meta_line,
    draw_section_title,
    section_title_total_height,
)

# 列表项符号（含它后面那个空格）现在定义在 `style_blocks`（与绘制在一起）；这里 re-export，
# 既有测试与调用方 `canvas._BULLET_MARK` 的导入路径不变。

# W08：标题 + 段落整体预留时，最多为正文预留多少行（含标题块自带的那一行）。
# 短于这个行数的段落整段同页；更长的段落只保证"标题 + 前几行"同页，其余自然续页。
# 取值权衡：4 行足以让常见的 1–3 行摘要/导语整段贴住标题，又不会把长段落的尾部
# 整段顶到下一页（整段预留会让刚好一页的内容凭空多出一页）。
_MAX_RESERVED_BODY_LINES = 4


@dataclass(frozen=True)
class DrawnSpan:
    """绘制日志的一段（W08/W11 共用）：语义对象在纸面上的位置。

    只记**语义锚点**（section / entry / point / meta），不记像素 Y 作为持久定位——
    y_top/y_bottom 只服务"这次渲染里被截断的是哪一段"的报告，不写回 format_config。
    """

    kind: Literal["section", "entry", "point", "meta"]
    section: str
    page: int
    y_top: float
    y_bottom: float
    object_id: str | None = None
    point_index: int | None = None
    text: str = ""


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
        continuation=None,
        resume_name: str = "",
    ) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        # W07：关掉 fpdf2 markdown 的自动链接（非法 scheme 的链接按字面文本保留，
        # 不能被它变成可点击 URI 注释；PDF 链接能力本来就标"不可点击"）。
        disable_markdown_links(self)
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
        # ===== W08：分页绘制日志与续页信息（默认 None/False = 今天逐字节一致）=====
        self.spans: list[DrawnSpan] = []
        self.continuation = continuation
        self.resume_name = resume_name or ""
        # 这一趟**真正画出去**的每一个字。字体预子集化靠它（见 `font_subset`）：
        # 只有从真实渲染里收，才不会漏掉渲染器自己写的标题与分隔符。
        self.drawn_chars: set[str] = set()

    # ===== W08：绘制日志与续页信息 =====

    def record(
        self,
        *,
        kind: str,
        section: str,
        y_top: float,
        object_id: str | None = None,
        point_index: int | None = None,
        text: str = "",
    ) -> None:
        """登记一段内容在纸面上的位置（测量模式也登记，W11 需要"量"的阶段结论）。"""
        self.spans.append(
            DrawnSpan(
                kind=kind,  # type: ignore[arg-type]
                section=section,
                page=int(self.page),
                y_top=round(float(y_top), 3),
                y_bottom=round(float(self.get_y()), 3),
                object_id=object_id,
                point_index=point_index,
                text=str(text)[:120],
            )
        )

    def header(self) -> None:
        """续页重复姓名（W08）：画在**上边距内**，不占正文流，不影响页数与高度。"""
        plan = self.continuation
        if self.measuring or plan is None or not getattr(plan, "repeat_name", False):
            return
        if self.page <= 1 or self.layout.margin_top < 8.0 or not self.resume_name:
            return
        self.set_font(FONT_FAMILY, "B", 8)
        self.set_text_color(*self.muted_text)
        self.set_xy(self.layout.margin_left, max(2.0, self.layout.margin_top - 5.5))
        self.cell(self.content_width, 4.5, self.resume_name, align="R")
        self.set_xy(self.layout.margin_left, self.layout.margin_top)

    def footer(self) -> None:
        """页码（W08）：画在**下边距内**；{nb} 由 fpdf2 在输出时替换为总页数。"""
        plan = self.continuation
        if self.measuring or plan is None or not getattr(plan, "page_numbers", False):
            return
        if self.page <= 1 and not getattr(plan, "page_numbers_first", False):
            return
        self.set_font(FONT_FAMILY, "", 8)
        self.set_text_color(*self.muted_text)
        text = f"第 {self.page} 页 / 共 {{nb}} 页"
        self.set_xy(self.layout.margin_left, PAGE_HEIGHT_MM - self.layout.margin_bottom + 3.0)
        self.cell(self.content_width, 4.5, text, align="C")

    # ===== W07：行内标记收口 + 收集画出去的字（供字体预子集化）=====

    def _rich_text_args(
        self, args: tuple[Any, ...], kwargs: dict[str, Any]
    ) -> tuple[tuple[Any, ...], dict[str, Any]]:
        """把 `cell` / `multi_cell` 的正文换成 fpdf2 markdown 口径。

        **唯一收口**：PDF 的每个文字绘制点（页头 / 区块标题 / 条目头 / 要点 / 副行 /
        技能标签）都经过这两个方法，所以协议 v2 只在这里投影一次，绘制函数不需要各写
        一套。取不到文本（`dry_run` 量高、`output=...`）时原样返回——量高与绘制因此
        用同一个投影结果。
        """
        text = None
        keyword = ""
        if "text" in kwargs:
            keyword, text = "text", kwargs["text"]
        elif "txt" in kwargs:
            keyword, text = "txt", kwargs["txt"]
        elif len(args) > 2:
            keyword, text = "pos", args[2]
        if not isinstance(text, str) or not text:
            return args, kwargs
        markup, markdown = to_fpdf_markup(text)
        # len() 再判一次：keyword == "pos" 与上面的 len(args) > 2 是同一条路径，但
        # pyright 不会跨分支关联这两个条件；不补这个判断，args 会被收窄出空元组成员。
        if keyword == "pos" and len(args) > 2:
            args = (*args[:2], markup, *args[3:])
        elif keyword:
            kwargs = {**kwargs, keyword: markup}
        kwargs = {**kwargs, "markdown": markdown}
        # 字体子集只收"真正画出来的字"：加粗标记与转义反斜杠不进集合。
        self.drawn_chars.update(drawn_text(text))
        return args, kwargs

    # ===== W08：孤行/寡行控制 =====

    def ensure_title_paragraph(
        self,
        text: str,
        base: float,
        *,
        leading_gap: float,
        style=None,
        body_style=None,
        keep_lines: int = 0,
    ) -> None:
        """把"区块标题 + 紧随其后的一整段正文"作为整体预留（keep_together 语义）。

        只量不画：调用方随后按正常顺序画标题与正文，两者必然落在同一页。解决的是
        **首尾孤行**——页尾只剩一行、或下一页页首只剩一行；也不制造"只有标题的空页"：
        整块比一页还高时 ensure_space 只换一次页，正文仍按行自然劈开（兜底不丢内容）。

        字号/行距与正文绘制走同一份公式（body 角色覆盖 → 模板行距），否则量出来的是
        "另一段文本"，预留再多也可能差一行。
        """
        if self.measuring:
            return
        body_size = base * (
            float(body_style.font_scale)
            if body_style is not None and body_style.font_scale
            else 1.0
        )
        body_line = (
            base
            * _PX_TO_MM
            * (
                float(body_style.line_height)
                if body_style is not None and body_style.line_height
                else self.layout.line_height
            )
        )
        # 量高必须先把字体切到**正文自己的字号**：fpdf2 的 dry_run 读当前字体度量，
        # 沿用上一个区块的字体（可能是标题的粗体大字号）会量出偏高的块，把整段顶到下一页。
        self.set_font(FONT_FAMILY, "", body_size * _PX_TO_PT)
        body_height = self._dry_run_height(self.frame_width, body_line, text)
        # 只整块保护**短段落**：标题块本身已经含"至少一行正文"，这里补的是超出一行的部分。
        # 长段落按"标题 + 有界行数"预留（其余自然续页）——整段预留会把本来刚好一页的
        # 内容顶出空白、多出一页（modern/standard 回归的根因）。
        reserved_body = min(body_height, _MAX_RESERVED_BODY_LINES * body_line)
        needed = section_title_total_height(
            self, base, leading_gap=leading_gap, style=style, keep_lines=keep_lines
        ) + max(0.0, reserved_body - self.line_advance(base))
        if needed > self.layout.usable_height_per_page:
            # 连有界预留都高于一页：预留在任何一页都放不下，提前换页只会白扔一页（甚至
            # 因为截断把正文整段挤没）。交给 multi_cell 按行自然分页——终止保护优先。
            return
        self.ensure_space(needed)

    def rich_text_width(self, text: str) -> float:
        """一段带行内标记的正文在**纸面上**的宽度（mm）：斜体/链接标记不占宽度。

        居中对齐/右对齐的标题不能拿源串直接量：`*斜体*` 的星号与 `[label](url)` 的
        方括号都不会画出来，多算宽度会让标题偏离版心。
        """
        markup, markdown = to_fpdf_markup(text)
        return float(self.get_string_width(markup, markdown=markdown))

    def cell(self, *args, **kwargs):  # noqa: ANN002, ANN003 - 只是转发并投影，签名随 fpdf2
        args, kwargs = self._rich_text_args(args, kwargs)
        return super().cell(*args, **kwargs)

    def multi_cell(self, *args, **kwargs):  # noqa: ANN002, ANN003 - 同上
        args, kwargs = self._rich_text_args(args, kwargs)
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

    def _dry_run_height(
        self, width: float, line_height: float, text: str, *, markdown: bool = False
    ) -> float:
        """`multi_cell` 的"只算不画"高度（mm）。

        fpdf2 的返回类型是"取决于 `output` 取值的联合"（`float | list[str] | 元组`），
        所以不能直接 `float(...)`。这里只取 `HEIGHT` 那一支：真的拿到了别的类型就
        明确报错——把量高错误静默成 0 会让页头条压到文字上，比崩更难查。

        ``markdown`` **必须与真正绘制时同参**：``**加粗**`` 的标记在 markdown 模式下
        不占宽度，量的时候不开、画的时候开，算出来的行数会比实际少（或反之），
        于是"量出来一行、画出来两行"，页底就会溢出一行。
        """
        measured = self.multi_cell(
            width, line_height, text, dry_run=True, output="HEIGHT", markdown=markdown
        )
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
        return self._dry_run_height(
            width, self.line_advance(size_px), text, markdown=has_bold(text)
        )

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

    def section_title(
        self,
        text: str,
        base: float,
        *,
        leading_gap: float,
        style=None,
        section: str = "",
        keep_lines: int = 0,
    ) -> None:
        """区块标题：绘制在 style_blocks（W07 起消费角色/对象覆盖），本方法保留原签名。"""
        draw_section_title(
            self,
            text,
            base,
            leading_gap=leading_gap,
            style=style,
            section=section,
            keep_lines=keep_lines,
        )

    def bullets(
        self,
        items: list[str],
        base: float,
        *,
        style=None,
        section: str = "",
        object_id=None,
        split_ok: bool = False,
    ) -> None:
        """列表项：绘制在 style_blocks（缩进/符号/行高/对齐可被覆盖），分页口径不变。"""
        draw_bullets(
            self, items, base, style=style, section=section, object_id=object_id, split_ok=split_ok
        )

    def entry_head(
        self,
        left: str,
        right: str,
        base: float,
        *,
        style=None,
        meta_style=None,
        section: str = "",
        object_id=None,
        keep_lines: int = 0,
    ) -> None:
        """条目头：绘制在 style_blocks（字号/颜色/粗体/对齐/段前距可被覆盖）。"""
        draw_entry_head(
            self,
            left,
            right,
            base,
            style=style,
            meta_style=meta_style,
            section=section,
            object_id=object_id,
            keep_lines=keep_lines,
        )

    def meta_line(self, text: str, base: float, *, style=None) -> None:
        """条目副行：绘制在 style_blocks（字号/颜色可被覆盖）。"""
        draw_meta_line(self, text, base, style=style)

    def meta_columns(
        self, cells, widths: Sequence[float], gap: float, base: float, *, style=None
    ) -> None:
        """W4 条目字段多列：一行按**预算好的列宽**并排绘制（几何与 meta_line 同口径）。

        ``widths`` 是 ``meta_columns.column_widths`` 按该 entry 每列最宽内容算出的结果（mm），
        同一个 entry 的所有行共用一份，跨行列起点才对得齐。
        """
        draw_meta_columns(self, cells, widths, gap, base, style=style)

    def skill_tags(self, labels: list[str], base: float, *, style=None) -> None:
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
            style=style,
        )

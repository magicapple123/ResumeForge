# SPDX-License-Identifier: Apache-2.0
"""fpdf2 绘制口径的行内标记投影（W07）：唯一解析器的 PDF 消费层。

**为什么需要这一层**：fpdf2 的 markdown 模式只认识它自己的四种标记（双星号=加粗、
双下划线=斜体、双波浪=删除线、双连字符=下划线），不认识我们的协议 v2（单星号斜体、
方括号链接）。所以由 resume_rich_text.parse_rich_runs 解析一次，再按 PDF 的真实能力投影：

* 加粗 → 双星号包裹（fpdf2 会换成粗体字形，真加粗）；
* 斜体 → 纯文本（PDF 只注册 regular+bold 两个字形，能力矩阵标"近似：不倾斜"；
  不伪造倾斜、也不把星号印出来，保证文本提取正确）；
* 链接 → "label (URL)" 可见文本（纸面可读、不可点击；URL 已在能力矩阵里标 unsupported，
  替代就是让 URL 以文字形式出现在纸面上）。

**非加粗段必须转义 fpdf2 的标记**：一旦某个段落因为加粗而开启 markdown 模式，正文里的
双连字符（日期区间、破折号）会被 fpdf2 当成下划线，双下划线会被当成斜体——那会让
"PDF 里莫名其妙出现下划线/斜体"。协议 v2 自己又不用这四种标记（加粗除外），所以把它们
逐个转义成字面量是安全的。

**禁用 fpdf2 自带的 markdown 自动链接**：我们的协议把非法 scheme 的链接原样当文本
（[x](javascript:...)），而 fpdf2 的 markdown 解析会把方括号链接变成可点击的 URI 注释。
能力矩阵里 PDF 链接本来就是"不可点击、可见 URL 文本替代"，所以从源头关掉这个自动行为
是唯一安全的口径（也避免 javascript: 之类 scheme 进入 PDF 注释）。
"""

from __future__ import annotations

import re
from collections.abc import Callable
from copy import copy
from dataclasses import dataclass
from typing import Any, cast

from fpdf.enums import Align, XPos, YPos
from fpdf.line_break import Fragment
from fpdf.util import Padding

from ..resume.resume_rich_text import parse_rich_runs, strip_markers
from .line_break import break_rich_runs, cjk_gap_indices, soft_line_flags
from .styled_runs import draw_paragraph, position_after, styled_spans

# fpdf2 markdown 模式的四种 2 字符标记（fpdf2.fpdf.FPDF.MARKDOWN_MARKERS）。
_FPDF_MARKERS = ("**", "__", "~~", "--")

# 永不匹配的正则：用来覆盖 FPDF.MARKDOWN_LINK_REGEX（实例属性）。
_NEVER_LINK = re.compile(r"(?!x)x")


def disable_markdown_links(pdf: object) -> None:
    """关掉 fpdf2 的 markdown 自动链接（见模块 docstring 的安全理由）。"""
    pdf.MARKDOWN_LINK_REGEX = _NEVER_LINK  # type: ignore[attr-defined]


def escape_fpdf_markdown(text: str) -> str:
    """把 fpdf2 的四种标记转义成字面量（只在 markdown=True 时调用）。

    反斜杠本身也要先翻倍：否则用户正文里的 "反斜杠+标记" 会改变 fpdf2 的转义奇偶性。
    """
    out: list[str] = []
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if char == "\\":
            out.append("\\\\")
            index += 1
            continue
        pair = text[index : index + 2]
        if pair in _FPDF_MARKERS:
            out.append("\\" + pair)
            index += 2
            continue
        out.append(char)
        index += 1
    return "".join(out)


def to_fpdf_markup(
    text: str,
    *,
    width: float | None = None,
    width_of: Callable[[str, bool], float] | None = None,
    line_flags: list[bool] | None = None,
) -> tuple[str, bool]:
    """协议 v2 → (fpdf2 正文, 是否开 markdown)。

    没有加粗时 markdown=False，返回的正文与可见文本一致——正常简历走这条快速路径，
    产物与改动前逐字相同。只有存在成对加粗时才开启 markdown（fpdf2 的加粗是唯一能让
    纸面出现真粗体的方式）。
    """
    spans = parse_rich_runs(text)
    has_bold = any(span.bold for span in spans)
    if width is None and not has_bold and all(span.link is None for span in spans):
        # 快速路径：没有协议 v2 标记 → 原串原样返回（历史产物逐字节不变）。
        # `{@size=…}` 的**绘制**由 `_styled` 先接管，但 `output="STR"` 这类"只量不画"的
        # 调用仍会走到这里：标记不剥掉，量出来的是带标记的字宽（F23 顺带收口）。
        return (strip_markers(text) if "{@" in text else text), False
    pieces: list[str] = []
    lines = (
        break_rich_runs(spans, width, width_of)
        if width is not None and width_of is not None
        else [spans]
    )
    if line_flags is not None:
        line_flags.extend(soft_line_flags(spans, lines))
    for index, line in enumerate(lines):
        if index:
            pieces.append("\n")
        for span in line:
            body = span.readable(with_link=True) if span.link else span.text
            if has_bold:
                body = escape_fpdf_markdown(body)
            pieces.append(f"**{body}**" if span.bold else body)
    return "".join(pieces), has_bold


def prepare_text_args(
    pdf: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    *,
    multiline: bool = False,
    line_flags: list[bool] | None = None,
) -> tuple[tuple[Any, ...], dict[str, Any]]:
    """Project once at the canvas boundary; dry runs use identical line breaks."""
    keyword = "text" if "text" in kwargs else "txt" if "txt" in kwargs else "pos"
    text = args[2] if keyword == "pos" and len(args) > 2 else kwargs.get(keyword)
    if not isinstance(text, str) or not text:
        return args, kwargs
    width = None
    saved = (pdf.font_family, pdf.font_style, pdf.font_size_pt)
    metrics: dict[tuple[str, bool], float] = {}
    spacing = pdf.char_spacing * pdf.font_stretching / 100 / pdf.k

    def width_of(char: str, bold: bool) -> float:
        key = (char, bold)
        if key not in metrics:
            pdf.set_font(saved[0], "B" if bold or "B" in saved[1] else saved[1], saved[2])
            metrics[key] = pdf.get_string_width(char) + spacing
        return metrics[key]

    try:
        if multiline:
            width = float(args[0] if args else kwargs.get("w", 0))
            if width == 0:
                width = pdf.w - pdf.r_margin - pdf.get_x()
            padding = Padding.new(kwargs.get("padding", 0))
            width -= (padding.left or pdf.c_margin) + (padding.right or pdf.c_margin)
            # Each measured glyph includes its following gap; the last one has none.
            width = max(0.0, width + spacing - 1e-7)
        markup, markdown = to_fpdf_markup(
            text, width=width, width_of=width_of, line_flags=line_flags
        )
    finally:
        pdf.set_font(*saved)
    if keyword == "pos":
        args = (*args[:2], markup, *args[3:])
    else:
        kwargs = {**kwargs, keyword: markup}
    pdf.drawn_chars.update(drawn_text(text))
    return args, {**kwargs, "markdown": markdown}


@dataclass
class _CJKContext:
    text: str
    flags: tuple[bool, ...]
    dry_run: bool
    index: int = 0


def _argument_text(args, kwargs):
    return args[2] if len(args) > 2 else kwargs.get("text", kwargs.get("txt", ""))


def _styled(pdf, args, kwargs, *, multiline: bool):
    """带行内字号/颜色的段落：自己排版与绘制；没有样式时返回 None（走老路径）。"""
    text = _argument_text(args, kwargs)
    if not isinstance(text, str) or "{@" not in text:
        return None
    spans = styled_spans(text)
    if spans is None:
        return None
    width = float(args[0] if args else kwargs.get("w", 0) or 0)
    height = float(args[1] if len(args) > 1 else kwargs.get("h", 0) or 0)
    if width <= 0:
        width = pdf.w - pdf.r_margin - pdf.get_x()
    padding = Padding.new(kwargs.get("padding", 0))
    shift = padding.left or 0
    usable = max(1.0, width - shift - (padding.right or 0))
    align = str(kwargs.get("align") or "L")[-1]
    output = kwargs.get("output")
    if output not in (None, "HEIGHT"):
        return None  # 其它 output（STR 等）不在本路径支持范围，交回 fpdf
    start_x, start_y = pdf.get_x(), pdf.get_y()
    bottom = draw_paragraph(
        pdf,
        spans,
        x=start_x + shift,
        y=start_y,
        width=usable,
        line_height=height,
        align="C" if align == "C" else "R" if align == "R" else "L",
        dry_run=bool(kwargs.get("dry_run")),
        output=output,
    )
    pdf.drawn_chars.update(drawn_text(text))
    if output == "HEIGHT":
        return bottom
    # 单行 `cell` 的高度就是 h；多行时用真实画到的底边（可能已经换页）。
    # output == "HEIGHT" / dry_run 都在上面 return 了，走到这里的返回值一定是底边 y（float）。
    used_height = height if not multiline else cast(float, bottom) - start_y
    return position_after(
        pdf,
        start_x=start_x,
        start_y=start_y,
        width=usable,
        height=max(0.0, used_height),
        new_x=kwargs.get("new_x", XPos.RIGHT),
        new_y=kwargs.get("new_y", YPos.NEXT if multiline else YPos.TOP),
    )


def render_multiline(pdf, render, args, kwargs):
    """Keep original paragraph boundaries through fpdf2's recursive dry run."""
    styled = _styled(pdf, args, kwargs, multiline=True)
    if styled is not None:
        return styled
    previous = getattr(pdf, "_cjk_context", None)
    incoming = _argument_text(args, kwargs)
    if previous and previous.dry_run and incoming == previous.text:
        flags = previous.flags
    else:
        flags = []
        args, kwargs = prepare_text_args(pdf, args, kwargs, multiline=True, line_flags=flags)
    pdf._cjk_context = _CJKContext(
        _argument_text(args, kwargs),
        tuple(flags),
        bool(kwargs.get("dry_run") or kwargs.get("split_only")),
    )
    try:
        return render(*args, **kwargs)
    finally:
        pdf._cjk_context = previous


def render_singleline(pdf, render, args, kwargs):
    """Page headers/footers must not consume the body paragraph's line flags."""
    styled = _styled(pdf, args, kwargs, multiline=False)
    if styled is not None:
        return styled
    previous = getattr(pdf, "_cjk_context", None)
    pdf._cjk_context = None
    try:
        args, kwargs = prepare_text_args(pdf, args, kwargs)
        return render(*args, **kwargs)
    finally:
        pdf._cjk_context = previous


class _SpacedFragment(Fragment):
    """PDF TJ advance at legal CJK gaps; retain font, weight and natural metrics."""

    def __init__(self, original, gaps, extra):
        super().__init__(
            original.characters, copy(original.graphics_state), original.k, original.link
        )
        self.gaps, self.extra = gaps, extra

    def get_width(self, *args, **kwargs):
        return super().get_width(*args, **kwargs) + len(self.gaps) * self.extra

    def render_pdf_text_ttf(self, frag_ws, word_spacing):
        # 只有 TTF 字体才会走 render_pdf_text_ttf（fpdf2 按字体类型分发），但 Fragment.font
        # 的注解是 `CoreFont`，`subset` / `escape_text` 只在 TTFFont 上存在。
        font = cast(Any, self.font)
        chunks = []
        pending = ""
        for index, char in enumerate(self.string):
            mapped = font.subset.pick(ord(char))
            if mapped is not None:
                pending += chr(mapped)
            if index in self.gaps:
                chunks.append("(" + font.escape_text(pending) + ")")
                shift = (
                    -self.extra * self.k * 1000 / (self.font_size_pt * self.font_stretching / 100)
                )
                chunks.append(f"{shift:.6f}")
                pending = ""
        if pending:
            chunks.append("(" + font.escape_text(pending) + ")")
        return "[" + " ".join(chunks) + "] TJ"


def prepare_cjk_line(pdf, line, padding=None):
    """Expand only prewrapped nonfinal CJK rows; multi_cell owns paging unchanged."""
    context = getattr(pdf, "_cjk_context", None)
    if context is None:
        return line
    index = context.index
    context.index += 1
    if (
        index >= len(context.flags)
        or not context.flags[index]
        or line.align not in (Align.L, Align.J)
    ):
        return line
    fragments = list(line.fragments)
    if not fragments or any(not f.is_ttf_font or f.text_shaping_parameters for f in fragments):
        return line
    while fragments and not fragments[-1].string.rstrip():
        fragments.pop()
    if not fragments:
        return line
    fragments[-1] = fragments[-1].clone(fragments[-1].string.rstrip())
    text = "".join(f.string for f in fragments)
    gaps = cjk_gap_indices(text)
    if not gaps:
        return line
    padding = padding or Padding(0, 0, 0, 0)
    usable = (
        line.max_width
        - (0 if padding.left else pdf.c_margin)
        - (0 if padding.right else pdf.c_margin)
    )
    natural = sum(f.get_width(initial_cs=i != 0) for i, f in enumerate(fragments))
    extra = max(0.0, usable - natural) / len(gaps)
    if extra <= 1e-8:
        return line
    offset = 0
    spaced = []
    for fragment in fragments:
        local = frozenset(
            g - offset for g in gaps if offset <= g < offset + len(fragment.characters)
        )
        spaced.append(_SpacedFragment(fragment, local, extra))
        offset += len(fragment.characters)
    return line._replace(fragments=spaced, text_width=usable, align=Align.L)


def drawn_text(text: str) -> str:
    """这段文本在纸面上真正出现的字符（字体子集化用；无标记，链接含可见 URL）。"""
    return "".join(
        span.readable(with_link=True) if span.link else span.text for span in parse_rich_runs(text)
    )


__all__ = [
    "disable_markdown_links",
    "drawn_text",
    "escape_fpdf_markdown",
    "to_fpdf_markup",
]

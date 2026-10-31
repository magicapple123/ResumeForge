# SPDX-License-Identifier: Apache-2.0
"""Word 导出的**段落级原语**：字体设置、区块标题、条目头、项目符号。

## 为什么单独成文件

`docx_exporter.py` 贴着 500 行预算（零豁免），而这里是它最底层、最与"简历语义"无关的
一层：只依赖 python-docx 与版式参数，不知道教育经历和实习有什么区别。搬出来之后，
导出器可以专心写"每个分区该输出哪些字段"，行数也回到预算内。

## 与预览对齐的三条硬约束

1. **条目头的辅助信息（时间）右对齐**。预览用 ``justify-content: space-between``；
   Word 没有 flex，改用"定在版心右边缘的右对齐制表位"。此前是"标题 + 全角空格 + 日期"，
   日期会跟着标题长度左右浮动——这是"Word 版和预览差别很大"里最直观的一条。
2. **项目符号悬挂缩进**。只写 ``· 文字`` 不设 ``first_line_indent``，折行的第二行会退回
   版心左边缘，看起来像另起一段；预览里折行永远对齐正文起点。
3. **字体必须显式声明 east-asian**。python-docx 只写 ``w:rFonts/@w:ascii``，中文会回退到
   Word 的默认中文字体，同一份简历在 Word 里的字形与 PDF 完全不同。

颜色与字号一律从 ``ResumeLayout`` 与模板注册表读，本模块**不存第二份数值**。

## 2026-10-31 拆分（纯搬迁，行为不变）

Q11 补齐字距 / 加粗 / 斜体后本文件超过 500 行预算，按职责拆出两个同目录内聚模块：

- ``docx_run_style.py``：run 级样式（``set_run_font`` / ``set_letter_spacing``）；
- ``docx_photo.py``：照片锚定（``float_picture``，OOXML 结构拼装）。

本模块 re-export 这三个函数，既有 import 路径不变；调用方无需改动。
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial

from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.shared import Mm

# 段落底纹/边框（纯 OOXML 拼装）拆到 docx_decorate；本模块 re-export 维持既有导入路径。
from .docx_decorate import decorate_paragraph
from .docx_fonts import DOCX_FONT, resolve_docx_font_name

# run 级样式 / 照片锚定拆到同目录内聚模块；re-export 维持既有导入路径
# （docx_exporter / docx_document_parts / 测试都从 docx_blocks 取这三个函数）。
from .docx_photo import float_picture
from .docx_rich import add_rich_runs
from .docx_run_style import set_letter_spacing, set_run_font
from .pdf_exporter import _PX_TO_MM, _PX_TO_PT, PAGE_WIDTH_MM
from .resume.resume_template_format import FONT_KEY

# 正文 / 辅助文字颜色与 PDF 的 `set_text_color` 保持一致（强调色另从模板解析）。
# 字体族名只在 `docx_fonts` 里解析（读字体 name 表），本模块只消费结果。
_BODY_COLOR = (31, 41, 55)
_MUTED_COLOR = (107, 114, 128)


@dataclass(frozen=True)
class DocxTheme:
    """一次 Word 导出的字体族与正文/辅助色（与 PDF 同一份解析结果）。

    放在一个不可变对象里而不是往每个 block 函数塞三个参数：段级原语只关心"用哪一族字、
    哪种灰"，而这三个值在一次导出内是常量；显式传递避免模块级全局状态（并发导出时
    两个请求会互相污染字体）。
    """

    font_name: str = DOCX_FONT
    body_text: tuple[int, int, int] = _BODY_COLOR
    muted_text: tuple[int, int, int] = _MUTED_COLOR


DEFAULT_DOCX_THEME = DocxTheme()

_ALIGN = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


def _style_scale(style) -> float:
    """角色/对象覆盖的字号系数（None = 1.0，即模板基准）。"""
    return float(style.font_scale) if style is not None and style.font_scale else 1.0


def _style_color(style, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    """角色/对象覆盖的字色（#rrggbb）；未设或非法回落到模板色。"""
    value = style.color if style is not None else None
    if not isinstance(value, str):
        return fallback
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return fallback
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return fallback

def _style_bool(style, prop: str, default: bool = False) -> bool:
    """角色覆盖里的布尔项；未设置（None）时用默认值。"""
    value = getattr(style, prop, None) if style is not None else None
    return bool(value) if isinstance(value, bool) else default


def _style_letter_spacing_pt(base: float, style) -> float | None:
    """角色覆盖的字距（× 基准字号）→ 磅；未设置返回 None（不写 w:spacing）。"""
    value = getattr(style, "letter_spacing", None) if style is not None else None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    return float(base) * float(value) * _PX_TO_PT


def resolve_docx_theme(template: str, format_config: dict | None) -> DocxTheme:
    """一次导出的主题：字体族 + 正文/辅助色（颜色与 PDF 同一条解析：版式覆盖 → 模板 → 兜底）。"""
    from .pdf_exporter import resolve_muted, resolve_text

    overrides = format_config if isinstance(format_config, dict) else {}
    return DocxTheme(
        font_name=resolve_docx_font_name(overrides.get(FONT_KEY)),
        body_text=resolve_text(template, format_config),
        muted_text=resolve_muted(template, format_config),
    )


def paragraph(
    doc,
    *,
    indent_mm: float = 0.0,
    space_after_mm: float = 0.0,
    space_before_mm: float = 0.0,
    keep_together: bool = False,
    keep_with_next: bool = False,
):
    """新建一个段落，并把"缩进 / 段前 / 段后"一次性设成版式要求的毫米值。

    W08 的分页意图也在这里落成 OOXML 属性（Word 没有 CSS 的 break-inside / break-after）：
    `keep_together` → `w:keepLines`（整段不跨页），`keep_with_next` → `w:keepNext`
    （标题/条目头跟着后续内容走）。**为 False 时不写属性**——旧产物逐字节不变。
    """
    result = doc.add_paragraph()
    result.paragraph_format.left_indent = Mm(indent_mm)
    result.paragraph_format.space_after = Mm(space_after_mm)
    result.paragraph_format.space_before = Mm(space_before_mm)
    if keep_together:
        result.paragraph_format.keep_together = True
    if keep_with_next:
        result.paragraph_format.keep_with_next = True
    return result

def _title_text_color(
    layout, accent: tuple[int, int, int], theme: DocxTheme
) -> tuple[int, int, int]:
    """区块标题的文字色，与模板 `section_title_text` 同一口径。

    `body` / `muted` 读 `theme` 里解析后的真实颜色——此前写死常量，模板 :root 与用户的
    「正文颜色 / 辅助文字颜色」对 Word 完全不生效（与 PDF 修这条之前的根因相同）。
    """
    choice = getattr(layout, "section_title_text", "accent")
    if choice == "white":
        return (255, 255, 255)
    if choice == "body":
        return theme.body_text
    if choice == "muted":
        return theme.muted_text
    return accent


def section_title(
    doc,
    text: str,
    base: float,
    layout,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
    theme: DocxTheme = DEFAULT_DOCX_THEME,
    style=None,
) -> None:
    """区块标题：字号用 ``section_title_ratio``、形状用 ``section_title_style``。

    **形状必须与预览一致**：模板里 `.section-title` 有的带底色块（modern / technical）、
    有的只有一条左竖条（classic）。Word 此前一律"加粗 + 强调色"，导出后看不到预览里
    那一条条色带——这是"Word 版和预览差别很大"的一部分。现在按 `section_title_style`
    补上底纹 / 左竖条（圆角表达不出来，见 `decorate_paragraph`）。
    """
    size = base * layout.section_title_ratio * _style_scale(style)
    gap_ratio = (
        float(style.space_after)
        if style is not None and style.space_after is not None
        else layout.section_gap
    )
    gap_mm = base * _PX_TO_MM * gap_ratio
    # W08：板块标题跟随后续内容（Word 的 w:keepNext；PDF 同语义用预留行数）。
    node = paragraph(
        doc,
        space_before_mm=gap_mm,
        space_after_mm=base * _PX_TO_MM * 0.4,
        keep_with_next=True,
    )

    title_style = getattr(layout, "section_title_style", "plain")
    if title_style == "soft_box":
        # 浅底色块：四边画同色细框把底纹撑开，模拟 CSS 的 padding。
        decorate_paragraph(
            node,
            fill=accent_soft,
            edges=("top", "left", "bottom", "right"),
            border_color=accent_soft,
            border_sz=4,
            space_pt=5,
        )
    elif title_style == "accent_box":
        decorate_paragraph(
            node,
            fill=accent,
            edges=("top", "left", "bottom", "right"),
            border_color=accent,
            border_sz=4,
            space_pt=5,
        )
    elif title_style == "left_bar":
        # classic 的左竖条：4px ≈ 3pt ≈ 24 个八分之一磅。
        decorate_paragraph(node, edges=("left",), border_color=accent, border_sz=24, space_pt=6)

    if style is not None and style.align is not None:
        node.paragraph_format.alignment = _ALIGN.get(style.align)
    add_rich_runs(
        node,
        text,
        partial(set_run_font, font_name=theme.font_name),
        bold=True,
        size_pt=size * _PX_TO_PT,
        color=_style_color(style, _title_text_color(layout, accent, theme)),
    )


def bullets(
    doc,
    items: list[str],
    *,
    base: float,
    indent_mm: float = 3.0,
    theme: DocxTheme = DEFAULT_DOCX_THEME,
    style=None,
) -> None:
    """项目符号列表：与预览 ``<ul><li>`` 一样**悬挂缩进**（符号挂左、文字对齐到 indent）。

    Q11：缩进读角色/对象覆盖的 ``style.indent``（此前固定用模板 ``li_indent``，用户在
    「正文 → 缩进」里调了 Word 不动）、正文对齐落到段落、加粗/斜体/字距落到 run、符号字形
    与 PDF/HTML 统一为「· / – / 空」。
    """
    size = base * _style_scale(style)
    color = _style_color(style, theme.body_text)
    indent = (
        base * _PX_TO_MM * float(style.indent)
        if style is not None and style.indent is not None
        else indent_mm
    )
    align = _ALIGN.get(str(style.align)) if style is not None and style.align else None
    bold = _style_bool(style, "bold")
    italic = _style_bool(style, "italic")
    letter_spacing_pt = _style_letter_spacing_pt(base, style)
    bullet = {"dot": "·", "dash": "–", "none": ""}.get(
        style.bullet if style is not None and style.bullet else "dot", "·"
    )
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        # W08：一条要点不跨页（Word 的 w:keepLines）；超高条目由 Word 自己劈开。
        node = paragraph(doc, indent_mm=indent, keep_together=True)
        node.paragraph_format.first_line_indent = Mm(-indent)
        if align is not None:
            node.paragraph_format.alignment = align
        if style is not None and style.line_height:
            node.paragraph_format.line_spacing = float(style.line_height)
        add_rich_runs(
            node,
            f"{bullet} {text}" if bullet else text,
            partial(set_run_font, font_name=theme.font_name),
            bold=bold,
            italic=italic,
            size_pt=size * _PX_TO_PT,
            color=color,
            letter_spacing_pt=letter_spacing_pt,
        )


def meta_line(
    doc, text: str, *, base: float, layout, theme: DocxTheme = DEFAULT_DOCX_THEME, style=None
) -> None:
    """条目下的副行（绩点 / 核心课程 / 技术栈）：小一号的灰字。"""
    if not text.strip():
        return
    # W08：副行（绩点/课程/技术栈）不跨页。
    node = paragraph(doc, keep_together=True)
    add_rich_runs(
        node,
        text,
        partial(set_run_font, font_name=theme.font_name),
        size_pt=base * layout.entry_sub_ratio * _PX_TO_PT * _style_scale(style),
        color=_style_color(style, theme.muted_text),
    )


def entry_head(
    doc,
    left: str,
    right: str,
    *,
    base: float,
    layout,
    theme: DocxTheme = DEFAULT_DOCX_THEME,
    space_before_extra_mm: float = 0.0,
    style=None,
    meta_style=None,
) -> None:
    """条目标题：左侧加粗、右侧辅助信息**右对齐**（与预览 ``.entry-head`` 同效）。

    `space_before_extra_mm` 是"同分区内上一条与这一条之间"的留白：预览里由
    ``.entry { margin-bottom: calc(var(--fs) * entry_gap) }`` 表达，Word 没有 CSS，改成本条
    段前距——两个条目贴在一起是"Word 版和预览差别很大"里很容易看出来的一条。
    """
    title_size = base * layout.entry_title_ratio * _style_scale(style)
    extra = (
        base * _PX_TO_MM * float(style.space_before)
        if style is not None and style.space_before is not None
        else 0.0
    )
    # W08：条目头跟着它下面的副行/要点走（Word 的 w:keepNext）。
    node = paragraph(
        doc,
        space_before_mm=base * _PX_TO_MM * 0.2 + space_before_extra_mm + extra,
        keep_with_next=True,
    )
    add_rich_runs(
        node,
        left,
        partial(set_run_font, font_name=theme.font_name),
        bold=style.bold if style is not None and style.bold is not None else True,
        italic=_style_bool(style, "italic"),
        size_pt=title_size * _PX_TO_PT,
        color=_style_color(style, theme.body_text),
        letter_spacing_pt=_style_letter_spacing_pt(base, style),
    )
    if not right:
        return
    if meta_style is not None and meta_style.meta_align == "inline":
        # 日期位置 = 紧随标题（Q11/Q12「灰字」范围）：不再用制表位顶到版心右缘。
        add_rich_runs(
            node,
            f" · {right}",
            partial(set_run_font, font_name=theme.font_name),
            italic=_style_bool(meta_style, "italic"),
            size_pt=base * layout.entry_meta_ratio * _PX_TO_PT * _style_scale(meta_style),
            color=_style_color(meta_style, theme.muted_text),
        )
        return
    # 制表位定在版心右边缘：无论左边标题多长，日期都停在同一列。
    node.paragraph_format.tab_stops.add_tab_stop(
        Mm(PAGE_WIDTH_MM - layout.margin_left - layout.margin_right), WD_TAB_ALIGNMENT.RIGHT
    )
    add_rich_runs(
        node,
        f"\t{right}",
        partial(set_run_font, font_name=theme.font_name),
        italic=_style_bool(meta_style, "italic"),
        size_pt=base * layout.entry_meta_ratio * _PX_TO_PT * _style_scale(meta_style),
        color=_style_color(meta_style, theme.muted_text),
    )


__all__ = [
    "DEFAULT_DOCX_THEME",
    "DOCX_FONT",
    "DocxTheme",
    "bullets",
    "entry_head",
    "float_picture",
    "meta_line",
    "paragraph",
    "resolve_docx_theme",
    "section_title",
    "set_letter_spacing",
    "set_run_font",
]

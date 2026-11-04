# SPDX-License-Identifier: Apache-2.0
"""Word 技能标签（inline 分区）：run 级底纹 / 边框，与 PDF 的 `skill_tags` 对称。

## 为什么单独成文件

`docx_document_render.py`（452 行）与 `docx_document_parts.py`（476 行）都贴着 500 行
预算（`tests/test_file_size_budget.py`），而"把 `tag_*` 形状参数落成 run 级 OOXML" 是
一个自洽的主题：它只关心"一个标签块长什么样"，不知道教育经历和实习有什么区别。

## 修的是什么

`section.kind == "inline"`（专业技能 / 语言能力）此前在 Word 里退化成**一整段连续文本**
（条目内字段用「 · 」、条目之间用「；」连起来），模板 `tag_*` 那套形状参数 Word 侧零消费
——预览/PDF 里每条技能是浅灰色块，导出件里是「SQL（精通）· 技能分类：编程语言；Python…」。
PDF 侧早就是这么画的（`pdf_exporter/skill_tags.py`），本模块是它在 Word 的对应物：

* 标签文本的拼法**与 PDF 逐字同一口径**（`join_cell_texts` + 行内段纯文本），所以换行/内容
  不会两边不一致；
* 底色 = run 级 `w:shd/@w:fill`，内边距 = 同色 `w:bdr` 的 `w:space`（Word 的字符底纹只铺到
  字形，不像 CSS 的 padding 会把背景撑开——同色边框把底纹"顶"出去才是色块的观感，
  与段落级 `decorate_paragraph` 同一个思路）；
* 字色 / 字号读 `tag_fg` / `tag_font_ratio`（与 PDF 同源：正文/辅助色由 `DocxTheme` 解析，
  强调色由调用方传入）；
* `tag_style` 为 `plain` / `dot` 的模板不加底色；`outline` 画描边；`left_bar` 画左侧竖条。

## 已知差距（如实说，与规格 1-B 的三条 + 两条 OOXML 事实）

1. **OOXML 没有圆角**：classic 的 4px 圆角在 Word 里是直角，modern / split 的胶囊形标签会
   变成直角色带（段落底纹同理，见 `docx_decorate` 的说明）。
2. **标签内部含空格时 Word 可能在标签中间折行**（HTML 是 `inline-block`，不可断）。不引入
   "不可断"的 hack，接受。
3. **`tag_columns`（scholar 的三列网格）在 Word 里不做网格**，仍按流式排列（PDF 的三列在
   Word 里没有等价的"逐标签等宽格"可表达，硬做要上无框表格，收益不抵风险）。
4. **run 级 `w:bdr` 是四边等宽的矩形框**（CT_Border 没有逐边子元素），所以 `left_bar`
   的"只画左边"表达不出来：这里用底色同色框撑内边距，再在标签前加一个强调色的「▎」
   （U+258E）模拟左侧竖条。
5. **`w:space` 四边同时生效**：CSS 的 `padding: 0 .71em` 只有左右内边距，Word 里上下也会被
   撑开，标签行的行高比 PDF 略高（classic 每行约 +12pt）。要精确逐边内边距只能上无框表格，
   本轮不做。
"""

from __future__ import annotations

from functools import partial

from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from ..schemas.resume_document_plan import SectionPlan
from .docx_blocks import DocxTheme, paragraph, set_run_font
from .docx_decorate import border_sz_from_px, rgb_hex
from .docx_document_parts import (
    RoleStyleQuery,
    align_value,
    color_of,
    rich_text,
    scale_of,
    style_of,
)
from .docx_rich import add_rich_runs
from .pdf_exporter import _PX_TO_PT
from .pdf_exporter.theme import _hex_to_rgb
from .resume.document_html import join_cell_texts

# `w:rPr` 的子元素顺序由 schema 固定：… → bdr → shd → fitText → vertAlign → …
# 顺序错了 Word 会判定文件损坏，所以把"排在自己后面的那些标签"一次写全。
_RPR_AFTER_BDR = (
    "w:shd",
    "w:fitText",
    "w:vertAlign",
    "w:rtl",
    "w:cs",
    "w:em",
    "w:lang",
    "w:eastAsianLayout",
    "w:specVanish",
    "w:oMath",
)
_RPR_AFTER_SHD = _RPR_AFTER_BDR[1:]

#: 底色同色框的线宽（八分之一磅）：0.5pt 的细框只为把底纹撑开，颜色等于底色，看不见。
_PAD_BORDER_SZ = 4

#: `left_bar` 的左侧竖条：run 级 `w:bdr` 只能画整个矩形框，用方块字形模拟单边（见 docstring 第 4 条）。
_LEFT_BAR_GLYPH = "\u258e"

#: `dot` 形态的标签分隔符（compact 的 `li::after { content: "·" }`，与 PDF 同一个字形）。
_TAG_SEPARATOR = "\u00b7"

#: 一个空格的估算宽度（em）：用来把 `tag_gap_x` 里"空格本身已经贡献的部分"扣掉。
_SPACE_EM = 0.25


def tag_labels(section: SectionPlan) -> list[str]:
    """inline 分区的每一行 → 一个标签文本（与 PDF `draw_skill_tags` 的 labels 同口径）。

    条目内的字段用 `CELL_JOIN`（「 · 」）连接、括号延续不补分隔符——这两个规则都只有
    `join_cell_texts` 一处定义，Word 不复述第二遍。
    """
    labels: list[str] = []
    for row in section.rows:
        text = join_cell_texts(rich_text(cell.segments) for cell in row).strip()
        if text:
            labels.append(text)
    return labels


def tag_text_color(
    layout, *, accent: tuple[int, int, int], theme: DocxTheme
) -> tuple[int, int, int]:
    """标签字色：模板 `.skill-list li` 写的是 `var(--accent)` / `var(--text)` / 未写（继承正文）。

    与 PDF `skill_tags._tag_text_color` 同一张映射表；三种取值之外一律按"继承正文"处理。
    """
    choice = str(getattr(layout, "tag_fg", "body") or "body")
    if choice == "accent":
        return accent
    if choice == "muted":
        return theme.muted_text
    return theme.body_text


def decorate_run(
    run,
    *,
    fill: tuple[int, int, int] | None = None,
    border_color: tuple[int, int, int] | None = None,
    border_sz: int = _PAD_BORDER_SZ,
    space_pt: float = 0.0,
) -> None:
    """给**一个 run** 加底纹 / 边框（字符级的"标签块"）。

    与段落级的 `decorate_paragraph` 是两件事：字符底纹只铺到字形所在的行盒，所以色块要靠
    同色边框 + `w:space` 撑出内边距（见模块 docstring）。`w:bdr` 没有逐边子元素，四边等宽。

    :param fill: 底纹颜色；None = 不填底纹。
    :param border_color: 边框颜色；None = 不画边框。
    :param border_sz: 边框粗细，单位是八分之一磅（见 `border_sz_from_px`）。
    :param space_pt: 边框与文字的距离（磅），用来模拟 CSS 的左右 padding。
    """
    rPr = run._r.get_or_add_rPr()
    if border_color is not None:
        bdr = OxmlElement("w:bdr")
        bdr.set(qn("w:val"), "single")
        bdr.set(qn("w:sz"), str(max(2, min(96, int(border_sz)))))
        bdr.set(qn("w:space"), str(int(round(max(0.0, float(space_pt))))))
        bdr.set(qn("w:color"), rgb_hex(border_color))
        rPr.insert_element_before(bdr, *_RPR_AFTER_BDR)
    if fill is not None:
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), rgb_hex(fill))
        rPr.insert_element_before(shd, *_RPR_AFTER_SHD)


def _add_gap_run(
    node,
    *,
    gap_pt: float,
    size_pt: float,
    text_color: tuple[int, int, int],
    set_font,
) -> None:
    """标签之间的横向间距：一个空格 + 字符间距补齐到 `tag_gap_x`。

    Word 没有 run 级的 margin。空格本身按 0.25em 估宽（比例字体下约等于 CSS 的一个空格），
    差额用 `w:spacing`（字符间距）补——这是唯一能给出"稳定标签间距"而不引入表格的手段。
    **空格同时是折行点**，与 CSS 里两个 `inline-block` 之间的空白同语义：标签在词边界处
    换行，不会把两个标签粘成一片。
    """
    run = node.add_run(" ")
    extra_pt = max(0.0, float(gap_pt) - _SPACE_EM * float(size_pt))
    set_font(run, size_pt=size_pt, color=text_color, letter_spacing_pt=extra_pt or None)


def draw_inline_section(
    doc,
    section: SectionPlan,
    *,
    base: float,
    layout,
    theme: DocxTheme,
    role_style: RoleStyleQuery | None,
    accent: tuple[int, int, int],
) -> None:
    """把 inline 分区（专业技能 / 语言能力）写成"一行一个标签块"的一段多 run 文本。

    形状全部读 `ResumeLayout` 的 `tag_*`（那份又由 `TEMPLATE_LAYOUT_DEFAULTS` 从模板 CSS
    抄过来、被守卫测试逐条核对），本函数不保留任何比例副本。

    五种形态与 CSS 的对应：

    * ``fill``     —— 底色 + 同色框撑内边距（classic / elegant）；
    * ``outline``  —— 强调色描边（modern / split 的胶囊，圆角表达不出来）；
    * ``left_bar`` —— 底色 + 左侧竖条（technical，竖条用「▎」模拟，见 docstring 第 4 条）；
    * ``dot``      —— 无底色，标签后跟「·」分隔（compact）；
    * ``plain``    —— 纯文字（minimal / scholar / editorial）。

    不新增段落：整个分区的标签写在**同一段**里，由 Word 在标签之间的空格处自然折行
    （见 `_add_gap_run`）。只用 `w:br` 强行分行会在标签宽度未知时提前/滞后断行，反而与
    预览的换行位置差得更远。
    """
    labels = tag_labels(section)
    if not labels:
        return
    style = style_of(role_style, "body")
    tag_style = str(getattr(layout, "tag_style", "plain") or "plain")
    size_px = base * float(layout.tag_font_ratio) * scale_of(style)
    size_pt = size_px * _PX_TO_PT
    fill = _hex_to_rgb(str(getattr(layout, "tag_bg", "none") or "none"))
    text_color = color_of(style, tag_text_color(layout, accent=accent, theme=theme))
    pad_pt = size_px * float(getattr(layout, "tag_pad_x", 0.0) or 0.0) * _PX_TO_PT
    gap_pt = size_px * float(getattr(layout, "tag_gap_x", 0.0) or 0.0) * _PX_TO_PT
    border_sz = border_sz_from_px(float(getattr(layout, "tag_border_px", 0.0) or 0.0))

    box_fill: tuple[int, int, int] | None = None
    box_border: tuple[int, int, int] | None = None
    box_sz = _PAD_BORDER_SZ
    if tag_style in ("fill", "left_bar"):
        # 底色块：框与底色同色（看不见），靠 w:space 把底纹撑成"有内边距的色带"。
        box_fill = fill
        box_border = fill
    elif tag_style == "outline":
        # 描边胶囊：只有边框、没有底色。圆角在 OOXML 里表达不出来（= 直角框）。
        box_border = accent
        box_sz = border_sz

    node = paragraph(doc)
    if style is not None and style.align is not None:
        node.paragraph_format.alignment = align_value(style.align)
    if style is not None and style.line_height:
        node.paragraph_format.line_spacing = float(style.line_height)
    set_font = partial(set_run_font, font_name=theme.font_name)
    for index, label in enumerate(labels):
        if index:
            _add_gap_run(
                node,
                gap_pt=gap_pt,
                size_pt=size_pt,
                text_color=text_color,
                set_font=set_font,
            )
        start = len(node.runs)
        if tag_style == "left_bar":
            bar = node.add_run(_LEFT_BAR_GLYPH)
            set_font(bar, size_pt=size_pt, color=accent)
        add_rich_runs(node, label, set_font, size_pt=size_pt, color=text_color)
        for run in node.runs[start:]:
            decorate_run(
                run,
                fill=box_fill,
                border_color=box_border,
                border_sz=box_sz,
                space_pt=pad_pt,
            )
        if tag_style == "dot" and index < len(labels) - 1:
            separator = node.add_run(_TAG_SEPARATOR)
            set_font(separator, size_pt=size_pt, color=theme.muted_text)


__all__ = ["decorate_run", "draw_inline_section", "tag_labels", "tag_text_color"]

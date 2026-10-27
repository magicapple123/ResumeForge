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
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial

from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

# 段落底纹/边框（纯 OOXML 拼装）拆到 docx_decorate；本模块 re-export 维持既有导入路径。
from .docx_decorate import decorate_paragraph
from .docx_fonts import DOCX_FONT, resolve_docx_font_name
from .docx_rich import add_rich_runs
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

def resolve_docx_theme(template: str, format_config: dict | None) -> DocxTheme:
    """一次导出的主题：字体族 + 正文/辅助色（颜色与 PDF 同一条解析：版式覆盖 → 模板 → 兜底）。"""
    from .pdf_exporter import resolve_muted, resolve_text

    overrides = format_config if isinstance(format_config, dict) else {}
    return DocxTheme(
        font_name=resolve_docx_font_name(overrides.get(FONT_KEY)),
        body_text=resolve_text(template, format_config),
        muted_text=resolve_muted(template, format_config),
    )


def set_run_font(
    run,
    *,
    size_pt: float,
    bold: bool = False,
    italic: bool = False,
    color: tuple[int, int, int] | None = None,
    font_name: str = DOCX_FONT,
) -> None:
    """统一设置 run 的字体 / 字号 / 颜色，并补上 east-asian 字体（否则中文会回退默认字体）。

    `font_name` 由调用方从 DocxTheme 取（= 这份简历所选字体的真实族名）；缺省保持历史
    默认值，所以既有调用点（测试、其它导出）行为不变。
    """
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    # W07 协议 v2：斜体只在为真时写属性（显式 False 会在 OOXML 落 w:i val="0"，
    # 让所有旧产物平白多一层属性）。加粗仍按历史口径显式写。
    if italic:
        run.font.italic = True
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), font_name)
    if color is not None:
        run.font.color.rgb = RGBColor(color[0], color[1], color[2])


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
    """项目符号列表：与预览 ``<ul><li>`` 一样**悬挂缩进**（圆点挂左、文字对齐到 3mm）。"""
    size = base * _style_scale(style)
    color = _style_color(style, theme.body_text)
    bullet = {"dot": "•", "dash": "–", "none": ""}.get(
        style.bullet if style is not None and style.bullet else "dot", "•"
    )
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        # W08：一条要点不跨页（Word 的 w:keepLines）；超高条目由 Word 自己劈开。
        node = paragraph(doc, indent_mm=indent_mm, keep_together=True)
        node.paragraph_format.first_line_indent = Mm(-indent_mm)
        if style is not None and style.line_height:
            node.paragraph_format.line_spacing = float(style.line_height)
        add_rich_runs(
            node,
            f"{bullet} {text}" if bullet else text,
            partial(set_run_font, font_name=theme.font_name),
            size_pt=size * _PX_TO_PT,
            color=color,
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
        size_pt=title_size * _PX_TO_PT,
        color=_style_color(style, theme.body_text),
    )
    if not right:
        return
    if meta_style is not None and meta_style.meta_align == "inline":
        add_rich_runs(
            node,
            f" · {right}",
            partial(set_run_font, font_name=theme.font_name),
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
        size_pt=base * layout.entry_meta_ratio * _PX_TO_PT * _style_scale(meta_style),
        color=_style_color(meta_style, theme.muted_text),
    )


def float_picture(run, *, align: str = "right", vertical_offset_mm: float = 0.0) -> bool:
    """把 ``run`` 里刚插入的图片从**嵌入型**改成「**浮于文字上方**」（不占行高）。

    ## 为什么必须改

    ``add_picture()`` 只会产出 `wp:inline`：图片是正文流里的一个"大号字符"，独占一行
    并按行高把后面的内容整体下推。而预览里的照片是页头右侧的一列——姓名、意向、联系
    方式在左边同一行。于是同一份简历：

    * 预览：页头高度 = 姓名那几行；
    * Word（嵌入型）：照片先占掉整整一行（约 7mm + 段距），姓名被顶到下面，
      页头凭空高出一截，后面的分页跟着往后错。

    改成浮动之后图片脱离正文流，姓名回到第一行、照片贴右上角，页头高度与预览一致。
    用户实测过：手动把照片改成「浮于文字上方」，Word 版就对上了。

    ## OOXML 口径

    「浮于文字上方」= `wp:anchor` + `behindDoc="0"` + `<wp:wrapNone/>`。
    「衬于文字下方」用的是**同一个** `wrapNone`，区别只在 `behindDoc="1"`，别写反。
    `wrapNone` 意味着文字**不绕排**、会从图片底下穿过去——所以照片要贴在版心边缘，
    页头文字本来就短，重合概率很低；真压住了，调小照片或缩短姓名即可。

    子元素顺序由 schema 固定（`simplePos → positionH → positionV → extent →
    effectExtent → wrap* → docPr → cNvGraphicFramePr → graphic`），顺序错了 Word 会
    判定文件损坏、直接拒绝打开——这是本函数唯一需要小心的地方。

    :param run: 已经 `add_picture()` 过的 run。
    :param align: ``"right"``（默认，贴版心右缘）/ ``"left"``（elegant 这类照片在左的模板）。
    :param vertical_offset_mm: 相对锚点段落顶部的下移量（mm）。照片改成"按原图比例装进
        照片框（contain）"之后，框内上下留白由调用方算好传进来，与 CSS
        `object-fit: contain` 的垂直居中同一定位；默认 0 = 贴段首（旧行为）。
    :returns: 是否真的转换成功；没有图片或结构不认识时返回 ``False``（调用方决定是否回退）。
    """
    drawing = run._element.find(qn("w:drawing"))
    if drawing is None:
        return False
    inline = drawing.find(qn("wp:inline"))
    if inline is None:
        return False

    anchor = OxmlElement("wp:anchor")
    for name, value in (
        ("distT", "0"),
        ("distB", "0"),
        ("distL", "0"),
        ("distR", "0"),
        ("simplePos", "0"),
        # z 序：数值越大越靠上。给一个"高于普通文字、低于批注"的常规值即可。
        ("relativeHeight", "251658240"),
        # 「浮于文字上方」：不进背景层。
        ("behindDoc", "0"),
        ("locked", "0"),
        ("layoutInCell", "1"),
        ("allowOverlap", "1"),
    ):
        anchor.set(name, value)

    simple_pos = OxmlElement("wp:simplePos")
    simple_pos.set("x", "0")
    simple_pos.set("y", "0")
    anchor.append(simple_pos)

    # 水平：以**版心**为参照对齐，照片因此贴正文右缘（左缘），不受段落缩进影响。
    position_h = OxmlElement("wp:positionH")
    position_h.set("relativeFrom", "margin")
    align_node = OxmlElement("wp:align")
    align_node.text = align
    position_h.append(align_node)
    anchor.append(position_h)

    # 垂直：以**所在段落**为参照、偏移 0——锚在姓名那一段上，页头一动它跟着动，
    # 不会跑到纸张最顶上（那样翻到第 2 页时照片会跟着"消失"在页首）。
    position_v = OxmlElement("wp:positionV")
    position_v.set("relativeFrom", "paragraph")
    offset = OxmlElement("wp:posOffset")
    # 0mm 仍写 "0"（与改动前的字节完全一致）；有偏移时用 EMU（1mm = 36000 EMU）。
    offset.text = "0" if vertical_offset_mm == 0 else str(int(round(Mm(vertical_offset_mm).emu)))
    position_v.append(offset)
    anchor.append(position_v)

    # 以下节点原样搬过来（不重建），保证图片数据、alt 文本与尺寸一个字节都不丢。
    for tag in ("wp:extent", "wp:effectExtent"):
        node = inline.find(qn(tag))
        if node is not None:
            anchor.append(node)
    anchor.append(OxmlElement("wp:wrapNone"))
    for tag in ("wp:docPr", "wp:cNvGraphicFramePr", "a:graphic"):
        node = inline.find(qn(tag))
        if node is not None:
            anchor.append(node)

    drawing.replace(inline, anchor)
    return True

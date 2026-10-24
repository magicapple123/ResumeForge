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

from docx.enum.text import WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor

from .docx_rich import add_rich_runs
from .pdf_exporter import _PX_TO_MM, _PX_TO_PT, PAGE_WIDTH_MM

# Word 里写的是字体名，最终由用户机器上的 Word 解析；用微软雅黑与 PDF 首选字体一致。
DOCX_FONT = "微软雅黑"

# 正文 / 辅助文字颜色与 PDF 的 `set_text_color` 保持一致（强调色另从模板解析）。
_BODY_COLOR = (31, 41, 55)
_MUTED_COLOR = (107, 114, 128)


def set_run_font(
    run, *, size_pt: float, bold: bool = False, color: tuple[int, int, int] | None = None
) -> None:
    """统一设置 run 的字体 / 字号 / 颜色，并补上 east-asian 字体（否则中文会回退默认字体）。"""
    run.font.name = DOCX_FONT
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), DOCX_FONT)
    if color is not None:
        run.font.color.rgb = RGBColor(color[0], color[1], color[2])


def paragraph(
    doc, *, indent_mm: float = 0.0, space_after_mm: float = 0.0, space_before_mm: float = 0.0
):
    """新建一个段落，并把"缩进 / 段前 / 段后"一次性设成版式要求的毫米值。"""
    result = doc.add_paragraph()
    result.paragraph_format.left_indent = Mm(indent_mm)
    result.paragraph_format.space_after = Mm(space_after_mm)
    result.paragraph_format.space_before = Mm(space_before_mm)
    return result


# pPr 里各子元素的**顺序由 schema 固定**：底纹必须排在 `w:pBdr` 之后、`w:tabs` 之前，
# 边框必须排在 `w:spacing` / `w:ind` 之前。顺序错了 Word 会判定文件损坏——python-docx
# 的 `insert_element_before` 就是干这件事的，这里把"在它后面的那些标签"一次写全。
_PPR_AFTER_BDR = (
    "w:shd",
    "w:tabs",
    "w:suppressAutoHyphens",
    "w:kinsoku",
    "w:wordWrap",
    "w:overflowPunct",
    "w:topLinePunct",
    "w:autoSpaceDE",
    "w:autoSpaceDN",
    "w:bidi",
    "w:adjustRightInd",
    "w:snapToGrid",
    "w:spacing",
    "w:ind",
    "w:contextualSpacing",
    "w:mirrorIndents",
    "w:suppressOverlap",
    "w:jc",
    "w:textDirection",
    "w:textAlignment",
    "w:textboxTightWrap",
    "w:outlineLvl",
    "w:divId",
    "w:cnfStyle",
    "w:rPr",
    "w:sectPr",
    "w:pPrChange",
)
_PPR_AFTER_SHD = _PPR_AFTER_BDR[1:]

# `w:pBdr` 的子元素顺序同样是固定的：top → left → bottom → right。
_BORDER_ORDER = ("top", "left", "bottom", "right")


def _rgb_hex(color: tuple[int, int, int]) -> str:
    """(r, g, b) → OOXML 要的 `RRGGBB`（不带 `#`）。"""
    return "".join(f"{max(0, min(255, int(channel))):02X}" for channel in color)


def decorate_paragraph(
    paragraph,
    *,
    fill: tuple[int, int, int] | None = None,
    edges: tuple[str, ...] | None = None,
    border_color: tuple[int, int, int] | None = None,
    border_sz: int = 4,
    space_pt: float = 4.0,
) -> None:
    """给段落加**底纹 / 边框**——Word 里唯一能表达"色块"的手段。

    ## 为什么需要 `space_pt`

    Word 的段落底纹只铺到"文字所在的行盒"，不像 CSS 的 `padding` 会把背景撑开。所以
    底色块要配一圈**与底色同色**的边框，`w:space` 把边框推离文字几个磅——底纹一直铺到
    边框，看起来就是有内边距的色带。边框颜色等于底色时它自己看不见。

    ## 与 CSS 的差距（如实说）

    - **没有圆角**：OOXML 的段落边框/底纹都是矩形，`border-radius` 表达不出来。
      modern 那种胶囊形标题在 Word 里会变成直角色带。
    - 底纹高度由"行高 + 上下 space"决定，与 CSS 的 `line-height + padding` 会差 1–2pt。

    :param fill: 底纹颜色；``None`` = 不填底纹。
    :param edges: 要画的边框边（top/left/bottom/right 的子集）；``None`` = 不画边框。
    :param border_color: 边框颜色，缺省跟随底纹。
    :param border_sz: 边框粗细，单位是**八分之一磅**（4px ≈ 3pt ≈ 24）。
    :param space_pt: 边框与文字之间的距离（磅），用来模拟 CSS 的 padding。
    """
    pPr = paragraph._p.get_or_add_pPr()
    if edges:
        pBdr = OxmlElement("w:pBdr")
        for edge in _BORDER_ORDER:
            if edge not in edges:
                continue
            node = OxmlElement(f"w:{edge}")
            node.set(qn("w:val"), "single")
            node.set(qn("w:sz"), str(border_sz))
            node.set(qn("w:space"), str(int(round(space_pt))))
            node.set(qn("w:color"), _rgb_hex(border_color or fill or (0, 0, 0)))
            pBdr.append(node)
        pPr.insert_element_before(pBdr, *_PPR_AFTER_BDR)
    if fill is not None:
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), _rgb_hex(fill))
        pPr.insert_element_before(shd, *_PPR_AFTER_SHD)


def _title_text_color(layout, accent: tuple[int, int, int]) -> tuple[int, int, int]:
    """区块标题的文字色，与模板 `section_title_text` 同一口径。"""
    choice = getattr(layout, "section_title_text", "accent")
    if choice == "white":
        return (255, 255, 255)
    if choice == "body":
        return _BODY_COLOR
    if choice == "muted":
        return _MUTED_COLOR
    return accent


def section_title(
    doc,
    text: str,
    base: float,
    layout,
    accent: tuple[int, int, int],
    accent_soft: tuple[int, int, int],
) -> None:
    """区块标题：字号用 ``section_title_ratio``、形状用 ``section_title_style``。

    **形状必须与预览一致**：模板里 `.section-title` 有的带底色块（modern / technical）、
    有的只有一条左竖条（classic）。Word 此前一律"加粗 + 强调色"，导出后看不到预览里
    那一条条色带——这是"Word 版和预览差别很大"的一部分。现在按 `section_title_style`
    补上底纹 / 左竖条（圆角表达不出来，见 `decorate_paragraph`）。
    """
    size = base * layout.section_title_ratio
    gap_mm = base * _PX_TO_MM * layout.section_gap
    node = paragraph(doc, space_before_mm=gap_mm, space_after_mm=base * _PX_TO_MM * 0.4)

    style = getattr(layout, "section_title_style", "plain")
    if style == "soft_box":
        # 浅底色块：四边画同色细框把底纹撑开，模拟 CSS 的 padding。
        decorate_paragraph(
            node,
            fill=accent_soft,
            edges=("top", "left", "bottom", "right"),
            border_color=accent_soft,
            border_sz=4,
            space_pt=5,
        )
    elif style == "accent_box":
        decorate_paragraph(
            node,
            fill=accent,
            edges=("top", "left", "bottom", "right"),
            border_color=accent,
            border_sz=4,
            space_pt=5,
        )
    elif style == "left_bar":
        # classic 的左竖条：4px ≈ 3pt ≈ 24 个八分之一磅。
        decorate_paragraph(node, edges=("left",), border_color=accent, border_sz=24, space_pt=6)

    add_rich_runs(
        node,
        text,
        set_run_font,
        bold=True,
        size_pt=size * _PX_TO_PT,
        color=_title_text_color(layout, accent),
    )


def bullets(doc, items: list[str], *, base: float, indent_mm: float = 3.0) -> None:
    """项目符号列表：与预览 ``<ul><li>`` 一样**悬挂缩进**（圆点挂左、文字对齐到 3mm）。"""
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        node = paragraph(doc, indent_mm=indent_mm)
        node.paragraph_format.first_line_indent = Mm(-indent_mm)
        add_rich_runs(node, f"• {text}", set_run_font, size_pt=base * _PX_TO_PT, color=_BODY_COLOR)


def meta_line(doc, text: str, *, base: float, layout) -> None:
    """条目下的副行（绩点 / 核心课程 / 技术栈）：小一号的灰字。"""
    if not text.strip():
        return
    node = paragraph(doc)
    add_rich_runs(
        node,
        text,
        set_run_font,
        size_pt=base * layout.entry_sub_ratio * _PX_TO_PT,
        color=_MUTED_COLOR,
    )


def entry_head(doc, left: str, right: str, *, base: float, layout) -> None:
    """条目标题：左侧加粗、右侧辅助信息**右对齐**（与预览 ``.entry-head`` 同效）。"""
    title_size = base * layout.entry_title_ratio
    node = paragraph(doc, space_before_mm=base * _PX_TO_MM * 0.2)
    add_rich_runs(
        node, left, set_run_font, bold=True, size_pt=title_size * _PX_TO_PT, color=_BODY_COLOR
    )
    if not right:
        return
    # 制表位定在版心右边缘：无论左边标题多长，日期都停在同一列。
    node.paragraph_format.tab_stops.add_tab_stop(
        Mm(PAGE_WIDTH_MM - layout.margin_left - layout.margin_right), WD_TAB_ALIGNMENT.RIGHT
    )
    add_rich_runs(
        node,
        f"\t{right}",
        set_run_font,
        size_pt=base * layout.entry_meta_ratio * _PX_TO_PT,
        color=_MUTED_COLOR,
    )


def float_picture(run, *, align: str = "right") -> bool:
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
    offset.text = "0"
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

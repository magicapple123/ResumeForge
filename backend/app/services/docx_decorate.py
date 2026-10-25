# SPDX-License-Identifier: Apache-2.0
"""Word 段落的底纹 / 边框（W05 的色块表达，W21 从 docx_blocks 拆出）。

**为什么单独成文件**：docx_blocks.py 在 W07/W08 补了 keepLines/keepNext 与斜体后贴住
500 行预算（tests/test_file_size_budget.py 的硬线）。底纹/边框是纯 OOXML 拼装，与
"简历语义"无关，搬出来最干净；docx_blocks 仍 re-export decorate_paragraph，既有导入
路径（docx_exporter / docx_sections）不变。

口径不变：pPr 子元素顺序由 OOXML schema 固定，顺序错了 Word 会判定文件损坏。
"""

from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn

# pPr 里各子元素的**顺序由 schema 固定**：底纹必须排在 w:pBdr 之后、w:tabs 之前，
# 边框必须排在 w:spacing / w:ind 之前。顺序错了 Word 会判定文件损坏——python-docx
# 的 insert_element_before 就是干这件事的，这里把"在它后面的那些标签"一次写全。
PPR_AFTER_BDR = (
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
_PPR_AFTER_SHD = PPR_AFTER_BDR[1:]

# w:pBdr 的子元素顺序同样是固定的：top -> left -> bottom -> right。
_BORDER_ORDER = ("top", "left", "bottom", "right")


def _rgb_hex(color: tuple[int, int, int]) -> str:
    """(r, g, b) -> OOXML 要的 RRGGBB（不带 #）。"""
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

    ## 为什么需要 space_pt

    Word 的段落底纹只铺到"文字所在的行盒"，不像 CSS 的 padding 会把背景撑开。所以
    底色块要配一圈**与底色同色**的边框，w:space 把边框推离文字几个磅——底纹一直铺到
    边框，看起来就是有内边距的色带。边框颜色等于底色时它自己看不见。

    ## 与 CSS 的差距（如实说）

    - **没有圆角**：OOXML 的段落边框/底纹都是矩形，border-radius 表达不出来。
      modern 那种胶囊形标题在 Word 里会变成直角色带。
    - 底纹高度由"行高 + 上下 space"决定，与 CSS 的 line-height + padding 会差 1-2pt。

    :param fill: 底纹颜色；None = 不填底纹。
    :param edges: 要画的边框边（top/left/bottom/right 的子集）；None = 不画边框。
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
        pPr.insert_element_before(pBdr, *PPR_AFTER_BDR)
    if fill is not None:
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), _rgb_hex(fill))
        pPr.insert_element_before(shd, *_PPR_AFTER_SHD)


__all__ = ["PPR_AFTER_BDR", "decorate_paragraph"]

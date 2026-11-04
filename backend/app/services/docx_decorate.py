# SPDX-License-Identifier: Apache-2.0
"""Word 段落的底纹 / 边框（W05 的色块表达，W21 从 docx_blocks 拆出）。

**为什么单独成文件**：docx_blocks.py 在 W07/W08 补了 keepLines/keepNext 与斜体后贴住
500 行预算（tests/test_file_size_budget.py 的硬线）。底纹/边框是纯 OOXML 拼装，与
"简历语义"无关，搬出来最干净；docx_blocks 仍 re-export decorate_paragraph，既有导入
路径（docx_exporter / docx_sections）不变。

口径不变：pPr 子元素顺序由 OOXML schema 固定，顺序错了 Word 会判定文件损坏。

**2026-11 追加：合并而不是叠加**。`decorate_paragraph` 现在会把新的边**合并**进已有的
`w:pBdr` / `w:shd`，而不是再塞一个同标签元素——同一段落被装饰两次时（页头底色块 + 页头
底边线这类组合）产出的仍是**一个** `w:pBdr`。两个 `w:pBdr` 不合 schema，Word 会判定
文件损坏，而"页头既有浅底色块又有底边线"正是自定义模板可能的组合。
"""

from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from .pdf_exporter import _PX_TO_PT

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


def rgb_hex(color: tuple[int, int, int]) -> str:
    """(r, g, b) -> OOXML 要的 RRGGBB（不带 #）。

    也被 `docx_skill_tags` 用来写 run 级 `w:shd` / `w:bdr` 的颜色——色值口径只有这一处。
    """
    return "".join(f"{max(0, min(255, int(channel))):02X}" for channel in color)


def border_sz_from_px(width_px: float) -> int:
    """CSS 线宽（px）→ OOXML 的**八分之一磅**（`w:sz`）。

    换算链与预览一致：1px = 0.75pt（96dpi），所以 2px ≈ 1.5pt ≈ 12 个八分之一磅。
    结果夹在 2…96 —— Word 只认这个区间，0 等于"不画"，大于 96 会被判定为非法值。

    抽成函数是因为页头底边线（`header_border_width`）与技能标签描边
    （`tag_border_px`）都要换算，而"2px → 12"这种常量散落在两处就是下一个漂移点。
    """
    return max(2, min(96, int(round(float(width_px) * _PX_TO_PT * 8))))


def _upsert_border(pBdr, edge: str, *, sz: int, space: int, color: str) -> None:
    """把一条边**写进**（或替换进）已存在的 `w:pBdr`，位置保持 schema 顺序。"""
    existing = pBdr.find(qn(f"w:{edge}"))
    if existing is not None:
        pBdr.remove(existing)
    node = OxmlElement(f"w:{edge}")
    node.set(qn("w:val"), "single")
    node.set(qn("w:sz"), str(sz))
    node.set(qn("w:space"), str(space))
    node.set(qn("w:color"), color)
    # 只能排在自己后面那几条边之前：pBdr 的子元素顺序是 top → left → bottom → right。
    successors = {
        qn(f"w:{later}") for later in _BORDER_ORDER[_BORDER_ORDER.index(edge) + 1 :]
    }
    for position, child in enumerate(pBdr):
        if child.tag in successors:
            pBdr.insert(position, node)
            return
    pBdr.append(node)


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

    ## 合并语义（2026-11）

    同一段落被调用两次时（页头"浅底色块 + 底边线"），新的边替换同名的旧边，**不新增第二个
    `w:pBdr`**；`fill` 同样覆盖已有的 `w:shd/@w:fill`。首次调用产出的 XML 与改动前逐字节
    相同。

    :param fill: 底纹颜色；None = 不填底纹。
    :param edges: 要画的边框边（top/left/bottom/right 的子集）；None = 不画边框。
    :param border_color: 边框颜色，缺省跟随底纹。
    :param border_sz: 边框粗细，单位是**八分之一磅**（4px ≈ 3pt ≈ 24）。
    :param space_pt: 边框与文字之间的距离（磅），用来模拟 CSS 的 padding。
    """
    pPr = paragraph._p.get_or_add_pPr()
    if edges:
        pBdr = pPr.find(qn("w:pBdr"))
        created = pBdr is None
        if pBdr is None:
            pBdr = OxmlElement("w:pBdr")
        color = rgb_hex(border_color or fill or (0, 0, 0))
        for edge in _BORDER_ORDER:
            if edge not in edges:
                continue
            _upsert_border(
                pBdr,
                edge,
                sz=int(border_sz),
                space=int(round(max(0.0, float(space_pt)))),
                color=color,
            )
        if created:
            pPr.insert_element_before(pBdr, *PPR_AFTER_BDR)
    if fill is not None:
        shd = pPr.find(qn("w:shd"))
        if shd is None:
            shd = OxmlElement("w:shd")
            shd.set(qn("w:val"), "clear")
            shd.set(qn("w:color"), "auto")
            pPr.insert_element_before(shd, *_PPR_AFTER_SHD)
        shd.set(qn("w:fill"), rgb_hex(fill))


__all__ = ["PPR_AFTER_BDR", "border_sz_from_px", "decorate_paragraph", "rgb_hex"]

# SPDX-License-Identifier: Apache-2.0
"""Word run（字符级）样式原语：字体 / 字号 / 颜色 / 字符间距。

从 ``docx_blocks.py`` 拆出（2026-10-31，**纯搬迁**）：Q11 补齐字距与加粗/斜体后
``docx_blocks`` 超过 500 行预算，而"设置一个 run 的字体字号颜色"与"段落语义
（区块标题 / 条目头 / 列表）"不是同一层职责。调用方仍可从 ``docx_blocks`` 导入
（那里保留 re-export），既有 import 路径不变。
"""

from __future__ import annotations

from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

from .docx_fonts import DOCX_FONT


def set_letter_spacing(run, letter_spacing_pt: float) -> None:
    """给 run 写字符间距（OOXML `w:spacing`，单位 = 1/20 磅）。

    ## 为什么必须手工插 XML

    python-docx 的 `run.font` 没有字符间距 API，而 `w:rPr` 的子元素顺序由 schema 固定：
    rFonts → b → i → color → **spacing** → sz → szCs → …。直接 `append` 到 rPr 末尾会产出
    不合 schema 的顺序，Word 可能整篇拒绝打开；这里用 `insert_element_before` 插在
    `w:sz` 之前。0 间距不写（默认产物逐字节不变）。
    """
    if not letter_spacing_pt:
        return
    from docx.oxml import OxmlElement

    rpr = run._element.get_or_add_rPr()
    spacing = rpr.find(qn("w:spacing"))
    if spacing is None:
        spacing = OxmlElement("w:spacing")
        rpr.insert_element_before(
            spacing,
            "w:w",
            "w:kern",
            "w:position",
            "w:sz",
            "w:szCs",
            "w:highlight",
            "w:u",
            "w:effect",
            "w:bdr",
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
    spacing.set(qn("w:val"), str(int(round(letter_spacing_pt * 20))))


def set_run_font(
    run,
    *,
    size_pt: float,
    bold: bool = False,
    italic: bool = False,
    color: tuple[int, int, int] | None = None,
    font_name: str = DOCX_FONT,
    letter_spacing_pt: float | None = None,
) -> None:
    """统一设置 run 的字体 / 字号 / 颜色 / 可选字符间距，并补 east-asian 字体。

    `font_name` 由调用方从 DocxTheme 取（= 这份简历所选字体的真实族名）；缺省保持历史
    默认值，所以既有调用点（测试、其它导出）行为不变。`letter_spacing_pt` 为 None 或 0
    时不写 `w:spacing`（旧产物零变化）。
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
    if letter_spacing_pt:
        set_letter_spacing(run, letter_spacing_pt)

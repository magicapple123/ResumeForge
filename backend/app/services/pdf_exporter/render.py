# SPDX-License-Identifier: Apache-2.0
"""PDF 结果对象与字体注册（v2 起绘制编排在 document_render.py）。

历史上本文件是"每个分区怎么画"的编排中心；v2 把字段拼装全部交给 planner 之后，这里只
保留两件与文档语义无关的通用能力：

* ResumePDF：渲染结果（字节 + 页数 + 是否截断 + 画出的字 + W08 绘制日志）；
* _register_fonts：把中文 TTF/TTC 注册进 fpdf2 画布（失败的异常翻成可读提示）。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fpdf import FPDF

from .fonts import FONT_FAMILY, ResumePDFError


@dataclass(frozen=True)
class ResumePDF:
    """生成好的 PDF，连同它的页数与"装不装得下"的结论。

    pages 是文件里实际排出的页数（超出上限时被截断，因此恒 <= 上限）；
    pages_needed 是按当前参数真实需要的页数（未截断），界面用来说"约需 N 页"；
    overflow 表示"按当前参数放不进所选页数，尾部已被截断"。

    三者必须彼此自洽：overflow 为真 ⇔ pages_needed > pages。这里没有"缩放"字段：
    装不下就如实标记并提示用户，绝不替用户把字号压小——滑杆上的字号必须等于纸面上的字号。
    """

    content: bytes
    pages: int
    pages_needed: int | None = None
    overflow: bool = False
    # 这一趟真正画出去的字。只给字体预子集化用（见 font_subset）。
    chars: frozenset[str] = frozenset()
    # W08：绘制日志（语义锚点；报告端点用）。默认空 tuple，旧调用方零影响。
    spans: tuple = ()


def _register_fonts(pdf: FPDF, regular: str, bold: str) -> None:
    """注册正文字体与粗体；字体解析失败要变成可读提示而不是底层异常。"""
    try:
        pdf.add_font(FONT_FAMILY, "", regular)
        pdf.add_font(FONT_FAMILY, "B", bold)
    except Exception as exc:  # noqa: BLE001 - 字体解析失败要变成可读提示
        raise ResumePDFError(f"加载中文字体失败（{Path(regular).name}）：{exc}") from exc


__all__ = ["ResumePDF", "_register_fonts"]

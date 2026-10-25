# SPDX-License-Identifier: Apache-2.0
"""Word 导出里的字符级行内标记：把协议 v2 拆成**多个 run**。

python-docx 的加粗/斜体是 run 级属性（run.font.bold / run.font.italic），没有"段内局部
样式"的说法，所以一段里既有粗体又有普通字时，必须拆成多个 run——每个 run 自己带字体/
字号/颜色。docx_exporter 里本来就把字体设置集中在 _set_run_font，这里只负责"拆"，不重复
写任何字号/颜色口径：拆分不改变原段落**第一个 run 之外一个字段都没动**的事实。

**链接在 Word 里按可见文本处理**：输出 "文字 (URL)"，不创建 OOXML 超链接关系——
能力矩阵把 docx.link_clickable 标 approx（可见 URL 文本替代点击），与 PDF 同一条口径，
四个渲染器不为"能不能点"各写一套。

放在独立模块而不是 docx_exporter.py 里，是因为那个文件已贴着 500 行预算
（见 tests/test_file_size_budget.py）。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .resume.resume_rich_text import parse_rich_runs

# _set_run_font(run, *, size_pt, bold=False, italic=False, color=None) 这类可调用对象的统一形状。
RunSetter = Callable[..., None]


def add_rich_runs(
    paragraph: Any,
    text: str,
    set_font: RunSetter,
    *,
    bold: bool = False,
    italic: bool = False,
    **font_kwargs: Any,
) -> None:
    """按协议 v2 把 text 拆成若干 run 追加到 paragraph。

    Args:
        paragraph: docx.text.paragraph.Paragraph；只要有 add_run 即可。
        text: 正文原文，可能含成对的行内标记（不配对的按字面保留）。
        set_font: 设置 run 字体的可调用对象，签名形如
            set_font(run, *, bold: bool, italic: bool, **font_kwargs)。
        bold / italic: 整段的"基础样式"（条目头这类本来就加粗的段落传 True）。
            片段自身的标记只会让它**更多样式**，不会把整段取消。
        **font_kwargs: 原样透传给 set_font（字号、颜色等）。

    Notes:
        文本为空时不追加任何 run：空 run 在 Word 里看不见，却会让"段落是否为空"的
        判断变得难以预料。
    """
    for span in parse_rich_runs(text):
        # 链接：可见文本 = label (URL)，与 PDF 的近似口径一致（不可点击但信息不丢）。
        body = span.readable(with_link=True) if span.link else span.text
        run = paragraph.add_run(body)
        set_font(
            run,
            bold=bold or span.bold,
            italic=italic or span.italic,
            **font_kwargs,
        )


__all__ = ["RunSetter", "add_rich_runs"]

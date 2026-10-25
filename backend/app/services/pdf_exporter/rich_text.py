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

from ..resume.resume_rich_text import parse_rich_runs

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


def to_fpdf_markup(text: str) -> tuple[str, bool]:
    """协议 v2 → (fpdf2 正文, 是否开 markdown)。

    没有加粗时 markdown=False，返回的正文与可见文本一致——正常简历走这条快速路径，
    产物与改动前逐字相同。只有存在成对加粗时才开启 markdown（fpdf2 的加粗是唯一能让
    纸面出现真粗体的方式）。
    """
    spans = parse_rich_runs(text)
    has_bold = any(span.bold for span in spans)
    if not has_bold and all(span.link is None and not span.italic for span in spans):
        # 快速路径：没有协议 v2 标记 → 原串原样返回（历史产物逐字节不变）。
        return text, False
    pieces: list[str] = []
    for span in spans:
        body = span.readable(with_link=True) if span.link else span.text
        if has_bold:
            body = escape_fpdf_markdown(body)
        pieces.append(f"**{body}**" if span.bold else body)
    return "".join(pieces), has_bold


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

# SPDX-License-Identifier: Apache-2.0
"""简历正文的字符级行内标记（协议 v2）：加粗、斜体、链接。

**为什么只有这一份实现**：用户能在正文里给某几个字加样式（"带 8 人团队"里那四个字加粗），
但同一份内容有六个消费方——HTML 预览/导出、精确/下载 PDF、Word、Markdown、TXT、ATS/
提示词。每个消费方各写一份标记解析，最后一定出现"预览里斜体了、导出 PDF 里露着星号"
这类不一致。所以本模块是**唯一**的标记定义处，其余模块只能消费 parse_rich_runs
（或本模块投影出来的纯文本函数）。

## 协议（wave2 契约 §2.7）

三种标记：成对的双星号＝加粗；成对的单星号＝斜体；方括号紧跟圆括号＝链接。
分层切分：先按双星号切（一对双星号永远是一个加粗区间，不会被当成两个斜体），
再在每段里按单个星号切斜体（与星号相邻的星号属于加粗字面量，不参与斜体），
最后在每段里找链接。于是"加粗的链接"与"斜体的链接"都成立。

三条硬性质：

1. **未闭合/非法一律按字面文本保留**：绝不静默吞掉用户的星号、方括号或 URL——
   简历正文里的单星号多半是他真想印出来的符号，猜错比不猜更糟。
2. **不改写用户数据**：不做归一化 / 折叠；解析是纯函数。
3. **只有一条 URL 白名单**：只允许 http/https/mailto，<=512 字符，无空白。HTML 会把
   链接写成 a href，放行未知 scheme 等于开放 XSS 面。

## 各消费方用哪个函数

- HTML：apply_rich_html（文本段里换成 strong / em / a href）；
- PDF：parse_rich_runs（pdf_exporter/rich_text.py 转成 fpdf2 口径）；
- Word：parse_rich_runs（docx_rich.add_rich_runs 拆成 run）；
- 纯文本/TXT：strip_markers（链接只留 label，URL 不印刷）；
- Markdown/JSON：原样保留（标记即数据，本模块不参与）；
- 编辑器：toggle_bold / is_bold（按**源串偏移**切换加粗）。
"""

from __future__ import annotations

import html as _html

from .resume_inline_style import inline_style_css
from .resume_rich_text_parse import MARKER, RichSpan, _spans, parse_rich_runs

# 这两类标签的内容不是"可见正文"：里面的双星号是代码，替换成标签会写坏页面。
_TRACKED_TAGS = ("style", "script")


# ===== HTML 收口（文本段 → 标签）=====


def _tag_name(tag: str) -> str:
    """闭合/起始标签取名字（小写）；取不到名字返回空串。"""
    body = tag[1:-1].strip()
    if body.startswith("/"):
        body = body[1:].strip()
    name: list[str] = []
    for char in body:
        if char.isalnum() or char in "-:_":
            name.append(char)
        elif char in " \t\r\n/>":
            break
        else:
            break
    return "".join(name).lower()


def _segments(html: str):
    """把 HTML 拆成 (是否文本, 片段)。

    script / style / 注释 / CDATA 都整体作为一个"非文本"片段返回，调用方据此跳过
    它们——属性值里的标记、注释里的一句说明都不该被替换成标签。
    """
    cursor = 0
    length = len(html)
    while cursor < length:
        start = html.find("<", cursor)
        if start < 0:
            yield True, html[cursor:]
            return
        if start > cursor:
            yield True, html[cursor:start]
        if html.startswith("<!--", start):
            end = html.find("-->", start + 4)
            end = length if end < 0 else end + 3
            yield False, html[start:end]
            cursor = end
            continue
        if html.startswith("<![CDATA[", start):
            end = html.find("]]>", start)
            end = length if end < 0 else end + 3
            yield False, html[start:end]
            cursor = end
            continue
        end = html.find(">", start)
        if end < 0:
            # 没有闭合的尖括号：余下全文按文本处理，别把内容整段丢掉。
            yield True, html[start:]
            return
        yield False, html[start : end + 1]
        cursor = end + 1


def _href_of(escaped_url: str) -> str:
    """把文本段里（已被上游转义过的）URL 还原成属性值并重新转义。

    上游 HTML 模板开启了 autoescape，所以文本段里的 URL 里 & 与引号已经是实体；
    先 unescape 再做白名单校验（吃到实体会漏判），最后按属性规则重新 escape。
    """
    return _html.escape(_html.unescape(escaped_url), quote=True)


def _span_html(span: RichSpan) -> str:
    body = span.text
    if span.size is not None or span.color:
        css = inline_style_css(span.size, span.color)
        if css:
            body = f'<span style="{css}">{body}</span>'
    if span.link is not None:
        # label 与 URL 都来自文本段（已被上游转义），label 原样作为可见文本。
        body = f'<a href="{_href_of(span.link)}" rel="noopener noreferrer">{body}</a>'
    if span.bold:
        body = f"<strong>{body}</strong>"
    return body


def apply_rich_html(html: str) -> str:
    """把文本段里的行内标记换成 strong / em / a href。

    只处理文本段：标签、属性值、注释、CDATA 与 style/script 的内容一律跳过。
    标记天然不跨标签（每段独立配对），所以"已经包在 strong 里"的内容不会被再包一层。
    """
    if "*" not in html and "[" not in html and "{@" not in html:
        return html
    pieces: list[str] = []
    depth = 0
    for is_text, chunk in _segments(html):
        if is_text:
            if depth:
                pieces.append(chunk)
                continue
            pieces.extend(_span_html(span) for span in parse_rich_runs(chunk))
            continue
        pieces.append(chunk)
        name = _tag_name(chunk)
        if name in _TRACKED_TAGS:
            if chunk.startswith("</"):
                depth = max(0, depth - 1)
            elif not chunk.endswith("/>"):
                depth += 1
    return "".join(pieces)


# ===== 编辑器：按源串偏移切换加粗 =====


def _clamp(text: str, start: int, end: int) -> tuple[int, int]:
    length = len(text)
    first = max(0, min(int(start), length))
    second = max(0, min(int(end), length))
    return (first, second) if first <= second else (second, first)


def is_bold(text: str, start: int, end: int) -> bool:
    """选区 [start, end) 是否**整段**都加粗（空选区恒为 False）。

    .. deprecated:: I-12
       编辑器已改为结构化 `item.rich.runs`（P2），后端这条"按源串偏移判断"的入口没有
        任何调用方了（`grep -rn is_bold app/` 只有定义与 re-export）。**保留**是因为它仍是
        `toggle_bold` 的语义说明与解析器的回归锚点；等 I-12 P4 完成且存量数据全部迁移后
        连同 `toggle_bold` 一起删。
    """
    first, second = _clamp(text, start, end)
    if first == second:
        return False
    covered = [
        bold
        for span_start, span_end, bold in _spans(text)
        if span_start < second and span_end > first
    ]
    return bool(covered) and all(covered)


def _aligned(spans: list[tuple[int, int, bool]], first: int, second: int) -> tuple[int, int]:
    """把选区边界推到**标记边界**上，避免在半对标记里切一刀。"""
    for span_start, span_end, bold in spans:
        if not bold:
            continue
        if span_start < first < span_end:
            first = span_start
        if span_start < second < span_end:
            second = span_end
    return first, second


def _split_at(
    spans: list[tuple[int, int, bool]], first: int, second: int
) -> list[tuple[int, int, bool]]:
    """把**部分重叠**选区的区间切开，让每个区间要么整段在选区内、要么整段在外。"""
    result: list[tuple[int, int, bool]] = []
    for span_start, span_end, bold in spans:
        inside = span_start >= first and span_end <= second
        outside = span_end <= first or span_start >= second
        if inside or outside:
            result.append((span_start, span_end, bold))
            continue
        if span_start < first:
            result.append((span_start, first, bold))
        inner_start = max(span_start, first)
        inner_end = min(span_end, second)
        if inner_end > inner_start:
            result.append((inner_start, inner_end, bold))
        if span_end > second:
            result.append((second, span_end, bold))
    return result


def toggle_bold(text: str, start: int, end: int) -> str:
    """在**源串偏移**上切换加粗：已全粗则取消，否则整段加粗。

    只增删标记，可见文本一个字节都不变，也不会留下空标记（四个星号）。

    .. deprecated:: I-12
       这是后端**最后一处"拼标记串"的实现**（`**…**`）。编辑器改用 `item.rich.runs`
       之后它已无调用方；本轮不删（旧备份 + 存量标记串的兼容读还依赖同一套偏移语义），
       等 I-12 P4 完成且存量数据全部迁移后再删。新代码不要再调用它——写样式请写
       `rich.runs`（见 `resume_rich_marks`）。
    """
    first, second = _clamp(text, start, end)
    if first == second:
        return text
    spans = _spans(text)
    if not spans:
        return text
    first, second = _aligned(spans, first, second)
    target = not is_bold(text, first, second)

    merged: list[tuple[str, bool]] = []
    for span_start, span_end, bold in _split_at(spans, first, second):
        inside = span_start >= first and span_end <= second
        new_bold = target if inside else bold
        body = text[span_start:span_end]
        if merged and merged[-1][1] == new_bold:
            # 相邻同态区间直接拼起来：否则会产出交错的空标记对。
            merged[-1] = (merged[-1][0] + body, new_bold)
        else:
            merged.append((body, new_bold))
    return "".join(f"{MARKER}{body}{MARKER}" if bold else body for body, bold in merged)


__all__ = [
    "BOLD_MARKER",
    "ITALIC_MARKER",
    "MARKER",
    "MAX_LINK_URL_LENGTH",
    "RichSpan",
    "apply_rich_html",
    "has_bold",
    "is_bold",
    "is_valid_link_url",
    "parse_rich_runs",
    "parse_runs",
    "strip_markers",
    "toggle_bold",
]


# 拆分后的 re-export（解析层公共名字的旧 import 路径不断）。
from .resume_rich_text_parse import (  # noqa: E402,F401
    BOLD_MARKER,
    ITALIC_MARKER,
    MAX_LINK_URL_LENGTH,
    has_bold,
    is_valid_link_url,
    parse_runs,
    strip_markers,
)

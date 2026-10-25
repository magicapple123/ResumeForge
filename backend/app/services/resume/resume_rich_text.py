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
from dataclasses import dataclass

# 兼容旧名：MARKER 一直指加粗标记，既有导入（测试/编辑器）不因协议 v2 改名而断。
MARKER = "**"
BOLD_MARKER = MARKER
ITALIC_MARKER = "*"

# 链接 URL 长度上限：与前端 inlineMarks.MAX_LINK_URL_LENGTH 逐字一致。
MAX_LINK_URL_LENGTH = 512
# 只允许这三种 scheme。其它（javascript: / data: / 相对路径…）一律按纯文本保留。
_LINK_SCHEMES = ("http://", "https://", "mailto:")
# 这两类标签的内容不是"可见正文"：里面的双星号是代码，替换成标签会写坏页面。
_TRACKED_TAGS = ("style", "script")
# href 属性里绝对不能出现的字符（& 另行由 escape 处理）。
_HREF_UNSAFE = frozenset('<">')


@dataclass(frozen=True)
class RichSpan:
    """一段同一样式的**可见文本**（标记已剥离，链接只保留 label 与 URL 两个字段）。

    link 非空时 text 是链接的显示文字（label）；bold / italic 可以同时成立
    （例：加粗的链接）。调用方**不要**假设"只有一个样式为真"。
    """

    text: str
    bold: bool = False
    italic: bool = False
    link: str | None = None

    def readable(self, *, with_link: bool = False) -> str:
        """可读文本：默认只留 label；with_link=True 追加 " (URL)"（PDF/Word 的口径）。"""
        if self.link and with_link:
            return f"{self.text} ({self.link})"
        return self.text


@dataclass(frozen=True)
class _Run:
    """分层切分的中间态（RichSpan 的可变拼接形状）。"""

    text: str
    bold: bool = False
    italic: bool = False
    link: str | None = None


def is_valid_link_url(url: str) -> bool:
    """链接 URL 是否可安全渲染：http/https/mailto + 无空白 + <=512 + 无属性破坏字符。

    这是**唯一**的 URL 白名单实现（HTML 与 PDF/Word 的可见文本都走它）。非法 URL 不会
    被丢弃，而是按字面文本留在正文里——用户至少能看到自己写了什么。
    """
    text = url.strip()
    if not text or len(text) > MAX_LINK_URL_LENGTH:
        return False
    lowered = text.lower()
    if not any(lowered.startswith(scheme) for scheme in _LINK_SCHEMES):
        return False
    if any(char.isspace() for char in text):
        return False
    return not any(char in _HREF_UNSAFE for char in text)


# ===== 第 1 层：加粗（既有语义，逐字节保持）=====


def _marker_positions(text: str) -> list[int]:
    """双星号在文中的起点（按出现顺序，互不重叠）。"""
    positions: list[int] = []
    cursor = 0
    while True:
        found = text.find(MARKER, cursor)
        if found < 0:
            return positions
        positions.append(found)
        cursor = found + len(MARKER)


def _spans(text: str) -> list[tuple[int, int, bool]]:
    """把文本切成 (起, 止, 是否加粗)；区间**连续覆盖整串**。

    成对的标记两两取用，落单的最后一个标记留在末尾的普通区间里（原样可见）。
    """
    if not text:
        return []
    positions = _marker_positions(text)
    spans: list[tuple[int, int, bool]] = []
    cursor = 0
    index = 0
    while index + 1 < len(positions):
        start = positions[index]
        end = positions[index + 1]
        if start > cursor:
            spans.append((cursor, start, False))
        inner_start = start + len(MARKER)
        # 成对标记之间是空的（四个星号）时不产出空区间：空 run / 空标签没有意义。
        if end > inner_start:
            spans.append((inner_start, end, True))
        cursor = end + len(MARKER)
        index += 2
    if cursor < len(text):
        spans.append((cursor, len(text), False))
    return spans


def _bold_runs(text: str) -> list[_Run]:
    return [_Run(text[start:end], bold=bold) for start, end, bold in _spans(text)]


# ===== 第 2 层：斜体（只认"孤立"的单星号）=====


def _italic_positions(text: str) -> list[int]:
    """可作为斜体边界的星号起点：不与另一颗星号相邻（双星号是加粗字面量）。"""
    positions: list[int] = []
    for index, char in enumerate(text):
        if char != ITALIC_MARKER:
            continue
        previous = text[index - 1] if index else ""
        following = text[index + 1] if index + 1 < len(text) else ""
        if previous == ITALIC_MARKER or following == ITALIC_MARKER:
            continue
        positions.append(index)
    return positions


def _italic_runs(run: _Run) -> list[_Run]:
    """在一个同态区间里切斜体；落单的星号原样保留。"""
    markers = _italic_positions(run.text)
    if len(markers) < 2:
        return [run]
    runs: list[_Run] = []
    cursor = 0
    index = 0
    while index + 1 < len(markers):
        start, end = markers[index], markers[index + 1]
        if start > cursor:
            runs.append(_Run(run.text[cursor:start], run.bold, run.italic))
        inner = run.text[start + 1 : end]
        if inner:
            runs.append(_Run(inner, run.bold, True))
        cursor = end + 1
        index += 2
    if cursor < len(run.text):
        runs.append(_Run(run.text[cursor:], run.bold, run.italic))
    return runs


# ===== 第 3 层：链接 =====


def _link_runs(run: _Run) -> list[_Run]:
    """在一个同态区间里找 [label](url)；非法 scheme / 落单括号原样保留。"""
    text = run.text
    if "[" not in text or "](" not in text:
        return [run]
    runs: list[_Run] = []
    cursor = 0
    search = 0
    while True:
        open_bracket = text.find("[", search)
        if open_bracket < 0:
            break
        close_bracket = text.find("]", open_bracket + 1)
        if close_bracket < 0:
            break
        if text[close_bracket + 1 : close_bracket + 2] != "(":
            search = open_bracket + 1
            continue
        close_paren = text.find(")", close_bracket + 2)
        if close_paren < 0:
            search = open_bracket + 1
            continue
        label = text[open_bracket + 1 : close_bracket]
        url = text[close_bracket + 2 : close_paren]
        # label 内不再解析其它标记（契约 §2.7）；空 label 按字面保留，不猜用户意图。
        if not label or not is_valid_link_url(url):
            search = open_bracket + 1
            continue
        if open_bracket > cursor:
            runs.append(_Run(text[cursor:open_bracket], run.bold, run.italic))
        runs.append(_Run(label, run.bold, run.italic, link=url))
        cursor = close_paren + 1
        search = cursor
    if cursor < len(text):
        runs.append(_Run(text[cursor:], run.bold, run.italic))
    return runs


# ===== 唯一解析入口 =====


def parse_rich_runs(text: str) -> list[RichSpan]:
    """把 text 解析成有序的 RichSpan 列表（唯一解析实现）。

    性质：各 span.text 的拼接恒等于 strip_markers(x)；解析两次结果相同（幂等）；
    空串返回空列表。
    """
    if not text:
        return []
    runs = _bold_runs(text)
    runs = [piece for run in runs for piece in _italic_runs(run)]
    runs = [piece for run in runs for piece in _link_runs(run)]
    return [RichSpan(run.text, run.bold, run.italic, run.link) for run in runs if run.text]


def parse_runs(text: str) -> list[tuple[str, bool]]:
    """兼容投影：(片段, 是否加粗)（斜体/链接只参与"可见文本"）。

    历史调用方只关心加粗；新代码请直接用 parse_rich_runs 拿完整样式。
    """
    return [(span.text, span.bold) for span in parse_rich_runs(text)]


def strip_markers(text: str) -> str:
    """可读纯文本：剥掉三类标记；链接只保留 label（URL 不印刷）。

    幂等：strip_markers(strip_markers(x)) == strip_markers(x)。
    """
    if "*" not in text and "[" not in text:
        return text
    return "".join(span.text for span in parse_rich_runs(text))


def has_bold(text: str) -> bool:
    """这段文字里是否存在**成对**的加粗标记（PDF 是否要开 markdown 模式）。"""
    return any(span.bold for span in parse_rich_runs(text))


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
    if span.link is not None:
        # label 与 URL 都来自文本段（已被上游转义），label 原样作为可见文本。
        body = f'<a href="{_href_of(span.link)}" rel="noopener noreferrer">{body}</a>'
    if span.italic:
        body = f"<em>{body}</em>"
    if span.bold:
        body = f"<strong>{body}</strong>"
    return body


def apply_rich_html(html: str) -> str:
    """把文本段里的行内标记换成 strong / em / a href。

    只处理文本段：标签、属性值、注释、CDATA 与 style/script 的内容一律跳过。
    标记天然不跨标签（每段独立配对），所以"已经包在 strong 里"的内容不会被再包一层。
    """
    if "*" not in html and "[" not in html:
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
    """选区 [start, end) 是否**整段**都加粗（空选区恒为 False）。"""
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

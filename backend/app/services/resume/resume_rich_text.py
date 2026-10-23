# SPDX-License-Identifier: Apache-2.0
"""简历正文的字符级加粗标记（``**``）解析。

**为什么需要它**：用户能在正文里把某几个字加粗（"**带 8 人团队**交付"），但简历内容有
六个消费方——HTML 预览、PDF、Word、纯文本、ATS 评分、提示词。如果每个消费方各写一份
标记解析，最后一定会出现"预览里加粗了、导出的 PDF 里露着星号"这类不一致。

所以这个模块是**唯一**的标记定义处，并且刻意只做纯计算：

* 成对、不嵌套、不跨字段。``**`` 只能成对出现，一对之内不能再有一对；
* 不配对的 ``**`` 当**普通文字**处理，原样保留。绝不静默吞掉用户输入的星号——
  简历正文里出现单个 ``**`` 多半是他想写字面的星号，猜错比不猜更糟；
* 不做任何"归一化 / 折叠"（例如把三个星收成一个）。改写用户数据是最不该有的"聪明"。

**谁该用哪个函数**：

===============  ==========================================================
消费方           用哪个
===============  ==========================================================
HTML 预览/导出    ``apply_rich_html``（在 HTML 文本段里换成 ``<strong>``）
PDF（fpdf2）      不调本模块；直接把正文交给 ``markdown=True``，但用
                  ``has_bold`` 判断"这段到底有没有成对标记"，避免让 fpdf2
                  去解释 ``__`` / ``~~`` / ``--`` 这些它自己的标记
Word（python-docx）``parse_runs``（每段一个 run，见 ``services/docx_rich.py``）
纯文本 / ATS /    ``strip_markers``
提示词
编辑器按钮        ``toggle_bold`` / ``is_bold``（按**源串偏移**切换）
===============  ==========================================================
"""

from __future__ import annotations

MARKER = "**"
_MARKER_LEN = len(MARKER)
# 这两类标签的内容不是"可见正文"：里面的 ``**`` 是代码，替换成 ``<strong>`` 会直接
# 把页面写坏（一个 ``<style>`` 里出现 HTML 标签）。
_TRACKED_TAGS = ("style", "script")


# ===== 标记切分 =====


def _marker_positions(text: str) -> list[int]:
    """``**`` 在文中的起点（按出现顺序，互不重叠）。"""
    positions: list[int] = []
    cursor = 0
    while True:
        found = text.find(MARKER, cursor)
        if found < 0:
            return positions
        positions.append(found)
        cursor = found + _MARKER_LEN


def _spans(text: str) -> list[tuple[int, int, bool]]:
    """把文本切成 ``(起, 止, 是否加粗)``。

    区间**连续覆盖整串**（相邻区间首尾相接），因此"可见文本"就是各区间原文的拼接。
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
        inner_start = start + _MARKER_LEN
        # 成对标记之间是空的（``****``）时不产出空区间：空 run / 空 ``<strong>`` 对
        # 渲染没有意义，还会让 Word 里多出一堆空 run。
        if end > inner_start:
            spans.append((inner_start, end, True))
        cursor = end + _MARKER_LEN
        index += 2
    if cursor < len(text):
        spans.append((cursor, len(text), False))
    return spans


def parse_runs(text: str) -> list[tuple[str, bool]]:
    """把 ``text`` 切成 ``(片段, 是否加粗)``；**不修改文本**。

    幂等：``parse_runs(text)`` 的片段拼接恒等于 ``strip_markers(text)``。
    """
    return [(text[start:end], bold) for start, end, bold in _spans(text)]


def strip_markers(text: str) -> str:
    """移除**成对**的加粗标记，落单的星号原样保留。

    幂等：``strip_markers(strip_markers(x)) == strip_markers(x)``（第二次调用时已没有
    成对标记可剥）。
    """
    if MARKER not in text:
        return text
    return "".join(segment for segment, _ in parse_runs(text))


def has_bold(text: str) -> bool:
    """这段文字里是否存在**成对**标记（决定 PDF 是否要开 ``markdown=True``）。

    为什么不用 ``MARKER in text`` 判断：fpdf2 的 markdown 模式除了 ``**`` 还认
    ``__`` / ``~~`` / ``--``。正文里的 ``--`` 很常见（日期区间、破折号），一旦开
    markdown 就会被它当成下划线标记吞掉。只在"确实有成对 ``**``"时才开，其它文本
    的渲染结果与历史**逐字一致**。
    """
    return any(bold for _, bold in parse_runs(text))


# ===== HTML 收口 =====


def _tag_name(tag: str) -> str:
    """``</style lang=x>`` → ``style``（小写）；取不到名字返回空串。"""
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
    """把 HTML 拆成 ``(是否文本, 片段)``。

    ``<script>`` / ``<style>`` / 注释 / CDATA 都整体作为一个"非文本"片段返回，调用方
    据此跳过它们——属性值里的 ``**``、注释里的一句说明都不该被替换成标签。
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


def apply_rich_html(html: str) -> str:
    """把文本段里**成对**的 ``**…**`` 换成 ``<strong>…</strong>``。

    只处理文本段：标签、属性值、注释、CDATA 与 ``<style>``/``<script>`` 的内容一律
    跳过。标记天然不跨标签（每段独立配对），所以"已经包在 ``<strong>`` 里"的内容不会
    被再包一层。
    """
    if MARKER not in html:
        return html
    pieces: list[str] = []
    depth = 0
    for is_text, chunk in _segments(html):
        if is_text:
            if depth:
                pieces.append(chunk)
                continue
            for segment, bold in parse_runs(chunk):
                pieces.append(f"<strong>{segment}</strong>" if bold else segment)
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
    """选区 ``[start, end)`` 是否**整段**都加粗（空选区恒为 False）。"""
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
    """把选区边界推到**标记边界**上，避免在半对标记里切一刀。

    选区落在某个加粗区间内部时，把它扩展到该区间两端——否则切出来的结果是
    "``**加**粗``"这种把一对标记劈开的东西，下次解析就认不出来。
    """
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
    """把**部分重叠**选区的区间切开，让每个区间要么整段在选区内、要么整段在外。

    没有这一步，"给一段普通文字中间加粗"会失效：普通文字是**一整个**区间，只要选区
    没有覆盖它的全部，就会被判成"不在选区内"而原样保留——用户点了加粗却什么都没发生。
    """
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

    只增删标记，可见文本一个字节都不变，也不会留下空标记（``****``）。
    幂等性：``toggle_bold(toggle_bold(x, a, b), a, b)`` 的**可见文本**不变。
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
            # 相邻同态区间直接拼起来：否则会产出 ``**a****b**`` 这种空对，虽然能解析
            # 正确，但用户点开源码会以为哪里坏了。
            merged[-1] = (merged[-1][0] + body, new_bold)
        else:
            merged.append((body, new_bold))
    return "".join(f"{MARKER}{body}{MARKER}" if bold else body for body, bold in merged)


__all__ = [
    "MARKER",
    "apply_rich_html",
    "has_bold",
    "is_bold",
    "parse_runs",
    "strip_markers",
    "toggle_bold",
]

# SPDX-License-Identifier: Apache-2.0
"""行内字号与颜色的**标记语法层**（R-11）：`{@size=0.9,color=#c00}…{@}`。

## 为什么单独一个模块

`resume_rich_text.py` 已经是 469 行（500 行硬预算），而这一层要解决的问题与"加粗/斜体/
链接"不同：那三种是**切换式**标记，这里是**带属性**的成对区间，还要先把区间从文本里
摘出去，才能让既有的分层解析照常工作。

## 语法

```text
{@size=0.9}整体缩小一号{@}
{@color=#c0392b}只改颜色{@}
{@size=0.9,color=#c0392b}两者都改{@}
```

* `size` 是**相对系数**（0.5–1.6，相对当前 run 的字号），不是绝对磅值——同一段在
  不同模板/字号档位上都要保持"小一号"的语义；
* `color` 是 `#rgb` / `#rrggbb`；
* **未闭合**（只有 `{@…}` 没有 `{@}`）、属性非法、嵌套开标记一律按**字面文本**保留：
  简历正文里的花括号多半是用户真想印出来的字符，猜错比不猜更糟；
* `{@}` 是唯一的结束标记，里面不能再带属性。

## 与既有解析的配合（占位符保护）

先扫描出所有样式区间，把它们替换成**不含 `*` / `[` / `]`** 的占位符
（`\ue000序号\ue001`），交给 `resume_rich_text` 的加粗/斜体/链接三层解析；解析完再按
占位符把 span 切开并贴回样式。这样 `**{@size=0.9}abc{@}**`（加粗里套小字号）也能正确
落成三个 run，而不需要给解析器加一套嵌套语法。
"""

from __future__ import annotations

import contextlib
import re
from dataclasses import dataclass

#: 起始标记与结束标记。结束标记本身也能被 `_OPEN_RE` 匹配到（属性串为空），靠长度区分。
STYLE_CLOSE = "{@}"
PLACEHOLDER_START = "\ue000"
PLACEHOLDER_END = "\ue001"
#: 样式区间的结束占位符（区间左闭右开：起占位符之后的文字归它）。
PLACEHOLDER_CLOSE = "\ue002"

_OPEN_RE = re.compile(r"\{@([^{}]*)\}")
_ATTR_RE = re.compile(r"^\s*(size|color)\s*=\s*([^,]+?)\s*$", re.I)
_HEX_RE = re.compile(r"^#(?:[0-9a-f]{3}|[0-9a-f]{6})$", re.I)

#: 字号系数区间：小于 0.5 读不清，大于 1.6 会把行高顶开（与前端滑杆同区间）。
MIN_SIZE = 0.5
MAX_SIZE = 1.6


@dataclass(frozen=True)
class InlineStyle:
    """一段文字的样式覆盖；两个字段都可为空（空区间在解析时被丢弃）。"""

    size: float | None = None
    color: str | None = None


def has_inline_style(text: str) -> bool:
    """快速判定：没有 `{@` 就不必走任何样式路径（历史产物逐字节不变）。"""
    return "{@" in text


def parse_style(attributes: str) -> InlineStyle | None:
    """`size=0.9,color=#c00` → InlineStyle；有任何非法项就整份作废（返回 None）。"""
    size: float | None = None
    color: str | None = None
    found = False
    for piece in attributes.split(","):
        if not piece.strip():
            continue
        match = _ATTR_RE.match(piece)
        if match is None:
            return None
        key, value = match.group(1).lower(), match.group(2).strip()
        if key == "size":
            try:
                number = float(value)
            except ValueError:
                return None
            if not (MIN_SIZE <= number <= MAX_SIZE):
                return None
            size = number
            found = True
        else:
            if not _HEX_RE.match(value):
                return None
            color = value.lower()
            found = True
    return InlineStyle(size, color) if found else None


def _merge(styles: list[InlineStyle], stack: list[int]) -> InlineStyle | None:
    """栈里所有打开样式的合并：内层覆盖同名字段，未设的字段沿用外层。"""
    if not stack:
        return None
    size: float | None = None
    color: str | None = None
    for order in stack:
        if 0 <= order < len(styles):
            size = styles[order].size if styles[order].size is not None else size
            color = styles[order].color or color
    if size is None and color is None:
        return None
    return InlineStyle(size, color)


def mask_inline_styles(text: str) -> tuple[str, list[InlineStyle]]:
    """把样式区间换成"起/止"占位符对，返回 `(掩码文本, 样式表)`。

    占位符不含 `*` / `[` / `]`，所以加粗/斜体/链接三层解析照常工作；解析完由
    `split_masked` 按栈把 span 切开并贴回（合并后的）样式。

    * 支持**嵌套**：`{@size=0.9}{@color=#c00}…{@}{@}` 表示"既小又红"，内层覆盖同名属性；
    * **未闭合**（还有没配对的起占位符）时整段按字面返回、一个样式都不生效——宁可整段不生效，
      也不要把后面的文字整片染色（标记由编辑器写入，人工改坏时这是最安全的退化）。
    """
    if not has_inline_style(text):
        return text, []
    styles: list[InlineStyle] = []
    items: list[tuple[str, object]] = []  # ("text", str) / ("start", idx) / ("end", None)
    index = 0
    depth = 0
    while index < len(text):
        if text.startswith(STYLE_CLOSE, index):
            if depth > 0:
                items.append(("end", None))
                depth -= 1
            else:
                items.append(("text", STYLE_CLOSE))
            index += len(STYLE_CLOSE)
            continue
        match = _OPEN_RE.match(text, index)
        if match is not None:
            style = parse_style(match.group(1))
            if style is not None:
                styles.append(style)
                items.append(("start", len(styles) - 1))
                depth += 1
                index = match.end()
                continue
            items.append(("text", match.group(0)))  # 非法属性：按字面保留
            index = match.end()
            continue
        items.append(("text", text[index]))
        index += 1
    if depth > 0:
        return text, []  # 有未闭合：整段按字面
    pieces: list[str] = []
    for kind, payload in items:
        if kind == "text":
            pieces.append(str(payload))
        elif kind == "start":
            pieces.append(f"{PLACEHOLDER_START}{payload}{PLACEHOLDER_END}")
        else:
            pieces.append(PLACEHOLDER_CLOSE)
    return "".join(pieces), styles


def split_masked(
    piece: str, styles: list[InlineStyle] | None = None
) -> list[tuple[str, InlineStyle | None]]:
    """把含占位符的片段切成 `[(文本, 合并后的样式或 None), …]`（占位符本身不出现）。

    样式区间是**左闭右开**；嵌套时按栈合并（内层覆盖同名字段）。
    """
    table = styles or []
    if PLACEHOLDER_START not in piece and PLACEHOLDER_CLOSE not in piece:
        return [(piece, None)] if piece else []
    result: list[tuple[str, InlineStyle | None]] = []
    buffer: list[str] = []
    stack: list[int] = []
    index = 0

    def flush() -> None:
        nonlocal buffer
        if buffer:
            result.append(("".join(buffer), _merge(table, stack)))
            buffer = []

    while index < len(piece):
        if piece.startswith(PLACEHOLDER_CLOSE, index):
            flush()
            if stack:
                stack.pop()
            index += len(PLACEHOLDER_CLOSE)
            continue
        if piece.startswith(PLACEHOLDER_START, index):
            end_index = piece.find(PLACEHOLDER_END, index)
            if end_index < 0:
                buffer.append(piece[index])
                index += 1
                continue
            flush()
            with contextlib.suppress(ValueError):
                stack.append(int(piece[index + len(PLACEHOLDER_START) : end_index]))
            index = end_index + len(PLACEHOLDER_END)
            continue
        buffer.append(piece[index])
        index += 1
    flush()
    return result


def expand_runs(
    runs: list, styles: list[InlineStyle]
) -> list[tuple[str, bool, str | None, InlineStyle | None]]:
    """把解析后的 run 列表按占位符切开：`[(text, bold, link, 合并后的样式), …]`。

    嵌套样式的合并在 `split_masked` 里做（内层覆盖同名字段）。放在这一层而不是
    `resume_rich_text`：那里的解析函数已经贴着 500 行预算，而且"占位符 → 样式"的对应
    关系本来就是本模块的知识。
    """
    expanded: list[tuple[str, bool, str | None, InlineStyle | None]] = []
    for run in runs:
        for piece, style in split_masked(run.text, styles):
            if not piece:
                continue
            expanded.append((piece, run.bold, run.link, style))
    return expanded


def inline_style_css(size: float | None, color: str | None) -> str:
    """HTML 内联样式：字号用百分比（相对当前字号），颜色原样。"""
    declarations: list[str] = []
    if size is not None:
        declarations.append(f"font-size:{round(size * 100)}%")
    if color:
        declarations.append(f"color:{color}")
    return ";".join(declarations)


_PLACEHOLDER_RE = re.compile(f"{PLACEHOLDER_START}\\d+{PLACEHOLDER_END}|{PLACEHOLDER_CLOSE}")


def strip_style_markers(text: str) -> str:
    """只去掉 `{@…}` / `{@}` 标记本身，**保留可见文字**（Markdown 出口用）。

    与 `strip_markers` 的分工：Markdown 是有格式的出口，`**` 要原样留给它当加粗；
    但字号/颜色在 Markdown 里没有对应语法，留着就是泄漏（用户在 .md 里看到
    `{@size=0.9}` 会以为导出坏了）。所以这里只剥样式标记。

    复用 `mask_inline_styles` 的配对判定：未闭合 / 属性非法时它整段按字面返回，
    这里也原样返回——与"解析不生效就不该偷偷吞字符"的既有退化口径一致。
    """
    if not has_inline_style(text):
        return text
    masked, styles = mask_inline_styles(text)
    if not styles:
        return text
    return _PLACEHOLDER_RE.sub("", masked)


def hex_to_rgb(color: str | None) -> tuple[int, int, int] | None:
    """`#rgb` / `#rrggbb` → RGB（PDF 的元组口径）。"""
    if not color or not _HEX_RE.match(color):
        return None
    text = color.lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


__all__ = [
    "MAX_SIZE",
    "expand_runs",
    "MIN_SIZE",
    "InlineStyle",
    "STYLE_CLOSE",
    "has_inline_style",
    "hex_to_rgb",
    "inline_style_css",
    "mask_inline_styles",
    "parse_style",
    "split_masked",
    "strip_style_markers",
]

# SPDX-License-Identifier: Apache-2.0
"""行内标记的解析层（从 app.services.resume.resume_rich_text 纯搬迁拆出）。

协议 v2 的标记定义与解析：成对双星号=加粗、成对单星号=斜体、方括号紧跟圆括号=链接；
RichSpan 与 parse_rich_runs 是 HTML / PDF / Word / TXT / ATS / 编辑器共用的唯一实现。
HTML 收口（apply_rich_html）与编辑器偏移操作（is_bold / toggle_bold）留在
resume_rich_text，并由它 re-export 本模块的公共名字。
"""

from __future__ import annotations

from dataclasses import dataclass

from .resume_inline_style import expand_runs, mask_inline_styles

# 兼容旧名：MARKER 一直指加粗标记，既有导入（测试/编辑器）不因协议 v2 改名而断。
MARKER = "**"
BOLD_MARKER = MARKER
ITALIC_MARKER = "*"

# 链接 URL 长度上限：与前端 inlineMarks.MAX_LINK_URL_LENGTH 逐字一致。
MAX_LINK_URL_LENGTH = 512
# 只允许这三种 scheme。其它（javascript: / data: / 相对路径…）一律按纯文本保留。
_LINK_SCHEMES = ("http://", "https://", "mailto:")
# href 属性里绝对不能出现的字符（& 另行由 escape 处理）。
_HREF_UNSAFE = frozenset('<">')


@dataclass(frozen=True)
class RichSpan:
    """一段同一样式的**可见文本**（标记已剥离，链接只保留 label 与 URL 两个字段）。

    #5d：斜体整体移除——单星号仍按斜体标记**剥壳**（存量内容不冒裸星号），但剥出的
    文本一律是普通字重。link 非空时 text 是链接的显示文字（label）；bold 与链接可同时
    成立。调用方**不要**假设"只有一个样式为真"。
    """

    text: str
    bold: bool = False
    link: str | None = None
    #: 行内字号系数（相对当前 run，1.0 = 不变）与颜色（`#rgb`/`#rrggbb`）。
    #: R-11：由 `{@size=0.9,color=#c00}…{@}` 产生，四个出口各自投影。
    size: float | None = None
    color: str | None = None

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


# ===== 第 2 层：单星号剥壳（#5d：标记仍剥离，但不再产出倾斜效果）=====


def _italic_positions(text: str) -> list[int]:
    """可作为斜体标记边界的星号起点：不与另一颗星号相邻（双星号是加粗字面量）。"""
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
    """在一个同态区间里剥掉成对的单星号；落单的星号原样保留。

    #5d：只保留"去标记"行为（否则存量正文会突然冒出裸星号），剥出的文本不再带倾斜。
    """
    markers = _italic_positions(run.text)
    if len(markers) < 2:
        return [run]
    runs: list[_Run] = []
    cursor = 0
    index = 0
    while index + 1 < len(markers):
        start, end = markers[index], markers[index + 1]
        if start > cursor:
            runs.append(_Run(run.text[cursor:start], run.bold, run.link))
        inner = run.text[start + 1 : end]
        if inner:
            runs.append(_Run(inner, run.bold, run.link))
        cursor = end + 1
        index += 2
    if cursor < len(run.text):
        runs.append(_Run(run.text[cursor:], run.bold, run.link))
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
            runs.append(_Run(text[cursor:open_bracket], run.bold, run.link))
        runs.append(_Run(label, run.bold, link=url))
        cursor = close_paren + 1
        search = cursor
    if cursor < len(text):
        runs.append(_Run(text[cursor:], run.bold, run.link))
    return runs


# ===== 唯一解析入口 =====


def parse_rich_runs(text: str) -> list[RichSpan]:
    """把 text 解析成有序的 RichSpan 列表（唯一解析实现）。

    性质：各 span.text 的拼接恒等于 strip_markers(x)；解析两次结果相同（幂等）；
    空串返回空列表。

    .. note:: I-12 之后本函数在读路径上有**两个身份**，都不要提前删：

        1. 渲染层的输入变换——`resume_rich_marks.runs_to_marks` 把 `rich.runs` 投影成
           协议串，四个出口（HTML/PDF/Word/TXT）再靠这里解析回来（往返由
           tests/test_inline_rich_runs_export.py 钉住）；
        2. **存量数据的退回路径**——没有 `rich` 的旧 item 仍是"标记串在 value 里"，
           读的时候就是这里在解析（`resume_rich_marks.item_text` 的唯一分支）。

        等 I-12 P4 完成且存量数据全部迁移后，(2) 才允许消失。
    """
    if not text:
        return []
    # R-11：先把样式区间换成起止占位符，三层解析照常跑，最后按占位符切开并贴回样式。
    masked, styles = mask_inline_styles(text)
    runs = _bold_runs(masked)
    runs = [piece for run in runs for piece in _italic_runs(run)]
    runs = [piece for run in runs for piece in _link_runs(run)]
    return [
        RichSpan(text, bold, link, style.size if style else None, style.color if style else None)
        for text, bold, link, style in expand_runs(runs, styles)
    ]


def parse_runs(text: str) -> list[tuple[str, bool]]:
    """兼容投影：(片段, 是否加粗)（斜体/链接只参与"可见文本"）。

    历史调用方只关心加粗；新代码请直接用 parse_rich_runs 拿完整样式。
    """
    return [(span.text, span.bold) for span in parse_rich_runs(text)]


def strip_markers(text: str) -> str:
    """可读纯文本：剥掉三类标记；链接只保留 label（URL 不印刷）。

    幂等：strip_markers(strip_markers(x)) == strip_markers(x)。
    """
    if "*" not in text and "[" not in text and "{@" not in text:
        return text
    return "".join(span.text for span in parse_rich_runs(text))


def has_bold(text: str) -> bool:
    """这段文字里是否存在**成对**的加粗标记（PDF 是否要开 markdown 模式）。"""
    return any(span.bold for span in parse_rich_runs(text))

# SPDX-License-Identifier: Apache-2.0
"""标记语法 ↔ 结构化 runs（I-12 的唯一转换入口，两个方向都在这里）。

**为什么单独一个模块**：I-12 要把行内格式从"编码在 `item.value` 里的标记串"改成
"`value` 是纯文本 + 旁挂 `item.rich.runs`"。这里放**两个方向**：

* **写方向**（迁移工具用）：`parse_marks(text) -> (plain, runs)`；
* **读方向**（四个出口用）：`item_text(item)` —— 有 `rich.runs` 就投影回协议串，没有就
  原样返回 `value`（旧数据靠这条退回既有的 `parse_rich_runs`）。

放在 `resume_rich_text.py`（274 行）或 `resume_inline_style.py`（281 行）里都行，但两边都
已经贴着 500 行预算，而且这个模块是"迁移期"的临时真源，单独成文件更好找、更好删。

**不重新实现解析**：`parse_rich_runs` 已经是唯一实现（它内部就用了
`mask_inline_styles` 处理 `{@…}`），写方向只是把它的 `RichSpan` 列表**换算成带下标的
runs**，读方向只是把 runs **投影回**它能吃的串。任何"再写一遍标记解析/样式判断"的想法
都是错的——那正是 I-12 要消灭的多份实现。

**区间口径**：`start` / `end` 是**纯文本下标**（左闭右开），与前端
`InlineMarkRun` 的 `{start, end}` 同形态，也与写进 `item.rich.runs` 的 JSON 一致。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .resume_inline_style import MAX_SIZE, MIN_SIZE, STYLE_CLOSE, hex_to_rgb
from .resume_rich_text_parse import is_valid_link_url, parse_rich_runs

#: 未闭合/非法标记会被 `parse_rich_runs` 原样保留，于是纯文本里仍能看见这些前缀。
#: 迁移工具据此判断"这条没被完全转换"，**不要**用它做业务判断。
_RESIDUE = ("{@", "**", "[")


@dataclass(frozen=True)
class RichRun:
    """一段带样式的区间（下标基于**纯文本**，左闭右开）。

    `None` 表示"这一项没有覆盖"，不是"显式设为默认值"——`bold=None` 与 `bold=False`
    在 JSON 里是两个意思（后者是"用户明确取消了加粗"）。
    """

    start: int
    end: int
    bold: bool | None = None
    link: str | None = None
    size: float | None = None
    color: str | None = None

    def as_dict(self) -> dict[str, object]:
        """写进 `item.rich.runs` 的形态：**只出非 None 的键**，别把一堆 null 塞进磁盘。"""
        out: dict[str, object] = {"start": self.start, "end": self.end}
        if self.bold is not None:
            out["bold"] = self.bold
        if self.link is not None:
            out["link"] = self.link
        if self.size is not None:
            out["size"] = self.size
        if self.color is not None:
            out["color"] = self.color
        return out


def parse_marks(text: str) -> tuple[str, list[RichRun]]:
    """把含标记的字符串拆成 `(纯文本, runs)`。

    性质（迁移工具依赖它们）：
    * `plain == strip_markers(text)`（同一个解析器的投影，不会漂移）；
    * 所有 run 的 `[start, end)` 落在 `plain` 范围内且互不重叠（span 是顺序切出来的）；
    * 没有任何样式的 span 不产出 run（`runs` 可以为空 = 纯文本，不必写 `rich`）。
    """
    spans = parse_rich_runs(text)
    plain: list[str] = []
    runs: list[RichRun] = []
    cursor = 0
    for span in spans:
        start = cursor
        cursor += len(span.text)
        plain.append(span.text)
        if not (span.bold or span.link or span.size or span.color):
            continue
        runs.append(
            RichRun(
                start=start,
                end=cursor,
                bold=True if span.bold else None,
                link=span.link,
                size=span.size,
                color=span.color,
            )
        )
    return "".join(plain), runs


def looks_unconverted(plain: str) -> bool:
    """纯文本里仍残留标记前缀 → 迁移时"没敢猜"的那一类。

    `{@` 与 `**` 是未闭合/非法标记被原样保留的结果；`[` 单独出现不算（用户可能真写了
    方括号），所以调用方要结合原始串再判一次（见迁移工具的 `_residual`）。
    """
    return any(token in plain for token in _RESIDUE)


# ===== 读路径：item.rich.runs → 四出口


def _get(source: Any, key: str, default: Any = None) -> Any:
    """同时吃 pydantic 对象与 dict：planner 的入参两种形态都有。"""
    if isinstance(source, Mapping):
        return source.get(key, default)
    return getattr(source, key, default)


def _int(value: Any) -> int:
    """容错取整数（前端写 JSON 时偶发字符串下标）。取不到按 0。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def item_runs(item: Any) -> list[RichRun]:
    """item 上的结构化 runs（归一化 + 按位置排序）；没有则空列表。

    **这是 `rich.runs` 的唯一读取入口**：planner、迁移工具与测试都从这里拿，不要各自
    去读 `item["rich"]["runs"]`——那正是 I-12 要消灭的"多份实现"。

    * `bold=False` 归一成 `None`：标记语法表达不了"在粗体区间里取消粗体"，硬留着会让
      投影层以为它是一项覆盖；
    * 非法/越界区间（`end <= start`）直接丢弃，不让一条脏数据把整段正文打歪。
    """
    rich = _get(item, "rich")
    if rich is None:
        return []
    raw = _get(rich, "runs") or ()
    if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence):
        return []
    runs: list[RichRun] = []
    for entry in raw:
        start, end = _int(_get(entry, "start")), _int(_get(entry, "end"))
        if end <= start:
            continue
        runs.append(
            RichRun(
                start=start,
                end=end,
                bold=True if _get(entry, "bold") else None,
                link=_get(entry, "link") or None,
                size=_number(_get(entry, "size")),
                color=_get(entry, "color") or None,
            )
        )
    return sorted(runs, key=lambda run: (run.start, run.end))


def _safe_link(label: str, url: str | None) -> str | None:
    """链接只有在"能被既有链接解析原样读回"时才保留。

    标记语法没有转义：label 里出现 `]` 或 url 里出现 `)` 都会把区间提前截断，把后半截
    正文变成裸文本（比丢一个链接糟得多）。这类输入一律退回"只有文字、没有链接"。
    """
    if not url:
        return None
    text = str(url).strip()
    if label.endswith(" ") or not label.strip():
        return None
    if "]" in label or "[" in label or ")" in text or not is_valid_link_url(text):
        return None
    return text


def _safe_size(size: float | None) -> float | None:
    """字号必须落在解析层的合法区间，否则 `{@size=2}` 会被当字面文本印到纸面上。"""
    if size is None or not (MIN_SIZE <= size <= MAX_SIZE):
        return None
    return size


def _safe_color(color: str | None) -> str | None:
    """颜色必须能被 `hex_to_rgb` 认出来（`#rgb` / `#rrggbb`），且统一小写。"""
    if not color or hex_to_rgb(str(color)) is None:
        return None
    return str(color).lower()


def runs_to_marks(plain: str, runs: Sequence[RichRun]) -> str:
    """把 `(纯文本, runs)` 投影成渲染层通用的协议串（标记语法）。

    **为什么投影而不是让四个出口各读一遍 runs**：I-12 之后 `item.value` 是纯文本，
    但 HTML(`apply_rich_html`)/PDF(`to_fpdf_markup`)/Word(`add_rich_runs`)/TXT
    (`strip_markers`) 的底层输入**都是**这串协议文本——四个出口各写一遍"runs → 样式"
    就是第二个真源。所以这里只做一次投影，出口侧一行都不用改（也就不会各自漂移）。

    投影是**可逆**的：`parse_rich_runs(runs_to_marks(p, r))` 还原出同样的文字与样式
    （tests/test_inline_rich_runs_export.py 用往返用例钉住）。因此"带 rich 的文档"与
    "等价标记串文档"在四个出口里必然逐字节一致——这正是 P4（旧备份兼容）要的证据。

    无法用标记语法表达或表达会损坏邻居的项（越界字号、非法颜色、含 `]`/`)` 的链接、
    显式取消加粗）**降级丢弃这一项样式**，绝不印出半截标记。
    """
    text = plain or ""
    length = len(text)
    boundaries = {0, length}
    for run in runs:
        boundaries.add(max(0, min(run.start, length)))
        boundaries.add(max(0, min(run.end, length)))
    points = sorted(boundaries)

    # 先算每段的合并样式，再把相邻同态段合并——避免投影出 `**a****b**` 这类碎标记。
    bands: list[tuple[int, int, tuple[Any, ...]]] = []
    for start, end in zip(points, points[1:], strict=False):
        if end <= start:
            continue
        bold = link = size = color = None
        for run in runs:
            if run.start > start or run.end < end:
                continue
            bold = True if (bold or run.bold) else None
            link = link or run.link
            size = size if size is not None else run.size
            color = color or run.color
        style = (bold, _safe_link(text[start:end], link), _safe_size(size), _safe_color(color))
        if bands and bands[-1][2] == style and bands[-1][1] == start:
            bands[-1] = (bands[-1][0], end, style)
            continue
        bands.append((start, end, style))

    pieces: list[str] = []
    for start, end, (bold, link, size, color) in bands:
        body = text[start:end]
        styled = ""
        if size is not None or color:
            attributes: list[str] = []
            if size is not None:
                attributes.append(f"size={size:g}")
            if color:
                attributes.append(f"color={color}")
            # 样式标记必须落在**链接的 label 里面**：解析顺序是 加粗 → 斜体 → 链接 →
            # 样式占位符，样式区间若整个包住 `[label](url)`，占位符就落在链接区间之外，
            # 链接那一段会丢掉字号/颜色（tests 的往返用例钉着这一点）。
            styled = "{@" + ",".join(attributes) + "}"
        if link:
            body = f"[{styled}{body}{STYLE_CLOSE if styled else ''}]({link})"
        elif styled:
            body = f"{styled}{body}{STYLE_CLOSE}"
        if bold:
            body = "**" + body + "**"
        pieces.append(body)
    return "".join(pieces)


def item_text(item: Any, *, key: str = "value") -> str:
    """**四出口的 rich 读路径入口**：有 `rich.runs` 就用它，没有就原样返回正文。

    `key` 是"正文存在哪个字段"：字段/列表/作者/页眉字段是 `value`，正文文本块
    （`TextItem`，kind=text）是 `text`。这是**唯一**的差别，样式逻辑不分叉。

    没有 rich（或 rich 为空）时返回值与改动前**逐字节相同**——退回路径就是既有的
    `parse_rich_runs`，四个出口的行为一点没变（存量简历/旧备份靠这条保证）。有讲究的
    是"有 rich"这一侧：正文是纯文本，样式全在 runs 里，投影后交给同一套解析器。
    """
    value = str(_get(item, key, "") or "")
    runs = item_runs(item)
    if not runs:
        return value
    return runs_to_marks(value, runs)


__all__ = [
    "RichRun",
    "item_runs",
    "item_text",
    "looks_unconverted",
    "parse_marks",
    "runs_to_marks",
]

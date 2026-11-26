# SPDX-License-Identifier: Apache-2.0
"""PDF 内容流改写：删掉一个块里的文字算子、把下方内容整体下移（外部简历改字的写侧）。

**为什么必须删算子，而不是"白底盖住"**：只覆盖不删的话旧文字仍留在文本层——搜索、复制、
**ATS 解析**都读得到旧内容，等于改了个寂寞（简历场景是硬伤）。所以这里按 ISO 32000 的
`BT/ET` + `Tm/Td/TJ` 语义重建页面内容流，只移除 `Tj / TJ / ' / "` 这四种**显示文字**的
算子，**绝不碰** `re` / `S` / `Do`——表格线、底纹、图片因此一个字节不动（"挖出白补丁"
正是碰了它们的结果）。

## 位置怎么算（跟 `q/Q`、`cm`、`Tm` 的变换）

* `q` 压栈、`Q` 出栈 CTM；`cm` 右乘当前 CTM（PDF 用行向量，点 × 矩阵）；
* `BT` 把 `Tm` / `Tlm` 重置为单位阵；`Td` / `TD` / `T*` / `Tm` 维护 `Tlm`；
* `'` 与 `"` 先按 `TL` 换行（等价 `T*`）再显示文字；
* 每个显示文字算子的**起点** = `(Tm.e, Tm.f)` 经 CTM 变换。

**判据只看起点**：起点落在块 bbox 内（留 ``BBOX_PADDING``）就整笔删掉。按算子整段估算
终点要每个字体的字宽表，而 Base14 字体没有 `/Widths`，估出来偏大反而漏删；"漏删 / 多删"
都由调用方在写完后**重扫文本层**兜底（漏删或多删都会让守卫失败 → 整体拒绝，不产出坏
PDF）。这条分工是本模块与 ``external_resume_pdf`` 之间最重要的约定。

## 下移

`shift_content_below` 用 `q 1 0 0 1 0 -delta cm … Q` 包住**阈值以下**的全部算子，比逐个
改坐标稳（也顺带带上线条与图片）。`cm` 在 `BT/ET` 内部是非法算子，所以插入点一律选在
文本对象之外（最近一个 `ET` 之后）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, FloatObject

logger = logging.getLogger(__name__)

# 显示文字的四种算子（ISO 32000-1 §9.4.3）。**只有这四种**会被删。
SHOW_TEXT_OPS = (b"Tj", b"TJ", b"'", b'"')
# bbox 容差（pt）：字形 bbox 与算子起点之间有极小的舍入差。
BBOX_PADDING = 1.5
_IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


@dataclass(frozen=True)
class ContentRewrite:
    """页面内容流改写结果。"""

    content: bytes
    removed_ops: int
    shifted: bool

    @property
    def changed(self) -> bool:
        return bool(self.removed_ops) or self.shifted


def _mult(left: tuple, right: tuple) -> tuple:
    """矩阵右乘：点先经 ``left`` 再经 ``right``。"""
    a1, b1, c1, d1, e1, f1 = left
    a2, b2, c2, d2, e2, f2 = right
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def _translate(x: float, y: float) -> tuple:
    return (1.0, 0.0, 0.0, 1.0, float(x), float(y))


def _as_matrix(operands) -> tuple:
    values = [float(item) for item in operands[:6]]
    return tuple(values)  # type: ignore[return-value]


def _num(operand) -> float:
    try:
        return float(operand)
    except (TypeError, ValueError):
        return 0.0


def _inside_point(
    point: tuple[float, float],
    bbox: tuple[float, float, float, float],
    padding: float,
) -> bool:
    x0, y0, x1, y1 = bbox
    return x0 - padding <= point[0] <= x1 + padding and y0 - padding <= point[1] <= y1 + padding


def _rewrite(
    pdf_bytes: bytes,
    *,
    page_index: int,
    erase_bbox: tuple[float, float, float, float] | None,
    shift_below: tuple[float, float] | None,
) -> ContentRewrite:
    """重建第 ``page_index`` 页（0 基）的内容流。

    ``shift_below`` 是 ``(y 阈值, delta)``：y **小于**该阈值（PDF 坐标里更靠下）的算子
    整体下移 ``delta`` pt。
    """
    reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    writer = PdfWriter(clone_from=reader)
    if not 0 <= page_index < len(writer.pages):
        raise ValueError(f"页序号越界：{page_index}")
    page = writer.pages[page_index]
    contents = page.get_contents()
    if contents is None:
        return ContentRewrite(content=pdf_bytes, removed_ops=0, shifted=False)

    stream = ContentStream(contents, writer)
    removed = 0
    kept: list[tuple[list, bytes]] = []
    ctm: tuple = _IDENTITY
    stack: list[tuple] = []
    tm: tuple = _IDENTITY
    tlm: tuple = _IDENTITY
    leading = 0.0
    shift_after: int | None = None
    # 最近一个"定位类"算子在 kept 里的下标：文字算子的位置是由它决定的，
    # 下移必须从它开始改（只改 Tj 是没有坐标可改的）。
    position_at: int | None = None
    shift_armed = shift_below is not None
    threshold = shift_below[0] if shift_below else 0.0

    for operands, operator in stream.operations:
        op = operator if isinstance(operator, bytes) else str(operator).encode()
        if op == b"q":
            stack.append(ctm)
        elif op == b"Q":
            ctm = stack.pop() if stack else _IDENTITY
        elif op == b"cm":
            ctm = _mult(_as_matrix(operands), ctm)
        elif op == b"BT":
            tm = tlm = _IDENTITY
        elif op == b"TL":
            leading = _num(operands[0]) if operands else 0.0
        elif op == b"Td":
            tlm = _mult(_translate(_num(operands[0]), _num(operands[1])), tlm)
            tm = tlm
        elif op == b"TD":
            leading = -_num(operands[1])
            tlm = _mult(_translate(_num(operands[0]), _num(operands[1])), tlm)
            tm = tlm
        elif op == b"Tm":
            tlm = tm = _as_matrix(operands)
        elif op == b"T*":
            tlm = _mult(_translate(0.0, -leading), tlm)
            tm = tlm
        elif op in SHOW_TEXT_OPS:
            if op in (b"'", b'"'):
                tlm = _mult(_translate(0.0, -leading), tlm)
                tm = tlm
            origin = _mult(_translate(tm[4], tm[5]), ctm)
            if erase_bbox is not None and _inside_point(
                (origin[4], origin[5]), erase_bbox, BBOX_PADDING
            ):
                removed += 1
                continue
            if shift_armed and origin[5] < threshold:
                shift_after = position_at if position_at is not None else len(kept)
                shift_armed = False
        kept.append((list(operands), op))
        if op in _POSITION_OPS:
            position_at = len(kept) - 1

    shifted = False
    if shift_below is not None and shift_after is not None and shift_below[1] > 0:
        shifted = _shift_positions(kept, shift_after, shift_below[1]) > 0

    if removed == 0 and not shifted:
        return ContentRewrite(content=pdf_bytes, removed_ops=0, shifted=False)

    stream.operations = kept
    page.replace_contents(stream)
    buffer = BytesIO()
    writer.write(buffer)
    logger.info("页面内容流已改写：page=%s removed=%s shifted=%s", page_index, removed, shifted)
    return ContentRewrite(content=buffer.getvalue(), removed_ops=removed, shifted=shifted)


# 决定"下一笔文字画在哪"的算子：下移从它们改起。
_POSITION_OPS = (b"BT", b"Td", b"TD", b"Tm", b"T*")

# 需要下移 y 位置的算子（ISO 32000-1 §8/§9）：文本定位、图形状态、路径与矩形。
# 只改数值、不插入 `q/cm`——插 `cm` 要落在 BT/ET 之外，而生成器常把整页文字包在
# 一个大文本对象里（fpdf2 就是这样），那时根本找不到合法的插入点。
_Y_SINGLE = {b"Tm": 5, b"Td": 1, b"TD": 1, b"cm": 5, b"re": 1, b"m": 1, b"l": 1}
_Y_PAIRS = {b"c": (1, 3, 5), b"v": (1, 3), b"y": (1, 3)}


def _shift_positions(ops: list[tuple[list, bytes]], start: int, delta: float) -> int:
    """把第 ``start`` 个算子之后的全部 y 坐标下移 ``delta``（pt，正数向下）。

    返回被改动的算子数（0 = 后面没有可移动的内容）。**图片（``Do``）不会被移动**：
    它靠 CTM 定位，改不了；简历 PDF 里正文下方放整张图的情形极少，真遇到也只是
    "图没跟着动"，不会压坏别的内容。
    """
    adjusted = 0
    for operands, op in ops[start:]:
        index = _Y_SINGLE.get(op)
        if index is not None and len(operands) > index:
            operands[index] = FloatObject(float(operands[index]) - delta)
            adjusted += 1
            continue
        indexes = _Y_PAIRS.get(op)
        if indexes is not None and len(operands) > max(indexes):
            for position in indexes:
                operands[position] = FloatObject(float(operands[position]) - delta)
            adjusted += 1
    return adjusted


def erase_block_text(
    pdf_bytes: bytes,
    bbox: tuple[float, float, float, float],
    *,
    page_index: int,
) -> ContentRewrite:
    """删掉落在 ``bbox`` 内的显示文字算子（返回整份新 PDF 的字节）。"""
    return _rewrite(pdf_bytes, page_index=page_index, erase_bbox=bbox, shift_below=None)


def shift_content_below(
    pdf_bytes: bytes,
    bbox: tuple[float, float, float, float],
    delta: float,
    *,
    page_index: int,
) -> ContentRewrite:
    """把 ``bbox`` 下方（y 更小）的全部内容下移 ``delta`` pt。

    **只在用户点「下移下方内容」时调用**——默认什么都不动（与 Acrobat 的文本框行为一致）。
    """
    if delta <= 0:
        return ContentRewrite(content=pdf_bytes, removed_ops=0, shifted=False)
    return _rewrite(pdf_bytes, page_index=page_index, erase_bbox=None, shift_below=(bbox[1], delta))


def erase_and_shift(
    pdf_bytes: bytes,
    bbox: tuple[float, float, float, float],
    *,
    page_index: int,
    delta: float = 0.0,
) -> ContentRewrite:
    """删字与下移一次做完（避免连着两次改写整页内容流）。"""
    return _rewrite(
        pdf_bytes,
        page_index=page_index,
        erase_bbox=bbox,
        shift_below=(bbox[1], delta) if delta > 0 else None,
    )


__all__ = [
    "BBOX_PADDING",
    "SHOW_TEXT_OPS",
    "ContentRewrite",
    "erase_and_shift",
    "erase_block_text",
    "shift_content_below",
]

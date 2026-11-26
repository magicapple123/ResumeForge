# SPDX-License-Identifier: Apache-2.0
"""外部简历 PDF 的块级编辑：列块、改一块、可选下移（`#5` 的对外立面）。

三件事，串起来就是一次编辑：

1. :func:`analyse` —— 读一份 PDF，切出可点选的文本块（块 id / bbox / 字号 / 行距 / 对齐 /
   可编辑与否 + 原因）。切块规则在 ``external_resume_pdf_blocks``，读侧在
   ``external_resume_pdf_scan``。
2. :func:`replace_block` —— 删掉该块旧的**显示文字算子**（``external_resume_pdf_erase``，
   只删字不碰线条图片）→ 用系统 CJK 字体按原块宽度/字号/行距/对齐重新断行画成透明覆盖层
   （``external_resume_pdf_overlay``）→ ``merge_page`` 合到原页。
3. 写完**必须验收**（:func:`_verify`）：页数不变、块内文本层是新字、同页其它块的文字
   一个不少。任一不满足就抛错、**不产出 PDF**——"看起来成功但压花了"是这里最不能接受的
   结果，与项目里"登录状态无法判断要说清原因"同一条原则。

**改字能力边界（写进接口文档，不承诺做不到的）**：只支持水平正向文本、单页内的块；
扫描件 / 转曲 / 旋转 / 加密 / 表单页在比这更早的一层就明确拒绝了。行数变多时**默认不动
下方内容**（与 Acrobat 的文本框行为一致），只有调用方显式给 ``shift_below`` 才下移。
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader, PdfWriter

from .external_resume_pdf_blocks import TextBlock, group_blocks, mark_tabular, split_into_lines
from .external_resume_pdf_erase import erase_and_shift
from .external_resume_pdf_overlay import render_block_text
from .external_resume_pdf_scan import (
    CODE_NO_TEXT,
    PdfEditError,
    PdfScan,
    scan_pdf,
    system_font_charset,
)

logger = logging.getLogger(__name__)

# 块级失败原因码（与读侧的 pdf_* 同一套命名）。
CODE_BLOCK_NOT_FOUND = "pdf_block_not_found"
CODE_BLOCK_NOT_EDITABLE = "pdf_block_not_editable"
CODE_BLOCK_ROTATED = "pdf_block_rotated"
CODE_BLOCK_GLYPHS = "pdf_block_missing_glyphs"
CODE_PAGE_ROTATED = "pdf_page_rotated"
CODE_ERASE_FAILED = "pdf_erase_failed"
CODE_VERIFY_FAILED = "pdf_edit_verify_failed"

# 一次编辑后的比对容差（pt）：覆盖层与原块的位置差在 1pt 内都算对齐。
_GEOMETRY_TOL = 1.0
# 验收时判定"块内字形"的 bbox 膨胀量（pt）：覆盖层的字可能比原字略宽一点。
_VERIFY_PADDING = 2.5
# 判定"这一笔旧字删干净了"的容差（pt）。
_ERASE_TOL = 1.0


@dataclass(frozen=True)
class PageBox:
    """页面尺寸（pt，未旋转的 MediaBox）。"""

    width: float
    height: float


@dataclass(frozen=True)
class BlockView:
    """一个可点选的文本块（接口直接吐这个形状）。"""

    block_id: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    leading: float
    align: str
    text: str
    editable: bool
    # 不可编辑的原因码（可编辑时为空串）；前端据此显示"这一块为什么不能改"。
    reason: str = ""


@dataclass(frozen=True)
class BlockDocument:
    """一份 PDF 的切块结果。"""

    page_count: int
    page_sizes: tuple[PageBox, ...]
    blocks: tuple[BlockView, ...]

    @property
    def editable_count(self) -> int:
        return sum(1 for block in self.blocks if block.editable)


@dataclass(frozen=True)
class ReplaceOutcome:
    """一次改字的结果（连同"要不要提醒用户下移"的判定）。"""

    content: bytes
    block_id: str
    page: int
    font_size: float
    scaled: bool
    lines_before: int
    lines_after: int
    # 块高的变化（pt，> 0 = 变高，即向下多占了空间）。
    delta_pt: float
    # 变高后是否会压到下方的其它块（前端据此画红框 + 给「下移」按钮）。
    overflow: bool
    shifted: bool


def _page_boxes(reader: PdfReader) -> tuple[PageBox, ...]:
    boxes: list[PageBox] = []
    for page in reader.pages:
        box = page.mediabox
        boxes.append(PageBox(width=float(box.width), height=float(box.height)))
    return tuple(boxes)


def _block_reason(block: TextBlock, charset: set[str]) -> str:
    """块不可编辑的原因码（可编辑返回空串）。顺序即优先级：先说最不可绕过的。"""
    if block.rotated:
        return CODE_BLOCK_ROTATED
    if not block.text.strip():
        return CODE_BLOCK_NOT_EDITABLE
    if not block.rerenderable(charset):
        return CODE_BLOCK_GLYPHS
    if block.width <= 0 or block.size < 4:
        return CODE_BLOCK_NOT_EDITABLE
    return ""


def _blocks_of(scan: PdfScan) -> list[TextBlock]:
    blocks: list[TextBlock] = []
    for index, page_glyphs in enumerate(scan.pages, start=1):
        blocks.extend(group_blocks(mark_tabular(split_into_lines(page_glyphs)), index))
    return blocks


def analyse(pdf_bytes: bytes) -> BlockDocument:
    """切块 + 判可编辑性；不能编辑的文件直接抛 :class:`PdfEditError`。"""
    if _has_rotated_page(pdf_bytes):
        raise PdfEditError(
            CODE_PAGE_ROTATED,
            message="这份 PDF 的页面被旋转过，坐标与显示不一致，不支持在线编辑",
        )
    scan = scan_pdf(pdf_bytes)
    reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    charset = system_font_charset()
    views: list[BlockView] = []
    for block in _blocks_of(scan):
        reason = _block_reason(block, charset)
        views.append(
            BlockView(
                block_id=block.block_id,
                page=block.page,
                x0=round(block.x0, 2),
                y0=round(block.y0, 2),
                x1=round(block.x1, 2),
                y1=round(block.y1, 2),
                size=block.size,
                leading=block.leading,
                align=block.align,
                text=block.text,
                editable=not reason,
                reason=reason,
            )
        )
    document = BlockDocument(
        page_count=scan.page_count,
        page_sizes=_page_boxes(reader),
        blocks=tuple(views),
    )
    if document.editable_count == 0:
        raise PdfEditError(
            CODE_BLOCK_NOT_EDITABLE,
            message="这份 PDF 里没有可编辑的文字块（全是图形或旋转文字），不支持在线编辑",
        )
    return document


def _has_rotated_page(pdf_bytes: bytes) -> bool:
    try:
        reader = PdfReader(BytesIO(pdf_bytes), strict=False)
        for page in reader.pages:
            rotation = page.get("/Rotate") or 0
            if int(rotate_value(rotation)) % 360 != 0:
                return True
    except Exception:  # noqa: BLE001 - 读不出旋转信息时交给后续解析去报错
        logger.info("读取页面旋转信息失败，按未旋转处理", exc_info=True)
        return False
    return False


def rotate_value(value: object) -> float:
    """`/Rotate` 可能是间接引用或字符串，统一成数字（认不出来按 0 处理）。"""
    getter = getattr(value, "get_object", None)
    raw: object = getter() if callable(getter) else value
    if isinstance(raw, (int, float, str)):
        try:
            return float(raw)
        except ValueError:
            return 0.0
    return 0.0


def _collides_with(below: list[TextBlock], target: TextBlock, new_bottom: float) -> bool:
    """变高后的块会不会压到下方已有的块（横向有交叠、且顶边高过新底边）。"""
    for other in below:
        if other.block_id == target.block_id:
            continue
        if other.x1 <= target.x0 or other.x0 >= target.x1:
            continue
        if other.y1 > target.y0 + _GEOMETRY_TOL:
            # 与本块同一水平带（不是"下方"）；换块编辑时会重叠，不算本块的溢出。
            continue
        if other.y1 > new_bottom:
            return True
    return False


def _merge_overlay(pdf_bytes: bytes, page_index: int, overlay: bytes) -> bytes:
    """把覆盖层合到指定页（`clone_from` 保证页面归属 writer，避免弃用告警）。"""
    reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    writer = PdfWriter(clone_from=reader)
    stamp = PdfReader(BytesIO(overlay), strict=False).pages[0]
    writer.pages[page_index].merge_page(stamp)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _page_text(page_glyphs) -> str:
    return "".join(glyph.ch for glyph in page_glyphs)


def _verify(
    content: bytes,
    *,
    before_text: str,
    old_text: str,
    new_text: str,
    page_count: int,
) -> None:
    """写完之后的硬验收：页数不变，且整页字符**逐字**等于"原页 − 旧块 + 新块"。

    **为什么按字符计数验，而不按"新文字是否连续出现在整页文本里"验**：新文字换行后
    可能落到原 bbox 下方，甚至与下一块的行带交错（这正是要给用户红框警告的情形）。
    那时整页文本的顺序是"新块的前几行 → 邻块 → 新块的后几行"，任何"整段连续包含"的
    断言都会假红。改成字符多重集比对后，这条断言反而更强：它同时证明了旧字已不在
    文本层、新字一个不少、其余内容一个不多不少（被挖掉的表格文字、丢掉的邻块都会露馅）。
    """
    scan = scan_pdf(content)
    if scan.page_count != page_count:
        raise PdfEditError(CODE_VERIFY_FAILED, f"页数 {page_count}→{scan.page_count}")
    after = Counter("".join("".join(_page_text(page) for page in scan.pages).split()))
    expected = (
        Counter("".join(before_text.split()))
        - Counter("".join(old_text.split()))
        + Counter("".join(new_text.split()))
    )
    if after == expected:
        return
    missing = expected - after
    extra = after - expected
    detail = []
    if missing:
        detail.append("少了 " + "".join(sorted(missing.elements()))[:20])
    if extra:
        detail.append("多了 " + "".join(sorted(extra.elements()))[:20])
    raise PdfEditError(CODE_VERIFY_FAILED, "；".join(detail))


def _assert_erased(content: bytes, block: TextBlock) -> None:
    """删算子那一步之后，原块的每一行都**不能再有字形**。

    这是"旧文字真的没了"最直接的证据：覆盖层的字在合并之前根本不存在，所以此时块内
    只要还有字，就一定是没删掉的旧字。漏删会让搜索 / 复制 / ATS 读到旧内容，是这条
    链路上最不能接受的失败。
    """
    try:
        scan = scan_pdf(content)
    except PdfEditError as exc:
        if exc.code == CODE_NO_TEXT:
            # 整页文字都被删光了：这正是"删干净"的极端情形，不是失败。
            return
        raise
    if block.page > len(scan.pages):
        return
    leftover: list[str] = []
    for glyph in scan.pages[block.page - 1]:
        for line in block.lines:
            if (
                line.x0 - _ERASE_TOL <= glyph.x0
                and glyph.x1 <= line.x1 + _ERASE_TOL
                and line.y0 - _ERASE_TOL <= glyph.y0
                and glyph.y1 <= line.y1 + _ERASE_TOL
            ):
                leftover.append(glyph.ch)
                break
    if leftover:
        raise PdfEditError(
            CODE_ERASE_FAILED,
            f"残留 {len(leftover)} 个字形：{''.join(leftover)[:20]}",
            message="旧文字没能从文本层删干净，为避免改完还能被搜到，本次未保存",
        )


def replace_block(
    pdf_bytes: bytes,
    block_id: str,
    new_text: str,
    *,
    shift_below: float = 0.0,
) -> ReplaceOutcome:
    """把 ``block_id`` 这一块的文字改成 ``new_text``（其余版式不动）。

    ``shift_below`` 只有在用户点了「下移下方内容」时才传（>0），默认 0 = 什么都不动。
    """
    document = analyse(pdf_bytes)
    target = next((block for block in document.blocks if block.block_id == block_id), None)
    if target is None:
        raise PdfEditError(
            CODE_BLOCK_NOT_FOUND, block_id, message="这一块已经不存在了，请刷新后重试"
        )
    if not target.editable:
        raise PdfEditError(
            target.reason or CODE_BLOCK_NOT_EDITABLE,
            block_id,
            message="这一块不能在线编辑（旋转 / 倾斜 / 含系统字体渲染不出的字）",
        )
    charset = system_font_charset()
    missing = sorted({ch for ch in new_text if not ch.isspace() and ch not in charset})
    if missing:
        raise PdfEditError(
            CODE_BLOCK_GLYPHS,
            "".join(missing[:10]),
            message="新文字里有系统字体渲染不出的字，请换掉这些字",
        )
    if "".join(new_text.split()) == "".join(target.text.split()) and shift_below <= 0:
        # 文字没变、也不下移：再写一版只会多一条空历史，还让"删旧字"这一步无从验收。
        # 但"同文 + 下移"是合法的一次操作——界面上「下移下方内容」就是在已经改完字之后，
        # 拿同样的文字再提交一次并带上 delta，那一次必须放行。
        raise PdfEditError(
            CODE_BLOCK_NOT_EDITABLE, block_id, message="新文字与原文字相同，没有需要保存的修改"
        )

    scan = scan_pdf(pdf_bytes)
    blocks = _blocks_of(scan)
    block = next(item for item in blocks if item.block_id == block_id)
    box = document.page_sizes[target.page - 1]
    layout = render_block_text(block, new_text, page_width=box.width, page_height=box.height)

    rewritten = erase_and_shift(
        pdf_bytes,
        [(line.x0, line.y0, line.x1, line.y1) for line in block.lines],
        page_index=target.page - 1,
        delta=shift_below,
    )
    if rewritten.removed_ops == 0:
        raise PdfEditError(
            CODE_ERASE_FAILED,
            block_id,
            message="没能在这块文字上定位到可删除的文字算子，为避免压坏原文已中止",
        )
    _assert_erased(rewritten.content, block)
    content = _merge_overlay(rewritten.content, target.page - 1, layout.content)
    _verify(
        content,
        before_text="".join(_page_text(page) for page in scan.pages),
        old_text=block.text,
        new_text=new_text,
        page_count=document.page_count,
    )

    new_bottom = min(block.y0, layout.last_baseline - block.size * 0.3)
    delta = round(block.y0 - new_bottom, 2)
    same_page = [item for item in blocks if item.page == block.page]
    outcome = ReplaceOutcome(
        content=content,
        block_id=block_id,
        page=target.page,
        font_size=layout.font_size,
        scaled=layout.scaled,
        lines_before=len(block.lines),
        lines_after=layout.lines,
        delta_pt=max(delta, 0.0),
        overflow=_collides_with(same_page, block, new_bottom) and delta > 0,
        shifted=rewritten.shifted,
    )
    logger.info(
        "外部简历 PDF 改字成功 block=%s page=%s lines=%s→%s delta=%.1f",
        block_id,
        target.page,
        outcome.lines_before,
        outcome.lines_after,
        outcome.delta_pt,
    )
    return outcome


__all__ = [
    "CODE_BLOCK_GLYPHS",
    "CODE_BLOCK_NOT_EDITABLE",
    "CODE_BLOCK_NOT_FOUND",
    "CODE_BLOCK_ROTATED",
    "CODE_ERASE_FAILED",
    "CODE_PAGE_ROTATED",
    "CODE_VERIFY_FAILED",
    "BlockDocument",
    "BlockView",
    "PageBox",
    "ReplaceOutcome",
    "analyse",
    "replace_block",
]

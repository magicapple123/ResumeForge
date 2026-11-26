# SPDX-License-Identifier: Apache-2.0
"""PDF 块级改字（#5）的后端守卫：删旧字、保邻块、页数不变、框外像素零差异。

**为什么要有"框外像素零差异"这一条**：只比文本层证明不了"没压坏别的东西"——表格线、
底纹、图标都在图形层，被挖出白补丁时文本层看起来完全正常。这里用真实渲染器
（pypdfium2，渲染库本身不打桩）出两张位图做差，差异必须落在被编辑的块里。

**反证（手工跑过）**：把 ``external_resume_pdf_erase`` 里"删算子"的分支改成恒不命中，
``test_replace_block_removes_old_text`` 与 ``test_edit_changes_only_the_target_block``
两条精确变红；复原后 sha256 一致、复绿。
"""

from __future__ import annotations

import io

import pypdfium2 as pdfium
import pytest
from app.services.external_resume_pdf import analyse, replace_block
from app.services.external_resume_pdf_scan import (
    CODE_NO_TEXT,
    PdfEditError,
    system_font_path,
)
from fpdf import FPDF
from PIL import Image, ImageChops, ImageDraw
from pypdf import PdfReader

# 与覆盖层用同一个字体族名不冲突：各建各的 FPDF 实例。
_FONT = "test-src"

pytestmark = pytest.mark.skipif(
    system_font_path() is None, reason="本机没有可用的中文字体，PDF 改字用例无从构造"
)


def build_pdf(blocks: list[tuple[str, float, float]]) -> bytes:
    """按 ``(文字, 字号, 基线 y)`` 造一份单页 PDF（fpdf2 产物，带内嵌 CMap）。"""
    pdf = FPDF(unit="pt", format=(595, 842))
    pdf.add_font(_FONT, "", str(system_font_path()))
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    for text, size, baseline in blocks:
        pdf.set_font(_FONT, size=size)
        pdf.text(50, 842 - baseline, text)
    return bytes(pdf.output())


def pages_of(data: bytes):
    return PdfReader(io.BytesIO(data)).pages


def _text_of(data: bytes) -> str:
    return "".join(page.extract_text() for page in pages_of(data))


def _render(data: bytes) -> Image.Image:
    with pdfium.PdfDocument(data) as document:
        page = document[0]
        return page.render(scale=2).to_pil().convert("RGB")


def _block_rect_px(block, page_height: float, scale: float = 2.0, pad: float = 2.0):
    """块在渲染位图里的包围盒（PDF 的 y 向上 → 位图的 y 向下）。"""
    left = (block.x0 - pad) * scale
    right = (block.x1 + pad) * scale
    top = (page_height - block.y1 - pad) * scale
    bottom = (page_height - block.y0 + pad) * scale
    return (left, top, right, bottom)


def _outside_rect(box, size) -> Image.Image:
    """返回"rect 之外"的掩码：把差异限制在被编辑的块里，其余位置必须一像素不差。"""
    mask = Image.new("L", size, 255)
    ImageDraw.Draw(mask).rectangle(tuple(int(value) for value in box), fill=0)
    return mask


def test_replace_block_removes_old_text_and_keeps_the_neighbour():
    """核心不变量：旧字从文本层消失、新字可提取、同页其它块一字不差、页数不变。"""
    data = build_pdf([("旧标题文字", 18, 780), ("正文内容保持不变", 10, 700)])
    document = analyse(data)
    target = next(block for block in document.blocks if "旧标题" in block.text)
    other = next(block for block in document.blocks if "正文内容" in block.text)

    outcome = replace_block(data, target.block_id, "新标题文字")

    page_text = _text_of(outcome.content).replace("\n", "").replace(" ", "")
    assert "新标题文字" in page_text
    assert "旧标题文字" not in page_text, "旧文字还留在文本层：搜索/复制/ATS 都会读到它"
    assert "正文内容保持不变" in page_text
    assert len(pages_of(outcome.content)) == 1
    assert outcome.page == target.page
    assert other.block_id != target.block_id


def test_edit_changes_only_the_target_block():
    """框外像素零差异（真实渲染比对）：表格线/底纹/邻块都不能被碰。"""
    data = build_pdf([("第一块标题", 18, 780), ("第二块正文", 10, 700)])
    document = analyse(data)
    target = next(block for block in document.blocks if "第一块" in block.text)
    page_height = document.page_sizes[0].height

    outcome = replace_block(data, target.block_id, "替换后标题")
    before = _render(data)
    after = _render(outcome.content)
    assert before.size == after.size

    diff = ImageChops.difference(before, after)
    outside = _outside_rect(_block_rect_px(target, page_height), before.size)
    masked = Image.composite(diff, Image.new("RGB", before.size, (0, 0, 0)), outside)
    assert masked.getbbox() is None, "被编辑的块之外出现了像素差异（压坏了别的内容）"


def test_growth_is_reported_and_overflow_flagged():
    """块变高默认不动下方内容，但要如实回报 delta 与"会压到"的判定。"""
    data = build_pdf([("短标题", 18, 780), ("下方正文", 10, 700)])
    document = analyse(data)
    target = next(block for block in document.blocks if "短标题" in block.text)

    # 用很长的文字把这一块撑成多行；块宽只有几十 pt。
    long_text = "这是一个被写得很长的标题用来验证块内回流与溢出提示"
    outcome = replace_block(data, target.block_id, long_text)

    assert outcome.lines_after > outcome.lines_before
    assert outcome.delta_pt > 0
    assert outcome.overflow is True


def test_shift_below_moves_the_following_content_down():
    """用户点「下移」时才动下方内容：下方块的基线真的下移了 delta。"""
    data = build_pdf([("短标题", 18, 780), ("下方正文", 10, 700)])
    document = analyse(data)
    target = next(block for block in document.blocks if "短标题" in block.text)
    below_before = next(block for block in document.blocks if "下方正文" in block.text)

    outcome = replace_block(
        data, target.block_id, "这是一个被写得很长的标题用来验证块内回流与溢出提示", shift_below=30
    )
    assert outcome.shifted is True

    blocks_after = analyse(outcome.content).blocks
    below = next(block for block in blocks_after if "下方正文" in block.text)
    assert below.y1 == pytest.approx(below_before.y1 - 30, abs=1.5), "下移没有作用到下方内容上"


def test_unknown_block_is_rejected_with_a_reason_code():
    data = build_pdf([("第一块标题", 18, 780)])
    with pytest.raises(PdfEditError) as caught:
        replace_block(data, "p1b99", "新标题")
    assert "pdf_block_not_found" in str(caught.value)


def test_identical_text_is_rejected():
    """文字没变就不该写一版：否则历史里会多出一条什么都没改的记录。"""
    data = build_pdf([("第一块标题", 18, 780)])
    document = analyse(data)
    target = next(block for block in document.blocks if "第一块" in block.text)
    with pytest.raises(PdfEditError) as caught:
        replace_block(data, target.block_id, target.text)
    assert "pdf_block_not_editable" in str(caught.value)


def test_pdf_without_text_layer_is_rejected():
    """纯图形页（扫描件 / 转曲）：明确拒绝，不产出压花的 PDF。"""
    pdf = FPDF(unit="pt", format=(595, 842))
    pdf.add_page()
    pdf.set_fill_color(200, 200, 200)
    pdf.rect(50, 50, 400, 600, style="F")
    data = bytes(pdf.output())
    with pytest.raises(PdfEditError) as caught:
        analyse(data)
    assert caught.value.code == CODE_NO_TEXT

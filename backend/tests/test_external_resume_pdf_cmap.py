# SPDX-License-Identifier: Apache-2.0
"""内嵌 CMap 的 PDF（fpdf2 + OTF/CFF 导出件）：归一化与"改完仍能提取"的守卫。

这类文件的 ``/Encoding`` 是**内嵌 CMap 流**（``CMapName=Adobe-Identity-UCS``），而
pdfminer 只按 CMap **名字**查预定义表，查不到就退回空 CMap——表现为整份 PDF 零个字形，
会被误判成扫描件。**本应用自己导出的 PDF 就是这一类**（导出链用思源黑体 OTF），所以
这条一旦回归，"上传自己的导出件 → 提示没有文字层"会立刻复现。

守四件事：

1. **前提成立**：原始字节用 pdfminer 读，确实读不到字（否则这条守卫是空转）；
2. **归一化有效**：把 ``/Encoding`` 改写成 ``/Identity-H`` 后能读到字；
3. **替换后新文字可提取**：改完的 PDF 里能读到新文字、读不到旧文字（这是"改了真生效"的证据）；
4. **上传链也走归一化**：`prepare_upload` 对这类文件不再返回空正文。

反证：把 `normalize_cid_encoding` 短路成恒等函数 → 第 2/3/4 条精确变红；复原后复绿
（sha256 一致）。
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from app.services.external_resume_pdf import analyse, replace_block
from app.services.external_resume_pdf_scan import normalize_cid_encoding, system_font_path
from app.services.external_resumes import prepare_upload
from fpdf import FPDF
from pdfminer.high_level import extract_text as pdfminer_text
from pypdf import PdfReader

# 导出链内置的思源黑体（OTF/CFF）：正是会产出内嵌 CMap 的那种字体。
OTF_FONT = Path(__file__).resolve().parents[1] / "data" / "fonts" / "SourceHanSansSC-Regular.otf"
_BODY = "思源黑体导出的简历正文，用于验证内嵌 CMap 的读取与覆盖式改字是否都能工作"

pytestmark = pytest.mark.skipif(
    not OTF_FONT.is_file() or system_font_path() is None,
    reason="缺少思源黑体 OTF 或系统中文字体，内嵌 CMap 用例无从构造",
)


def build_otf_pdf(text: str) -> bytes:
    pdf = FPDF(unit="pt", format=(595, 842))
    pdf.add_font("source-han", "", str(OTF_FONT))
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    pdf.set_font("source-han", size=14)
    pdf.text(50, 700, text)
    return bytes(pdf.output())


def test_premise_raw_pdfminer_cannot_read_the_embedded_cmap():
    """前提：不归一化时 pdfminer 读不到字——这条不成立的话，后面的守卫就是空转。"""
    raw = build_otf_pdf(_BODY)
    assert pdfminer_text(BytesIO(raw)).strip() == ""


def test_normalization_makes_the_text_readable():
    raw = build_otf_pdf(_BODY)
    normalized, rewritten = normalize_cid_encoding(raw)
    assert rewritten >= 1, "思源黑体导出件的 Type0 字体应当被改写成 /Identity-H"
    assert _BODY in pdfminer_text(BytesIO(normalized))
    # 只改分析副本：原字节一个字节不动。
    assert raw != normalized


def test_replaced_text_is_extractable_and_old_text_is_gone():
    """改完之后：新文字可提取、旧文字读不到（这就是"替换后新文字可提取"的守卫）。"""
    raw = build_otf_pdf(_BODY)
    document = analyse(raw)
    target = next(block for block in document.blocks if _BODY[:10] in block.text)

    new_text = "改过的标题：思源黑体导出件"
    outcome = replace_block(raw, target.block_id, new_text)

    reader = PdfReader(BytesIO(outcome.content))
    extracted = "".join(page.extract_text() or "" for page in reader.pages)
    assert new_text in extracted
    assert _BODY not in extracted, "旧文字仍能被提取：说明删算子或编码归一化有一条没生效"


def test_upload_extraction_normalizes_before_reading():
    """上传链同样要归一化，否则"导出件被当成扫描件"会在上传那一步就发生。"""
    prepared = prepare_upload("exported.pdf", build_otf_pdf(_BODY))
    assert prepared.text.strip(), "上传提取到的正文不能是空的"
    assert _BODY[:10] in prepared.text

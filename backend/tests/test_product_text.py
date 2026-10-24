# SPDX-License-Identifier: Apache-2.0
"""W11 产物文本抽取与顺序对照的唯一实现（`services/resume/product_text`）。

黄金矩阵与检查面板共用这组函数；这里钉住三件事：token 口径、换行归一化、顺序差异
分类。真实 PDF 抽取留一条冒烟（依赖中文字体，缺字体时用例内 skip 并写明原因）。
"""

from __future__ import annotations

import pytest
from app.services.resume.product_text import (
    compare_text_order,
    extract_docx_text,
    extract_pdf_text,
    normalize_text,
    tokens_of,
)

BASE = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "summary": "五年后端开发经验",
    "experience": [
        {
            "company": "示例科技",
            "role": "后端工程师",
            "description": ["负责订单系统重构"],
        }
    ],
}


def test_normalize_and_tokens_strip_wrapping():
    # PDF 会把一句话按行切开：归一化后应仍是同一串 token。
    assert normalize_text("负责订单\n系统 重构") == "负责订单系统重构"
    assert tokens_of("负责订单\n系统 重构 Python3") == ["负责订单系统重构", "Python3"]


def test_compare_missing_versus_out_of_order():
    expected = ["甲方公司", "乙方项目", "丙方成果"]
    extracted = [(1, "乙方项目 甲方公司")]
    diffs = compare_text_order(expected, extracted)
    kinds = {(diff["kind"], diff["token"]) for diff in diffs}
    # 乙的期望位置在甲之后，但产物里它出现在甲之前 → 顺序差异；丙完全找不到 → 缺失。
    assert any(kind == "out_of_order" for kind, _token in kinds)
    assert ("missing", "丙") in kinds


def test_extract_docx_text_reads_document_xml():
    import io
    import zipfile

    xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>你好</w:t></w:r></w:p></w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    assert "你好" in extract_docx_text(buffer.getvalue())


def test_extract_pdf_text_on_real_render():
    from app.schemas.resume import ResumeContent
    from app.services.pdf_exporter import ResumePDFError
    from app.services.pdf_exporter.fit import build_resume_pdf

    try:
        pdf = build_resume_pdf(ResumeContent.model_validate(BASE), template="classic")
    except ResumePDFError as exc:  # 测试机没有中文字体：如实跳过
        pytest.skip(f"测试环境缺少中文字体：{exc}")
    pages = extract_pdf_text(pdf.content)
    assert pages
    joined = "".join(text for _page, text in pages)
    assert "示例科技" in joined

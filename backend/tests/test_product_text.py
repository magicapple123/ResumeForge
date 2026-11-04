# SPDX-License-Identifier: Apache-2.0
"""W11 产物文本抽取与顺序对照的唯一实现（`services/resume/product_text`）。

黄金矩阵与检查面板共用这组函数；这里钉住三件事：token 口径、换行归一化、顺序差异
分类。真实 PDF 抽取留一条冒烟（依赖中文字体，缺字体时用例内 skip 并写明原因）。
"""

from __future__ import annotations

import pytest
from app.services.resume.product_text import (
    compare_text_order,
    compare_text_order_with_highlights,
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


def test_missing_diffs_merge_into_whole_words():
    """R-25：相邻缺字合并成片段——「激活」不再拆成两个黄块。

    症状：前端把每条 diff 都渲染成一个高亮块，逐字返回就得到"黄色断断续续"。
    合并条件是"期望序列相邻且同类"；单字缺失（记者）仍能单独定位。
    """
    expected = ["激活用户", "日更看板"]
    extracted = [(1, "")]  # 全缺

    diffs = compare_text_order(expected, extracted)
    tokens = [diff["token"] for diff in diffs if diff["kind"] == "missing"]

    assert tokens == ["激活用户", "日更看板"]
    # 片段数量必须显著少于字数（否则就是没合并）。
    assert len(tokens) < sum(len(token) for token in tokens)


def test_missing_diffs_do_not_merge_across_pages_for_order():
    """跨页的两段不合并：它们不是一处，合并会让用户在一页里找另一页的词。"""
    expected = ["甲", "乙"]
    extracted = [(1, "乙"), (2, "甲")]

    diffs = compare_text_order(expected, extracted)
    out_of_order = [diff for diff in diffs if diff["kind"] == "out_of_order"]
    # 甲在第 2 页、乙在第 1 页：同类但不连续、不同页 → 各自成条。
    assert all(len(diff["token"]) == 1 for diff in out_of_order)


def test_highlights_point_at_the_single_actual_occurrence():
    """22b：一个字在正文出现多次，只涂真正错位的那一处。

    期望序列第一个字是「与」，产物里却有 5 个「与」；旧前端拿 token 去 `indexOf`，会把
    每一个「与」都涂上。区间由后端算出，正好一个。
    """
    expected = ["与甲"]
    extracted = [(1, "甲与与与与与")]

    diffs, highlights = compare_text_order_with_highlights(expected, extracted)

    assert [diff["kind"] for diff in diffs] == ["out_of_order"]
    assert highlights == [{"page": 1, "start": 0, "end": 1, "kind": "out_of_order"}]
    assert "甲与与与与与"[highlights[0]["start"] : highlights[0]["end"]] == "甲"


def test_missing_only_diff_produces_no_highlight():
    """missing 的字在产物里根本不存在：不许造区间（那会把同名的别处的字涂红）。"""
    _diffs, highlights = compare_text_order_with_highlights(["甲", "乙"], [(1, "乙")])

    assert highlights == []


def test_out_of_order_runs_merge_only_when_product_ranges_touch():
    """`_merge_runs` 新增条件：产物区间必须相邻，否则合出来的片段没有连续区间可涂。"""
    # 产物顺序：丙 x 丁 甲 乙 —— 丙、丁在期望序列里相邻，但产物里被 x 隔开。
    expected = ["甲乙丙丁"]
    split = compare_text_order_with_highlights(expected, [(1, "丙 x 丁 甲 乙")])
    # 产物顺序：丙 丁 甲 乙 —— 区间相邻，可以合并成「丙丁」。
    touching = compare_text_order_with_highlights(expected, [(1, "丙丁甲乙")])

    assert [diff["token"] for diff in split[0]] == ["丙", "丁"]
    assert len(split[1]) == 2
    assert [diff["token"] for diff in touching[0]] == ["丙丁"]
    assert touching[1] == [{"page": 1, "start": 0, "end": 2, "kind": "out_of_order"}]


def test_no_highlights_for_empty_documents_or_empty_extraction():
    """空文档 / 整页抽空都产不出区间（没有可涂的字）。"""
    assert compare_text_order_with_highlights([], [(1, "随便")]) == ([], [])
    _diffs, highlights = compare_text_order_with_highlights(["甲乙"], [(1, "")])
    assert highlights == []


def test_offset_basis_is_code_point_not_utf16():
    """偏移基准钉死：Python 码点。

    「😀」在 Python 里是 1 个字符、在 JS 里是 2 个 UTF-16 码元。若后端改成 UTF-16 偏移，
    这里的 start 会变成 2（3 也不对），前端按码点切就会涂到字外。
    """
    expected = ["甲乙"]
    extracted = [(1, "😀乙甲")]

    _diffs, highlights = compare_text_order_with_highlights(expected, extracted)

    assert len(highlights) == 1
    highlight = highlights[0]
    assert (highlight["start"], highlight["end"]) == (1, 2)
    page_text = "😀乙甲"
    assert page_text[highlight["start"] : highlight["end"]] == "乙"


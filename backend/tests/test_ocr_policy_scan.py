# SPDX-License-Identifier: Apache-2.0
"""扫描件 OCR 的策略层与合并层（不联网、不起服务）。

守的是三条最容易回归的性质：

1. **三档引擎的边界**：``vision`` 绝不发请求、``ocr`` 没 Key 必须报错而不是静默降级；
2. **页序**：OCR 文本按页码并回原位置，文字层够用的页仍用 pypdf（免费、离线、锚定更硬）；
3. **费用**：OCR 成功时不再渲染位图（同一份内容不该付两次钱）。
"""

from __future__ import annotations

import pytest
from app.schemas.ocr import OcrConfig
from app.services.ocr.client import OcrError, OcrPage, OcrResult
from app.services.ocr.policy import (
    OCR_ENGINES,
    OCR_FAILED_FALLBACK_WARNING,
    OCR_PAGE_TRUNCATED_WARNING,
    OCR_USED_WARNING,
    build_ocr_context,
    get_ocr_config,
    save_ocr_config,
)
from app.services.ocr.scan import extract_scan_pages, merge_ocr_pages, user_message_for

TEXT_PAGE = "这是一页有文字层的简历正文，字符数足够多到不会被判成扫描页。" * 2


def _result(texts: list[str], *, request_id: str = "ocr-test", truncated: tuple[int, ...] = ()):
    pages = []
    for index, text in enumerate(texts):
        finish = "length" if (index + 1) in truncated else "stop"
        pages.append(OcrPage(index=index, text=text, finish_reason=finish))
    return OcrResult(
        request_id=request_id,
        purpose="text_recognition",
        page_count=len(texts),
        pages=tuple(pages),
    )


def test_engine_list_is_the_three_documented_tiers():
    """档位是显式设置项（结论 #7）：三档、顺序稳定，默认 auto。"""
    assert OCR_ENGINES == ("auto", "ocr", "vision")
    assert get_ocr_config().engine == "auto"


def test_engine_tiers_decide_whether_ocr_runs():
    assert build_ocr_context("auto", "sk-x").uses_ocr() is True
    assert build_ocr_context("auto", "").uses_ocr() is False
    # 只用视觉模型：即使配了 Key 也不发 OCR 请求（隐私与成本都由用户决定）。
    assert build_ocr_context("vision", "sk-x").uses_ocr() is False
    assert build_ocr_context("ocr", "sk-x").uses_ocr() is True


def test_vision_engine_never_calls_the_ocr_endpoint(monkeypatch):
    """``vision`` 档不得发出任何 DeepSeek 请求——用"一调用就炸"的哨兵证明。"""
    from app.services.ocr import scan as scan_module

    def _tripwire(*args, **kwargs):  # pragma: no cover - 走到这里就是 bug
        raise AssertionError("engine=vision 时不允许调用 OCR")

    monkeypatch.setattr(scan_module, "recognize_document", _tripwire)
    outcome = extract_scan_pages(b"%PDF-1.4 fake", ["", ""], build_ocr_context("vision", "sk-x"))
    assert outcome is None


def test_ocr_engine_without_key_raises_instead_of_falling_back():
    """用户明确选了"只用 OCR"，没有 Key 就必须说清原因，不能偷偷换服务商。"""
    with pytest.raises(OcrError) as excinfo:
        extract_scan_pages(b"%PDF-1.4 fake", [""], build_ocr_context("ocr", ""))
    assert excinfo.value.code == "missing_key"
    message = user_message_for(excinfo.value)
    assert "DeepSeek API Key" in message
    assert "OCR" in message


def test_auto_engine_without_key_keeps_the_old_behaviour():
    """``auto`` 没 Key：返回 None，调用方沿用"渲染位图给视觉模型"的老路。"""
    assert extract_scan_pages(b"%PDF-1.4 fake", [""], build_ocr_context("auto", "")) is None


def test_auto_engine_failure_falls_back_and_says_so(monkeypatch):
    """``auto`` 下 OCR 失败：回落视觉模型，并给出"原件会发给谁"的警告。"""
    from app.services.ocr import scan as scan_module

    def _boom(*args, **kwargs):
        raise OcrError("insufficient_balance")

    monkeypatch.setattr(scan_module, "recognize_document", _boom)
    outcome = extract_scan_pages(b"%PDF-1.4 fake", [""], build_ocr_context("auto", "sk-x"))
    assert outcome is not None
    assert outcome.ok is False
    assert OCR_FAILED_FALLBACK_WARNING in outcome.warnings


def test_merge_keeps_text_layer_pages_and_fills_scan_pages_by_index():
    """页序必须按页码合并：字段锚定要把识别结果对回原文，乱序会让锚定整体失效。"""
    page_texts = [TEXT_PAGE, "", "第二段文字层内容，同样足够长不会被当成扫描页。" * 2, ""]
    # OCR 是按整份 PDF 逐页返回的，所以 index 必须与 PDF 页号对齐：第 1、3 页是文字层，
    # 对应位置给空串，第 2、4 页才是识别结果。
    merged_text, used = merge_ocr_pages(
        page_texts, _result(["", "第 2 页 OCR 文本", "", "第 4 页 OCR 文本"])
    )
    blocks = merged_text.split("\n")
    assert blocks[0].startswith("这是一页有文字层")
    assert "第 2 页 OCR 文本" in merged_text
    assert "第 4 页 OCR 文本" in merged_text
    # OCR 返回的 index 从 0 起；对外回报的页码是 1 起（给用户看）。
    assert used == (2, 4)
    assert merged_text.index("第 4 页 OCR 文本") > merged_text.index("第 2 页 OCR 文本")


def test_merge_appends_pages_beyond_the_local_parse_window():
    """本地只读前 N 页时，OCR 多出来的页仍按页序补在末尾，而不是被丢掉。"""
    merged_text, used = merge_ocr_pages([], _result(["第一页", "第二页", "第三页"]))
    assert used == (1, 2, 3)
    assert merged_text.endswith("第三页")


def test_extract_scan_pages_returns_all_pages_and_counts_them(monkeypatch):
    """9 页扫描件一次识别：正文包含每一页，警告里写明用了 OCR 与页数。"""
    from app.services.ocr import scan as scan_module

    texts = [f"第 {index + 1} 页内容" for index in range(9)]
    monkeypatch.setattr(scan_module, "recognize_document", lambda *a, **k: _result(texts))
    outcome = extract_scan_pages(
        b"%PDF-1.4 fake",
        [""] * 9,
        build_ocr_context("auto", "sk-x"),
        page_count=9,
    )
    assert outcome is not None and outcome.ok is True
    for index in range(9):
        assert f"第 {index + 1} 页内容" in outcome.text
    assert OCR_USED_WARNING.format(pages=9) in outcome.warnings
    assert outcome.page_count == 9


def test_truncated_pages_are_reported(monkeypatch):
    """``finish_reason=length`` 的页必须提示"输出被截断"，不能假装完整。"""
    from app.services.ocr import scan as scan_module

    monkeypatch.setattr(
        scan_module,
        "recognize_document",
        lambda *a, **k: _result(["第一页", "第二页被截断"], truncated=(2,)),
    )
    outcome = extract_scan_pages(b"%PDF-1.4 fake", ["", ""], build_ocr_context("auto", "sk"))
    assert outcome is not None
    assert OCR_PAGE_TRUNCATED_WARNING.format(pages="2") in outcome.warnings


def test_saving_engine_persists_only_the_tier():
    """保存只写引擎档位：Key 归联网搜索那一份，不在这里再存一遍（Q16 的收敛点）。"""
    saved = save_ocr_config(OcrConfig(engine="ocr"))
    assert saved.engine == "ocr"
    assert get_ocr_config().engine == "ocr"
    assert not hasattr(saved, "api_key")


def _blank_pdf(pages: int) -> bytes:
    import io as _io

    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    buffer = _io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_missing_pages_are_recovered_by_page_level_retry(monkeypatch):
    """整份一次识别漏页时，逐页补识别必须把漏掉的页补回来。

    实测依据：同一份 9 页扫描件，整份请求偶尔只回来 4–8 页文本；逐页请求几乎必成。
    空页照常计费，所以补一次比让用户拿到残缺正文划算。
    """
    from app.services.ocr import scan as scan_module

    calls: list[str] = []

    def _fake(page_raw, name, key, *, purpose, content_type):
        calls.append(name)
        if name == "document.pdf":  # 整份一次识别：第 2 页空着
            return _result(["第一页正文", "", "第三页正文"])
        index = int(name.split("-")[1].split(".")[0])
        return _result([f"第 {index} 页补回"])

    monkeypatch.setattr(scan_module, "recognize_document", _fake)
    outcome = extract_scan_pages(
        _blank_pdf(3), ["", "", ""], build_ocr_context("auto", "sk-x"), page_count=3
    )
    assert outcome is not None and outcome.ok is True
    assert "第 2 页补回" in outcome.text
    assert "document.pdf" in calls and "page-2.pdf" in calls
    # 补回来的页不再出现在"没返回文字"的警告里。
    assert not any("没返回文字" in warning for warning in outcome.warnings)


def test_page_still_empty_after_retry_is_named_in_the_warning(monkeypatch):
    """补识别也不给字：必须点名缺哪一页（不允许假装完整）。"""
    from app.services.ocr import scan as scan_module

    def _fake(page_raw, name, key, *, purpose, content_type):
        return (
            _result(["第一页正文", "", "第三页正文"]) if name == "document.pdf" else _result([""])
        )

    monkeypatch.setattr(scan_module, "recognize_document", _fake)
    outcome = extract_scan_pages(
        _blank_pdf(3), ["", "", ""], build_ocr_context("auto", "sk-x"), page_count=3
    )
    assert outcome is not None
    assert any("2" in warning and "没返回文字" in warning for warning in outcome.warnings)

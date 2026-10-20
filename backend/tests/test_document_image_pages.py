# SPDX-License-Identifier: Apache-2.0
"""PDF 图片页（扫描页）识别的离线测试（T03）。

样张自造、零新依赖：文字页沿用 ``test_document_text.build_pdf`` 的手写最小 PDF；
图片页用 Pillow 直接把 ``Image.save`` 成 PDF（纯图片、无文字层）；混合样张用
pypdf 把两种页拼进同一份文件。渲染走真实的 pypdfium2，不 mock 渲染库本身——
只有"预算超限"与"渲染失败"两个降级路径注入桩。
"""

import base64
import io

import pytest
from app.services.document_text import extract_documents_text
from PIL import Image
from pypdf import PdfReader, PdfWriter
from tests.test_document_text import PDF_MIME, DocumentStub, build_pdf

LONG_TEXT = "Company: Example Inc is hiring a backend engineer in Tianjin"


def data_url(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def build_image_pdf(pages: int = 1) -> bytes:
    """Pillow 直接产出纯图片 PDF（无文字层），模拟扫描件。"""
    images = [Image.new("RGB", (120, 160), color=(30 * index, 80, 160)) for index in range(pages)]
    buffer = io.BytesIO()
    images[0].save(buffer, format="PDF", save_all=True, append_images=images[1:])
    return buffer.getvalue()


def build_mixed_pdf(text: str = LONG_TEXT, image_pages: int = 1) -> bytes:
    """文字页在前、扫描页在后的混合 PDF。"""
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(build_pdf(text))))
    writer.append(PdfReader(io.BytesIO(build_image_pdf(image_pages))))
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_pure_text_pdf_behavior_is_unchanged():
    """纯文字 PDF：行为完全不变——不渲染任何图片、不产生扫描页警告。"""
    stub = DocumentStub("jd.pdf", build_pdf(LONG_TEXT), PDF_MIME)

    combined = extract_documents_text([stub])

    assert LONG_TEXT in combined.text
    assert combined.images == ()
    assert combined.warnings == []
    assert combined.size_bytes == len(build_pdf(LONG_TEXT))


def test_image_only_pdf_pages_become_images():
    """纯图片 PDF：文字为空，全部页转图并给出"整份无文字层"警告。"""
    raw = build_image_pdf(2)
    stub = DocumentStub("scan.pdf", raw, PDF_MIME)

    combined = extract_documents_text([stub])

    assert combined.text == ""
    assert len(combined.images) == 2
    for image in combined.images:
        assert image.startswith("data:image/jpeg;base64,")
        # 位图必须可解码：至少能被 PIL 重新打开（与截图上传同一条解码路径）。
        payload = base64.b64decode(image.split(",", 1)[1])
        assert Image.open(io.BytesIO(payload)).size[0] > 0
    assert any("整份 PDF 无文字层" in warning for warning in combined.warnings)
    # 渲染出的图片字节计入体积预算（> 原始文件大小）。
    assert combined.size_bytes > len(raw)


def test_mixed_pdf_merges_text_and_scan_pages():
    """混合型：文字页贡献文本，扫描页转图，警告写明从第几页起。"""
    stub = DocumentStub("jd.pdf", build_mixed_pdf(), PDF_MIME)

    combined = extract_documents_text([stub])

    assert LONG_TEXT in combined.text
    assert len(combined.images) == 1
    assert any("第 2 页起为扫描页" in warning for warning in combined.warnings)


def test_short_text_page_below_threshold_is_treated_as_scan_page():
    """单页 < 30 字符判为图片页：页码水印页不该被当成正文。"""
    raw = build_mixed_pdf(text="P.1", image_pages=1)
    stub = DocumentStub("jd.pdf", raw, PDF_MIME)

    combined = extract_documents_text([stub])

    assert combined.text == ""
    assert len(combined.images) == 2
    assert any("整份 PDF 无文字层" in warning for warning in combined.warnings)


def test_scan_pages_are_capped_at_eight_with_a_warning():
    raw = build_image_pdf(10)
    stub = DocumentStub("scan.pdf", raw, PDF_MIME)

    combined = extract_documents_text([stub])

    assert len(combined.images) == 8
    assert any("只识别前 8 页" in warning for warning in combined.warnings)


def test_rendered_pages_respect_the_attachment_budget(monkeypatch):
    """渲染图体积计入 5 MB 预算：超预算的页按页跳过并警告，不静默丢。"""
    from app.services import document_text

    def fake_render(raw: bytes, page_numbers):  # noqa: ANN001 - 测试桩
        return [(number, b"\xff" * (3 * 1024 * 1024)) for number in page_numbers]

    monkeypatch.setattr(document_text, "render_pdf_page_images", fake_render)
    stub = DocumentStub("jd.pdf", build_mixed_pdf(image_pages=2), PDF_MIME)

    combined = extract_documents_text([stub])

    # 预算 5MB - 文档原始字节：第 2 页勉强放下、第 3 页超限被跳过（按页跳过，逐页警告）。
    assert LONG_TEXT in combined.text
    assert len(combined.images) == 1
    assert any("第 3 页的扫描内容超出附件体积预算" in warning for warning in combined.warnings)


def test_render_failure_falls_back_to_text_or_empty_message(monkeypatch):
    from app.services import document_text

    def broken_render(raw: bytes, page_numbers):  # noqa: ANN001 - 测试桩
        raise RuntimeError("pdfium exploded")

    monkeypatch.setattr(document_text, "render_pdf_page_images", broken_render)

    # 混合型：文字页照常返回，扫描页给"渲染失败"警告。
    combined = extract_documents_text([DocumentStub("jd.pdf", build_mixed_pdf(), PDF_MIME)])
    assert LONG_TEXT in combined.text
    assert combined.images == ()
    assert any("扫描页渲染失败" in warning for warning in combined.warnings)

    # 纯图片 PDF：没有任何可回退的产出，回到原有的空文本报错文案。
    with pytest.raises(ValueError, match="没有从这份文件里提取到文字"):
        extract_documents_text([DocumentStub("scan.pdf", build_image_pdf(), PDF_MIME)])

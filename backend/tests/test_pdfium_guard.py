# SPDX-License-Identifier: Apache-2.0
"""PDFium 全生命周期互斥：三个入口（预览 / 导出 / 测量）不能并发进入同一进程。

失败必须释放锁——否则下一次渲染会永远等在锁上；坏 PDF 要报"可恢复"的错误，而不是让
后续文档也渲染不了；缺字体要在进入 PDFium **之前**就报错。
"""

from __future__ import annotations

import base64
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from app.api.attachments import preview_pdf
from app.schemas.attachments import PdfPreviewRequest
from app.services import pdf_page_images
from app.services.resume import preview_pages
from PIL import Image


def test_pdfium_lifecycle_is_serialized_across_all_three_entry_points(tmp_path, monkeypatch):
    """Fail before entering C if another document is still open."""
    state_lock = threading.Lock()
    active = 0
    opened = 0
    start = threading.Barrier(6)

    class Bitmap:
        def to_pil(self):
            return Image.new("RGB", (90, 120), "white")

        def close(self):
            pass

    class Page:
        def get_size(self):
            return 90, 120

        def render(self, **kwargs):
            time.sleep(0.003)
            return Bitmap()

        def close(self):
            pass

    class Document:
        def __init__(self, raw):
            nonlocal active, opened
            with state_lock:
                assert active == 0, "PDFium entered while a document was still open"
                active += 1
                opened += 1
            time.sleep(0.003)

        def __len__(self):
            return 2

        def __getitem__(self, index):
            return Page()

        def close(self):
            nonlocal active
            with state_lock:
                active -= 1

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.close()

    monkeypatch.setattr(preview_pages.pdfium, "PdfDocument", Document)
    monkeypatch.setattr(preview_pages, "cache_root", lambda: tmp_path)
    raw = b"%PDF-1.4\nserial test body"
    payload = PdfPreviewRequest(
        name="test.pdf",
        mime_type="application/pdf",
        data=base64.b64encode(raw).decode("ascii"),
        pages=2,
    )

    def invoke(index):
        if index < 6:
            start.wait(timeout=5)
        if index % 3 == 0:
            result = preview_pages.render_preview_pages(
                raw + str(index).encode(), width_px=64, dpr=1
            )
            assert result.page_count == 2
        elif index % 3 == 1:
            result = pdf_page_images.render_pdf_page_images(raw, [1, 2])
            assert [number for number, _ in result] == [1, 2]
        else:
            assert len(preview_pdf(payload).pages) == 2

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(invoke, range(12)))

    assert opened == 24
    assert active == 0


def test_failed_pdfium_operation_releases_the_process_lock():
    from app.services.pdfium_guard import run_locked

    @run_locked
    def fail():
        raise ValueError("broken document")

    @run_locked
    def recover():
        return 42

    with pytest.raises(ValueError, match="broken document"):
        fail()
    with ThreadPoolExecutor(max_workers=1) as pool:
        assert pool.submit(recover).result(timeout=2) == 42


def test_bad_pdf_reports_engine_recovery_and_next_document_still_renders(tmp_path, monkeypatch):
    from fpdf import FPDF

    monkeypatch.setattr(preview_pages, "cache_root", lambda: tmp_path)
    with pytest.raises(preview_pages.PreviewPagesError) as error:
        preview_pages.render_preview_pages(b"not a PDF", width_px=64, dpr=1)
    assert str(error.value) == preview_pages.PDFIUM_ERROR_MESSAGE
    assert "字体" not in str(error.value)
    pdf = FPDF()
    pdf.add_page()
    assert (
        preview_pages.render_preview_pages(bytes(pdf.output()), width_px=64, dpr=1).page_count == 1
    )


def test_missing_font_remains_a_generation_error_before_pdfium(client, monkeypatch):
    from app.services.pdf_exporter import fit

    created = client.post(
        "/api/resumes/manual",
        json={"title": "Missing font", "content": {"name": "PDF font check", "summary": "Test"}},
    )
    assert created.status_code == 201, created.text
    monkeypatch.setattr(fit, "resolve_font_paths", lambda font_name: None)

    def must_not_open(raw):
        pytest.fail("Font generation failure must not call PDFium")

    monkeypatch.setattr(preview_pages, "_open_document", must_not_open)
    response = client.post(
        f"/api/resumes/{created.json()['id']}/preview-pages", json={"width": 320, "dpr": 1}
    )
    assert response.status_code == 409, response.text
    assert "中文字体" in response.json()["detail"]
    assert preview_pages.PDFIUM_ERROR_MESSAGE not in response.json()["detail"]

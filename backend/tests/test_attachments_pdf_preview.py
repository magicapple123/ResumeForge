# SPDX-License-Identifier: Apache-2.0
"""PDF 预览接口（项 7 / D14 / D15）：服务端渲染前 N 页成 JPEG。

老实现是 `window.open(dataUrl)` 交给浏览器内置阅读器——Chrome/Edge 已禁止顶层导航到
`data:`，Electron 没有内置查看器，所以"点预览打不开"是**必然**而不是偶发。这条接口
把"能看到内容"这件事变成服务端可测的行为：正常出图、页数越界说清原因、坏文件与超大
文件都给用户能读懂的 422。
"""

from __future__ import annotations

import base64

import pytest
from fpdf import FPDF


def make_pdf(pages: int = 1) -> bytes:
    """用 fpdf2 造一份指定页数的真实 PDF（不是伪文件）。"""
    pdf = FPDF()
    for index in range(pages):
        pdf.add_page()
        pdf.set_font("helvetica", size=14)
        pdf.cell(text=f"page {index + 1}")
    return bytes(pdf.output())


def data_url(raw: bytes) -> str:
    """与前端同一种投递形态：data URL（裸 base64 也支持，这里取更严格的那一种）。"""
    return "data:application/pdf;base64," + base64.b64encode(raw).decode("ascii")


def test_pdf_preview_returns_first_pages_as_jpeg(client):
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "岗位描述.pdf",
            "mime_type": "application/pdf",
            "data": data_url(make_pdf(2)),
            "pages": 2,
        },
    )

    assert response.status_code == 200, response.text
    pages = response.json()["pages"]
    assert [item["page"] for item in pages] == [1, 2]
    for item in pages:
        # 前端直接用 <img src> 渲染，所以必须是 data URL 而不是裸字节。
        assert item["image"].startswith("data:image/jpeg;base64,")
        assert len(item["image"]) > len("data:image/jpeg;base64,")


def test_pdf_preview_rejects_page_beyond_document(client):
    """页数越界要说清"这份有几页"，而不是给一个通用失败。"""
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "岗位描述.pdf",
            "mime_type": "application/pdf",
            "data": data_url(make_pdf(2)),
            "pages": 3,
        },
    )

    assert response.status_code == 422
    assert "只有 2 页" in response.json()["detail"]


def test_pdf_preview_rejects_broken_file(client):
    """坏文件：名字是 .pdf、内容是随机字节 → 422，且不把底层异常原文漏给用户。"""
    garbage = b"%PDF-1.4\n" + b"\x00\x01\x02not a real pdf body" * 8
    response = client.post(
        "/api/attachments/pdf-preview",
        json={"name": "坏文件.pdf", "mime_type": "application/pdf", "data": data_url(garbage)},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    # 文案要么来自 document_source（格式不符），要么是我们的兜底句；总之必须是人话。
    assert "PDF" in detail
    assert "Traceback" not in detail


def test_pdf_preview_accepts_bare_base64(client):
    """裸 base64 也收：接口契约写的是"data URL 或裸 base64"，补前缀后走同一条校验。"""
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "岗位描述.pdf",
            "mime_type": "application/pdf",
            "data": base64.b64encode(make_pdf(1)).decode("ascii"),
        },
    )

    assert response.status_code == 200, response.text
    assert [item["page"] for item in response.json()["pages"]] == [1]


def test_pdf_preview_rejects_oversized_file(client):
    """> 2 MB 走的是 `document_source` 的体积上限（与识别链路同一份预算）。"""
    oversized = b"%PDF-1.4\n" + b"0" * (2 * 1024 * 1024 + 16)
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "太大.pdf",
            "mime_type": "application/pdf",
            "data": base64.b64encode(oversized).decode("ascii"),
        },
    )

    assert response.status_code == 422
    assert "2 MB" in response.json()["detail"]


def test_pdf_preview_rejects_non_pdf(client):
    """图片不是 PDF：这个接口只收文档，直接说"格式不受支持"而不是硬解析。"""
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "截图.png",
            "mime_type": "image/png",
            "data": "data:image/png;base64,iVBORw0KGgo=",
        },
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "不受支持" in detail or "不是 PDF" in detail


def test_pdf_preview_pages_defaults_to_one(client):
    """不传 pages 时只看首页——预览的目的是"确认传对了文件"，不必渲染整份（D15）。"""
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "岗位描述.pdf",
            "mime_type": "application/pdf",
            "data": data_url(make_pdf(3)),
        },
    )

    assert response.status_code == 200
    assert [item["page"] for item in response.json()["pages"]] == [1]


@pytest.mark.parametrize("pages", [0, 4])
def test_pdf_preview_pages_must_be_within_schema_bounds(client, pages):
    """`pages` 的 1–3 由 schema 挡在门口（不去渲染之后才发现越界）。"""
    response = client.post(
        "/api/attachments/pdf-preview",
        json={
            "name": "岗位描述.pdf",
            "mime_type": "application/pdf",
            "data": data_url(make_pdf(4)),
            "pages": pages,
        },
    )

    assert response.status_code == 422

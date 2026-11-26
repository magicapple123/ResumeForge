# SPDX-License-Identifier: Apache-2.0
"""外部简历「在应用内改字」的接口契约（#5）：块清单 / 编辑 / 历史版本 / 恢复。

钉住五件事：

1. **不覆盖原件**：编辑写一个新 `user_file`，`file_id` 指向新文件，旧文件仍在；
2. **另存新版本**：每次编辑 / 恢复都追加一条 `external_resume_revision`，历史只增不减；
3. **正文同步刷新**：编辑后 `text / text_chars / has_text` 是新文件的，"用于面试"不再拿旧正文；
4. **PDF 旧字真被删掉**：新文件里搜不到改掉的那段文字（守 `erase` 那一步）；
5. **能力边界**：扫描件 / 不支持的后缀给 422 + 可读原因，不产出坏文件。

反证（手工跑过）：把 `external_resume_pdf_erase._rewrite` 里"命中即删"的分支改成恒不命中，
`test_edit_pdf_removes_old_text_from_the_text_layer` 与
`test_edit_pdf_keeps_the_neighbours_text` 精确变红；复原后 sha256 一致、复绿。
"""

from __future__ import annotations

import io

import pytest
from app.services.external_resume_pdf_scan import system_font_path
from docx import Document
from fpdf import FPDF

_FONT = "test-api"

pytestmark = pytest.mark.skipif(
    system_font_path() is None, reason="本机没有可用的中文字体，PDF 相关用例无从构造"
)


def build_pdf(blocks: list[tuple[str, float, float]]) -> bytes:
    pdf = FPDF(unit="pt", format=(595, 842))
    pdf.add_font(_FONT, "", str(system_font_path()))
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()
    for text, size, baseline in blocks:
        pdf.set_font(_FONT, size=size)
        pdf.text(50, 842 - baseline, text)
    return bytes(pdf.output())


def build_docx(paragraphs: list[tuple[str, bool]]) -> bytes:
    """造一份 docx：每段一个 run，`bold` 用来验证"改字后格式还在"。"""
    document = Document()
    for text, bold in paragraphs:
        paragraph = document.add_paragraph()
        run = paragraph.add_run(text)
        run.bold = bold
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def upload(client, name: str, content: bytes, mime: str) -> dict:
    response = client.post(
        "/api/external-resumes",
        files={"file": (name, content, mime)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def edit(client, resume_id: int, block_id: str, text: str, **extra) -> dict:
    response = client.post(
        f"/api/external-resumes/{resume_id}/edit",
        json={"block_id": block_id, "text": text, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def file_text(client, resume_id: int, revision_id: int | None = None) -> str:
    params = {"revision_id": revision_id} if revision_id is not None else None
    response = client.get(f"/api/external-resumes/{resume_id}/file", params=params)
    assert response.status_code == 200, response.text
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(response.content))
    return "".join(page.extract_text() for page in reader.pages).replace("\n", "").replace(" ", "")


def test_blocks_lists_pdf_blocks_with_geometry(client):
    body = upload(
        client,
        "resume.pdf",
        build_pdf([("第一行标题", 18, 780), ("第二行正文", 10, 700)]),
        "application/pdf",
    )
    blocks = client.get(f"/api/external-resumes/{body['id']}/blocks")
    assert blocks.status_code == 200, blocks.text
    payload = blocks.json()
    assert payload["kind"] == "pdf"
    assert payload["page_count"] == 1
    assert payload["blocks"], "PDF 至少要切出一个可编辑块"
    first = payload["blocks"][0]
    assert first["editable"] is True
    assert first["x1"] > first["x0"] and first["y1"] > first["y0"]
    assert first["size"] > 0


def test_edit_pdf_removes_old_text_and_saves_new_version(client):
    original = build_pdf([("旧标题", 18, 780)])
    body = upload(client, "resume.pdf", original, "application/pdf")
    block_id = client.get(f"/api/external-resumes/{body['id']}/blocks").json()["blocks"][0][
        "block_id"
    ]

    result = edit(client, body["id"], block_id, "新标题文字")
    assert result["kind"] == "pdf"
    assert result["revision"]["source"] == "edit"
    assert result["revision"]["current"] is True
    assert result["resume"]["text_chars"] > 0
    assert result["resume"]["file_id"] != body["file_id"], "编辑必须写新文件，不能覆盖原件"

    text = file_text(client, body["id"])
    assert "新标题文字" in text
    assert "旧标题" not in text, "旧文字还在文本层：ATS / 复制 / 搜索都会读到它"


def test_edit_pdf_keeps_the_neighbours_text(client):
    body = upload(
        client,
        "resume.pdf",
        build_pdf([("待改标题", 18, 780), ("邻块正文保持不变", 10, 700)]),
        "application/pdf",
    )
    blocks = client.get(f"/api/external-resumes/{body['id']}/blocks").json()["blocks"]
    target = next(block for block in blocks if "待改" in block["text"])
    edit(client, body["id"], target["block_id"], "改过了")
    text = file_text(client, body["id"])
    assert "邻块正文保持不变" in text
    assert "改过了" in text


def test_revision_chain_and_restore(client):
    original = build_pdf([("原始标题", 18, 780)])
    body = upload(client, "resume.pdf", original, "application/pdf")
    block_id = client.get(f"/api/external-resumes/{body['id']}/blocks").json()["blocks"][0][
        "block_id"
    ]
    edit(client, body["id"], block_id, "改后标题")

    revisions = client.get(f"/api/external-resumes/{body['id']}/revisions")
    assert revisions.status_code == 200
    items = revisions.json()["items"]
    assert [item["source"] for item in items] == ["edit", "upload"]
    assert items[0]["current"] is True and items[1]["current"] is False
    original_revision = items[1]

    restored = client.post(
        f"/api/external-resumes/{body['id']}/revisions/{original_revision['id']}/restore"
    )
    assert restored.status_code == 200, restored.text
    payload = restored.json()
    assert payload["revision"]["source"] == "restore"
    assert payload["revision"]["current"] is True
    assert payload["resume"]["file_id"] == original_revision["file_id"], "恢复要回到那一版的文件"

    # 历史只增不减：三条（edit / upload / restore），不是"把 get 改回去"。
    after = client.get(f"/api/external-resumes/{body['id']}/revisions").json()
    assert after["total"] == 3
    assert "原始标题" in file_text(client, body["id"])


def test_revision_file_endpoint_serves_that_version(client):
    body = upload(client, "resume.pdf", build_pdf([("原始标题", 18, 780)]), "application/pdf")
    block_id = client.get(f"/api/external-resumes/{body['id']}/blocks").json()["blocks"][0][
        "block_id"
    ]
    edit(client, body["id"], block_id, "改后标题")
    items = client.get(f"/api/external-resumes/{body['id']}/revisions").json()["items"]
    upload_revision = next(item for item in items if item["source"] == "upload")
    text = file_text(client, body["id"], revision_id=upload_revision["id"])
    assert "原始标题" in text
    assert "改后标题" not in text


def test_restore_unknown_revision_is_404(client):
    body = upload(client, "resume.txt", "整篇文本".encode(), "text/plain")
    response = client.post(f"/api/external-resumes/{body['id']}/revisions/9999/restore")
    assert response.status_code == 404


def test_identical_text_is_rejected(client):
    body = upload(client, "resume.pdf", build_pdf([("原始标题", 18, 780)]), "application/pdf")
    blocks = client.get(f"/api/external-resumes/{body['id']}/blocks").json()["blocks"]
    response = client.post(
        f"/api/external-resumes/{body['id']}/edit",
        json={"block_id": blocks[0]["block_id"], "text": blocks[0]["text"]},
    )
    assert response.status_code == 422
    assert "没有需要保存的修改" in response.json()["detail"]


def test_scanned_pdf_is_rejected_with_a_reason(client):
    pdf = FPDF(unit="pt", format=(595, 842))
    pdf.add_page()
    pdf.set_fill_color(190, 190, 190)
    pdf.rect(50, 50, 400, 600, style="F")
    body = upload(client, "scan.pdf", bytes(pdf.output()), "application/pdf")
    response = client.get(f"/api/external-resumes/{body['id']}/blocks")
    assert response.status_code == 422
    assert "pdf_no_text_layer" in response.json()["detail"]


def test_txt_edit_replaces_whole_text_and_refreshes_body(client):
    body = upload(client, "note.txt", "第一版正文".encode(), "text/plain")
    blocks = client.get(f"/api/external-resumes/{body['id']}/blocks").json()
    assert blocks["kind"] == "text"
    assert blocks["blocks"][0]["block_id"] == "text"

    result = edit(client, body["id"], "text", "第二版正文，长了一点")
    assert result["resume"]["text"] == "第二版正文，长了一点"
    assert result["resume"]["text_chars"] == len("第二版正文，长了一点")
    fetched = client.get(f"/api/external-resumes/{body['id']}/file")
    assert fetched.content.decode("utf-8") == "第二版正文，长了一点"


def test_docx_edit_keeps_run_formatting(client):
    body = upload(
        client,
        "resume.docx",
        build_docx([("旧的一句话", True), ("第二段保持不动", False)]),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    blocks = client.get(f"/api/external-resumes/{body['id']}/blocks").json()
    assert blocks["kind"] == "docx"
    assert len(blocks["blocks"]) == 2

    result = edit(client, body["id"], "para-0", "新的一句话")
    assert result["resume"]["text_chars"] == len("新的一句话\n第二段保持不动")

    fetched = client.get(f"/api/external-resumes/{body['id']}/file")
    document = Document(io.BytesIO(fetched.content))
    paragraphs = [paragraph for paragraph in document.paragraphs if paragraph.text]
    assert paragraphs[0].text == "新的一句话"
    assert paragraphs[0].runs[0].bold is True, "改字不能把加粗洗掉"
    assert paragraphs[1].text == "第二段保持不动"


def test_unsupported_suffix_is_rejected(client):
    response = client.post(
        "/api/external-resumes",
        files={"file": ("old.doc", b"\xd0\xcf\x11\xe0 legacy", "application/msword")},
    )
    assert response.status_code == 422

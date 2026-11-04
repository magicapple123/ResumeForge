# SPDX-License-Identifier: Apache-2.0
"""面试材料导入（#41，问题 6）：两侧统一接受 图片 / PDF / TXT / Word / Markdown。

三条硬约束钉在这里：

1. **提取在进会话之前**：上传端点当场返回文本与警告，用户在开面试前就能看到结果；
2. **文件里的话要能进提示词**：开面试后 ``generate_question`` 收到的 ``job_text`` /
   ``resume_text`` 必须就是材料正文（而不是空串或关联记录的内容）；
3. **格式与侧别解耦**：``kind`` 只表示"放哪一侧"，同一组扩展名在两侧都能用；
   图片与扫描件 PDF 才需要模型，文本类（pdf 有文字层 / txt / md / docx）永远不需要。
"""

from __future__ import annotations

import base64
import io
import zipfile

import pytest
from app.main import app  # noqa: F401 - 保证路由已装配
from app.services.llm.base import LLMError

# 1x1 的 PNG（67 字节）：``normalize_image_attachment`` 会校验文件头魔数，随便一段字节过不了。
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+"
    "0cSzdAAAAABJRU5ErkJggg=="
)
# 最小的 WebP 容器（RIFF....WEBP）：只为过文件头校验，不会被真的解码。
_WEBP_1X1 = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 16

_JOB_TEXT = "后端开发工程师\n负责服务端接口与稳定性，要求熟悉 Python 与 SQL。"
_RESUME_TEXT = "张三\n3 年后端经验，做过高并发订单系统。"
_MARKDOWN = "# 后端 JD\n\n| 技能 | 要求 |\n| --- | --- |\n| Python | 熟练 |\n"
# PDF 用 ASCII：fpdf2 的内置 Helvetica 编不了中文。正文必须超过
# ``MATERIAL_SCAN_TEXT_THRESHOLD``（200 字），否则会被当成扫描件走视觉兜底。
_LONG_JD = "Backend Engineer JD. " + "Own the service APIs and keep them stable. " * 8

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _pdf_bytes(text: str) -> bytes:
    """用仓库已有的 fpdf2 造一份带文字的 PDF（不联网、不落盘）。"""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.multi_cell(0, 8, text)
    return bytes(pdf.output())


def _docx_bytes(text: str) -> bytes:
    """造一份只含 ``word/document.xml`` 的 .docx（与 ``_docx_text`` 的白名单口径一致）。"""
    escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{escaped}</w:t></w:r></w:p></w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


# 两侧 × {pdf, txt, md, docx, png, webp}：``parser`` 是期望的解析路径（本机提取 / 视觉识别）。
_MATERIAL_FIXTURES: dict[str, tuple[str, bytes, str, str]] = {
    "pdf": ("material.pdf", _pdf_bytes(_LONG_JD), "application/pdf", "text"),
    "txt": ("material.txt", _JOB_TEXT.encode("utf-8"), "text/plain", "text"),
    "md": ("material.md", _MARKDOWN.encode("utf-8"), "text/markdown", "text"),
    "docx": ("material.docx", _docx_bytes("Backend Engineer JD"), _DOCX_MIME, "text"),
    "png": ("material.png", _PNG_1X1, "image/png", "vision"),
    "webp": ("material.webp", _WEBP_1X1, "image/webp", "vision"),
}


def _upload(client, kind: str, name: str, data: bytes, mime: str):
    return client.post(
        "/api/interview/materials",
        data={"kind": kind},
        files={"file": (name, data, mime)},
    )


def _configure(monkeypatch, *, recognize: str | None = None) -> dict[str, object]:
    """把 provider 换成"截图识别固定返回一段文字"的假实现，并记录开场所用的材料。"""

    captured: dict[str, object] = {}

    class _Provider:
        async def chat(self, _messages, *, thinking: bool = True):
            if recognize is None:
                raise LLMError("模型不可用")
            return recognize

    async def ask_capture(db, session, _provider):
        from app.api.interview_shared import _resume_text, _session_job_text

        captured["job_text"] = _session_job_text(db, session)
        captured["resume_text"] = _resume_text(db, session)
        return "第一个问题", "", False

    async def build_report(_provider, _session_):
        return {"score": 80, "dimensions": [{"name": "技术", "score": 80, "comment": "不错"}]}

    monkeypatch.setattr(
        "app.api.interview._require_provider", lambda _db: (_Provider(), "test-model")
    )
    monkeypatch.setattr("app.api.interview._ask_next_question", ask_capture)
    monkeypatch.setattr("app.api.interview.generate_report", build_report)
    return captured


@pytest.mark.parametrize("kind", ["job", "resume"])
@pytest.mark.parametrize("key", sorted(_MATERIAL_FIXTURES))
def test_both_sides_accept_every_supported_type(client, monkeypatch, kind, key):
    """问题 6 的矩阵：同一组格式在两侧都能导入，文件名与正文原样带回。"""
    _configure(monkeypatch, recognize=_RESUME_TEXT)
    name, data, mime, parser = _MATERIAL_FIXTURES[key]
    created = _upload(client, kind, name, data, mime)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == name
    assert body["text"].strip()
    # "从截图识别出 N 字"这句话只能按实际解析路径说，不能按左右侧说。
    assert body["parser"] == parser


def test_txt_material_is_extracted(client, monkeypatch):
    _configure(monkeypatch, recognize=_RESUME_TEXT)
    body = _upload(client, "job", "jd.txt", _JOB_TEXT.encode("utf-8"), "text/plain").json()
    assert "服务端接口" in body["text"]
    assert body["warnings"] == []


def test_markdown_keeps_its_markers(client):
    """Markdown 的标题与表格原样保留：本机提取不做渲染，JD 常常就是 md 原文。"""
    created = _upload(client, "job", "jd.md", _MARKDOWN.encode("utf-8"), "text/markdown")
    assert created.status_code == 200, created.text
    text = created.json()["text"]
    assert "# 后端 JD" in text
    assert "| Python | 熟练 |" in text


def test_word_document_is_read_through_the_whitelist(client):
    created = _upload(client, "resume", "resume.docx", _docx_bytes("Alex 3 years"), _DOCX_MIME)
    assert created.status_code == 200, created.text
    assert "Alex 3 years" in created.json()["text"]


def test_empty_word_is_reported(client):
    """空 Word：明说"这份 Word 里没有可提取的文字"，不返回一段空正文。"""
    created = _upload(client, "job", "empty.docx", _docx_bytes("   "), _DOCX_MIME)
    assert created.status_code == 422
    assert "Word" in created.json()["detail"]


def test_legacy_doc_is_rejected_with_a_rename_hint(client):
    """Word 2003 的 .doc 读不了就不假装能读：文案要指向 .docx。"""
    rejected = _upload(client, "job", "old.doc", b"\xd0\xcf\x11\xe0", "application/msword")
    assert rejected.status_code == 422
    assert ".docx" in rejected.json()["detail"]


def test_unsupported_format_is_rejected_without_naming_a_side(client):
    """类型不再按侧别区分，错误文案也不能再写死"岗位材料 / 简历截图"。"""
    rejected = _upload(client, "resume", "sheet.xlsx", b"PK\x03\x04", "application/vnd.ms-excel")
    assert rejected.status_code == 422
    detail = rejected.json()["detail"]
    assert "PDF" in detail and "Markdown" in detail
    assert "岗位材料" not in detail and "简历截图" not in detail


def test_job_material_rejects_oversized_file(client):
    oversized = b"a" * (10 * 1024 * 1024 + 1)
    rejected = _upload(client, "job", "jd.txt", oversized, "text/plain")
    assert rejected.status_code == 413


def test_image_is_recognized(client, monkeypatch):
    _configure(monkeypatch, recognize=_RESUME_TEXT)
    created = _upload(client, "resume", "resume.png", _PNG_1X1, "image/png")
    assert created.status_code == 200, created.text
    assert "高并发订单系统" in created.json()["text"]


def test_image_without_text_tells_user_what_to_do(client, monkeypatch):
    """识别不出文字时不能装作成功：要说清"换一张更清晰的截图"。"""
    _configure(monkeypatch, recognize="NO_TEXT")
    rejected = _upload(client, "resume", "blur.png", _PNG_1X1, "image/png")
    assert rejected.status_code == 422
    assert "换更清晰的截图" in rejected.json()["detail"]


@pytest.mark.parametrize("kind", ["job", "resume"])
def test_image_upload_requires_model_configuration(client, kind):
    """没配模型时图片走不通（两侧一致）：前因是"还没配置模型"，不是一个坏文件。"""
    rejected = _upload(client, kind, "shot.png", _PNG_1X1, "image/png")
    assert rejected.status_code == 400


def test_text_pdf_needs_no_model_configuration(client):
    """有文字层的 PDF **不因为扫描兜底而要求配置模型**（放宽类型没把纯文本路径拖下水）。"""
    created = _upload(client, "job", "jd.pdf", _pdf_bytes(_LONG_JD), "application/pdf")
    assert created.status_code == 200, created.text
    body = created.json()
    assert "Backend Engineer JD" in body["text"]
    assert body["parser"] == "text"


def test_scanned_pdf_falls_back_to_vision(client, monkeypatch):
    """扫描件 PDF（没有文字层）：渲染页面走视觉识别，并明确告知"已按图片识别"。"""
    _configure(monkeypatch, recognize="扫描页里的一行字")
    created = _upload(client, "resume", "scan.pdf", _pdf_bytes(""), "application/pdf")
    assert created.status_code == 200, created.text
    body = created.json()
    assert "扫描页里的一行字" in body["text"]
    assert body["parser"] == "vision"
    assert any("按图片识别" in warning for warning in body["warnings"])


def test_scanned_pdf_without_model_is_reported_as_a_model_problem(client):
    """扫描件要模型：没配置时给的是"去配置"这个前因，而不是"文件坏了"。"""
    rejected = _upload(client, "job", "scan.pdf", _pdf_bytes(""), "application/pdf")
    assert rejected.status_code == 400


def test_interview_started_from_materials_feeds_the_prompt(client, monkeypatch):
    """两侧都用导入材料开场：文件名要落库，正文要真的进到提问提示词里。"""
    captured = _configure(monkeypatch, recognize=None)
    created = client.post(
        "/api/interview",
        json={
            "job_material": {"name": "jd.txt", "text": _JOB_TEXT},
            "resume_material": {"name": "shot.png", "text": _RESUME_TEXT},
            "interview_type": "技术面",
            "rounds": 3,
        },
    )
    assert created.status_code == 201, created.text
    session = created.json()
    # 列表/详情都要显示"用的哪个文件"。
    assert session["job_material_name"] == "jd.txt"
    assert session["resume_material_name"] == "shot.png"
    assert session["job_id"] is None and session["resume_id"] is None

    # 提问内容引用的就是文件里的信息（材料进了提示词，而不是被忽略）。
    assert "服务端接口" in str(captured["job_text"])
    assert "高并发订单系统" in str(captured["resume_text"])

    listed = client.get("/api/interview").json()
    assert listed[0]["job_material_name"] == "jd.txt"
    detail = client.get(f"/api/interview/{session['id']}").json()
    assert detail["resume_material_name"] == "shot.png"


def test_material_can_be_mixed_with_a_record(client, db_session, monkeypatch):
    """一条记录 + 一份导入材料也可以：二选一是"每侧各有一个来源"，不是两侧都必须同源。"""
    from tests.interview_target_support import targets

    _configure(monkeypatch, recognize=None)
    identifiers = targets(db_session)
    created = client.post(
        "/api/interview",
        json={
            "job_id": identifiers["job_id"],
            "resume_material": {"name": "shot.png", "text": _RESUME_TEXT},
            "rounds": 3,
        },
    )
    assert created.status_code == 201, created.text
    session = created.json()
    assert session["job_id"] == identifiers["job_id"]
    assert session["resume_material_name"] == "shot.png"


def test_missing_material_on_one_side_is_rejected(client, monkeypatch):
    """两侧都必须有来源：只给岗位材料时不能开出一场"没有简历"的面试。"""
    _configure(monkeypatch, recognize=None)
    rejected = client.post(
        "/api/interview",
        json={"job_material": {"name": "jd.txt", "text": _JOB_TEXT}, "rounds": 3},
    )
    assert rejected.status_code == 422
    assert "简历材料" in rejected.json()["detail"]


@pytest.mark.parametrize("text", ["   ", ""])
def test_blank_material_text_is_rejected(client, text):
    rejected = client.post(
        "/api/interview",
        json={"job_material": {"name": "jd.txt", "text": text}, "rounds": 3},
    )
    assert rejected.status_code == 422


def test_empty_file_is_rejected(client):
    rejected = _upload(client, "job", "jd.txt", b"", "text/plain")
    assert rejected.status_code == 422


def test_txt_and_image_share_the_same_length_cap(client, monkeypatch):
    """同一份 3 万字内容存成 .txt 与 .png，导入后字数**相同**（上限已拉平）。"""
    long_text = "岗位要求 " * 8000  # 约 4 万字，超过任何一侧的上限
    _configure(monkeypatch, recognize=long_text)
    from_txt = _upload(client, "job", "jd.txt", long_text.encode("utf-8"), "text/plain").json()
    from_png = _upload(client, "resume", "jd.png", _PNG_1X1, "image/png").json()
    assert len(from_txt["text"]) == len(from_png["text"])
    assert any("只读取了前一部分" in warning for warning in from_png["warnings"])


def test_extracted_len_is_bounded():
    """材料正文上限只有一个值：schema 那道闸与提取端的截断不能各自漂。"""
    from app.schemas.interview_material import MAX_MATERIAL_TEXT_CHARS
    from app.services.document_text import MAX_DOCUMENT_TEXT_CHARS

    assert MAX_MATERIAL_TEXT_CHARS == MAX_DOCUMENT_TEXT_CHARS
    assert MAX_MATERIAL_TEXT_CHARS >= 10_000

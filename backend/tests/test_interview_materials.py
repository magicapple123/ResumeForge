# SPDX-License-Identifier: Apache-2.0
"""面试材料导入（#41）：岗位侧 PDF / TXT、简历侧截图，都要能真的进到提示词里。

三条硬约束钉在这里：

1. **提取在进会话之前**：上传端点当场返回文本与警告，用户在开面试前就能看到结果；
2. **文件里的话要能进提示词**：开面试后 ``generate_question`` 收到的 ``job_text`` /
   ``resume_text`` 必须就是材料正文（而不是空串或关联记录的内容）；
3. **识别失败要说得明白**：截图没识别出文字时给的是"换一张更清晰的截图"这个动作前提，
   而不是让用户拿到一句"请求失败"。
"""

from __future__ import annotations

import base64

import pytest
from app.main import app  # noqa: F401 - 保证路由已装配
from app.services.llm.base import LLMError

# 1x1 的 PNG（67 字节）：``normalize_image_attachment`` 会校验文件头魔数，随便一段字节过不了。
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+"
    "0cSzdAAAAABJRU5ErkJggg=="
)

_JOB_TEXT = "后端开发工程师\n负责服务端接口与稳定性，要求熟悉 Python 与 SQL。"
_RESUME_TEXT = "张三\n3 年后端经验，做过高并发订单系统。"


def _pdf_bytes(text: str) -> bytes:
    """用仓库已有的 fpdf2 造一份带文字的 PDF（不联网、不落盘）。"""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.multi_cell(0, 8, text)
    return bytes(pdf.output())


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


def test_txt_job_material_is_extracted(client):
    """岗位侧 TXT：直接读出文字，文件名原样带回。"""
    created = _upload(client, "job", "jd.txt", _JOB_TEXT.encode("utf-8"), "text/plain")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == "jd.txt"
    assert "服务端接口" in body["text"]
    assert body["warnings"] == []


def test_pdf_job_material_is_extracted(client):
    """岗位侧 PDF：走 pypdf 抽文字（JD 多数是 PDF）。"""
    created = _upload(client, "job", "jd.pdf", _pdf_bytes("Backend Engineer JD"), "application/pdf")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == "jd.pdf"
    assert "Backend Engineer JD" in body["text"]


def test_job_material_rejects_unsupported_format(client):
    """岗位材料只收 PDF / TXT：docx 要给一句能照做的原因，而不是静默接受。"""
    rejected = _upload(client, "job", "jd.docx", b"PK\x03\x04", "application/vnd.ms-word")
    assert rejected.status_code == 422
    assert "PDF" in rejected.json()["detail"]


def test_job_material_rejects_oversized_file(client):
    oversized = b"a" * (10 * 1024 * 1024 + 1)
    rejected = _upload(client, "job", "jd.txt", oversized, "text/plain")
    assert rejected.status_code == 413


def test_resume_image_is_recognized(client, monkeypatch):
    """简历侧截图：交给视觉模型逐字识别，结果直接当材料正文。"""
    _configure(monkeypatch, recognize=_RESUME_TEXT)
    created = _upload(client, "resume", "resume.png", _PNG_1X1, "image/png")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["name"] == "resume.png"
    assert "高并发订单系统" in body["text"]


def test_resume_image_without_text_tells_user_what_to_do(client, monkeypatch):
    """识别不出文字时不能装作成功：要说清"换一张更清晰的截图"。"""
    _configure(monkeypatch, recognize="NO_TEXT")
    rejected = _upload(client, "resume", "blur.png", _PNG_1X1, "image/png")
    assert rejected.status_code == 422
    assert "换更清晰的截图" in rejected.json()["detail"]


def test_resume_material_rejects_non_image(client, monkeypatch):
    _configure(monkeypatch, recognize=_RESUME_TEXT)
    rejected = _upload(client, "resume", "resume.pdf", b"%PDF-1.4", "application/pdf")
    assert rejected.status_code == 422


def test_image_upload_requires_model_configuration(client):
    """没配模型时截图这条路走不通：前因是"还没配置模型"，不是一个坏文件。"""
    rejected = _upload(client, "resume", "resume.png", _PNG_1X1, "image/png")
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


def test_pdf_without_text_layer_is_reported(client):
    """扫描件 PDF 提不出文字：明说"可能是扫描件"，不要让用户对着空材料开面试。"""
    empty_pdf = _pdf_bytes("")
    rejected = _upload(client, "job", "scan.pdf", empty_pdf, "application/pdf")
    # 空 PDF 也可能连文字层都没有；两种情况都该是 422 + 一句原因。
    assert rejected.status_code == 422
    assert rejected.json()["detail"]


def test_extracted_len_is_bounded():
    """材料正文上限与 schema 一致：前端不会因为"文件太大"在开场时被 422 打回。"""
    from app.schemas.interview import MAX_MATERIAL_TEXT_CHARS

    assert MAX_MATERIAL_TEXT_CHARS >= 10_000

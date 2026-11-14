# SPDX-License-Identifier: Apache-2.0
"""题库材料的快照口径：只带文本与文件名，不把内部记录 id 造进去或漏出去。

同时钉住长度边界（正好等于上限要收、超过要拒）与优先级（显式粘贴的岗位文本优先、
内部简历仍走文档正文），避免"同一份材料在两个入口给出两种内容"。
"""

import pytest
from app.api import interview as interview_api
from app.api import interview_question_routes
from app.models.job import Job
from app.models.resume import ResumeRecord


@pytest.fixture
def bank_context(monkeypatch):
    captured = {}
    monkeypatch.setattr(interview_api, "_require_provider", lambda _db: (object(), "test"))

    async def generate(_provider, **kwargs):
        captured.update(kwargs)
        return {"groups": [], "notes": []}

    monkeypatch.setattr(
        interview_question_routes.interview_questions_service, "generate_question_bank", generate
    )
    return captured


@pytest.mark.parametrize("field", ["job_text", "resume_text"])
def test_text_only_target_is_accepted(client, bank_context, field):
    response = client.post("/api/interview/questions", json={field: "material body"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_id"] is None
    assert body["resume_id"] is None
    assert bank_context["job_text" if field == "job_text" else "resume_json"] == "material body"


def test_external_text_preserves_filename_and_has_no_internal_id(client, bank_context):
    response = client.post(
        "/api/interview/questions",
        json={"resume_text": "external resume", "resume_title": "candidate.docx"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["resume_title"] == "candidate.docx"
    assert response.json()["resume_id"] is None
    assert bank_context["resume_json"] == "external resume"


@pytest.mark.parametrize("field,limit", [("job_text", 20000), ("resume_text", 50000)])
def test_text_at_the_schema_limit_is_accepted(client, bank_context, field, limit):
    response = client.post("/api/interview/questions", json={field: "X" * limit})
    assert response.status_code == 200, response.text
    context_field = "job_text" if field == "job_text" else "resume_json"
    assert len(bank_context[context_field]) == (6000 if field == "job_text" else limit)


def test_explicit_job_text_wins_and_truncation_is_explained(client, db_session, bank_context):
    job = Job(title="Database job", company="Example", description="stored job")
    db_session.add(job)
    db_session.commit()
    response = client.post(
        "/api/interview/questions", json={"job_id": job.id, "job_text": "J" * 7000}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert bank_context["job_text"] == "J" * 6000
    assert body["job_id"] is None
    assert body["job_title"] == "临时岗位"
    assert len(body["notes"]) == 1 and "6000" in body["notes"][0]


def test_internal_resume_keeps_document_precedence(client, db_session, bank_context):
    record = ResumeRecord(title="Internal snapshot", content={"name": "Alice"})
    db_session.add(record)
    db_session.commit()
    response = client.post(
        "/api/interview/questions",
        json={"resume_id": record.id, "resume_text": "ignored", "resume_title": "ignored.txt"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["resume_title"] == "Internal snapshot"
    assert response.json()["resume_id"] == record.id
    assert "Alice" in bank_context["resume_json"]
    assert "ignored" not in bank_context["resume_json"]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"job_text": " ", "resume_text": "\n\t"},
        {"job_text": "J" * 20001},
        {"resume_text": "R" * 50001},
        {"resume_text": "valid", "warnings": []},
    ],
)
def test_empty_oversized_and_read_dto_fields_are_rejected(client, payload):
    response = client.post("/api/interview/questions", json=payload)
    assert response.status_code == 422, response.text

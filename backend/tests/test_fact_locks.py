# SPDX-License-Identifier: Apache-2.0
"""W12 事实锁：服务端硬校验（不是提示词约束）+ AI 迟到不覆盖。

覆盖：
- 锁的增删查（API）；
- AI 修订改了锁定值 → 409 + fact_lock_conflict + violations，库内一个字节不动；
- AI 只改表达、不动锁定值 → 正常保存；
- AI 迟到（base_revision 过期）→ 409 版本冲突，正文与锁都不被改；
- 锁按 object_id 跟住排序（W01 身份）而不是按旧下标；
- 锁定对象被删 → 同样拒绝（"对象已不存在"）。
"""

from __future__ import annotations

import json

from app.schemas.setting import LLMConfig
from app.services.resume import fact_locks


def _content(company: str = "示例科技有限公司", description: str = "负责合成数据接口") -> dict:
    return {
        "name": "张示例",
        "summary": "一段总结",
        "experience": [
            {
                "id": "expobj0001",
                "company": company,
                "role": "后端实习生",
                "description": [description],
            }
        ],
    }


def _create_resume(client, content: dict | None = None) -> int:
    response = client.post(
        "/api/resumes/manual", json={"title": "事实锁测试", "content": content or _content()}
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _lock(client, resume_id: int, **body) -> dict:
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "institution", "label": "公司", **body},
    )
    assert response.status_code == 201, response.text
    return response.json()


class FakeProvider:
    def __init__(self, payload: dict, usage=None) -> None:
        self._payload = payload
        self.last_usage = usage

    async def chat(self, messages, *, thinking: bool = True):
        return json.dumps(self._payload, ensure_ascii=False)


def _install_provider(monkeypatch, payload: dict) -> FakeProvider:
    provider = FakeProvider(payload)

    def _get_config(db):  # noqa: ANN001 - 与既有 patch 契约一致
        return LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        )

    monkeypatch.setattr("app.api.resumes.get_llm_config", _get_config)
    monkeypatch.setattr("app.api.resumes.create_provider", lambda config: provider)
    return provider


def _resume_record(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_lock_crud_and_unknown_path(client):
    resume_id = _create_resume(client)

    lock = _lock(client, resume_id, path="experience.0.company")
    assert lock["kind"] == "institution"
    assert lock["locked_value"] == "示例科技有限公司"
    assert lock["path"] == "experience.0.company"

    listed = client.get(f"/api/provenance/resumes/{resume_id}/fact-locks").json()
    assert [item["id"] for item in listed["locks"]] == [lock["id"]]

    assert (
        client.delete(f"/api/provenance/resumes/{resume_id}/fact-locks/{lock['id']}").status_code
        == 204
    )
    assert client.get(f"/api/provenance/resumes/{resume_id}/fact-locks").json()["locks"] == []

    missing = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "name", "path": "summary.absent"},
    )
    assert missing.status_code == 400
    assert client.delete(f"/api/provenance/resumes/{resume_id}/fact-locks/9999").status_code == 404


def test_ai_revision_that_changes_a_locked_value_is_rejected(client, monkeypatch):
    resume_id = _create_resume(client)
    _lock(client, resume_id, path="experience.0.company")
    before = _resume_record(client, resume_id)
    _install_provider(
        monkeypatch,
        {
            "summary": "改过的总结",
            "experience": [
                {
                    "company": "另一家公司",
                    "role": "后端实习生",
                    "description": ["负责合成数据接口"],
                }
            ],
        },
    )

    response = client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "把表达改得更精炼", "base_revision": before["revision"]},
    )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "fact_lock_conflict"
    violation = body["violations"][0]
    assert violation["kind"] == "institution"
    assert violation["locked_value"] == "示例科技有限公司"
    assert violation["current_value"] == "另一家公司"
    # 被拒绝 = 一个字段都没写：正文、revision 不变。
    after = _resume_record(client, resume_id)
    assert after["content"]["experience"][0]["company"] == "示例科技有限公司"
    assert after["revision"] == before["revision"]


def test_ai_revision_that_only_changes_wording_is_allowed(client, monkeypatch):
    resume_id = _create_resume(client)
    lock = _lock(client, resume_id, path="experience.0.company")
    before = _resume_record(client, resume_id)
    _install_provider(
        monkeypatch,
        {
            "summary": "改过的总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "后端实习生",
                    "description": ["主导合成数据接口的设计与实现"],
                }
            ],
        },
    )

    response = client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "突出方法", "base_revision": before["revision"]},
    )

    assert response.status_code == 200, response.text
    after = response.json()
    assert after["content"]["experience"][0]["company"] == "示例科技有限公司"
    assert after["content"]["experience"][0]["description"] == ["主导合成数据接口的设计与实现"]
    locks = client.get(f"/api/provenance/resumes/{resume_id}/fact-locks").json()["locks"]
    assert [item["id"] for item in locks] == [lock["id"]]


def test_ai_late_return_does_not_overwrite_or_clear_locks(client, monkeypatch):
    resume_id = _create_resume(client)
    _lock(client, resume_id, path="experience.0.company")
    before = _resume_record(client, resume_id)
    # 模型返回期间，用户/另一个窗口保存了新版本（正文变了，revision 前进）。
    saved = client.put(
        f"/api/resumes/{resume_id}/content",
        json={
            "content": _content(description="用户刚写的新描述"),
            "expected_revision": before["revision"],
        },
    )
    assert saved.status_code == 200, saved.text

    _install_provider(
        monkeypatch,
        {
            "summary": "迟到的总结",
            "experience": [
                {"company": "示例科技有限公司", "role": "后端实习生", "description": ["迟到内容"]}
            ],
        },
    )
    response = client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "精炼", "base_revision": before["revision"]},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "resume_revision_conflict"
    after = _resume_record(client, resume_id)
    assert after["content"]["experience"][0]["description"] == ["用户刚写的新描述"]
    assert after["revision"] == before["revision"] + 1
    assert client.get(f"/api/provenance/resumes/{resume_id}/fact-locks").json()["locks"]


def test_object_id_lock_follows_reordering(client, db_session):
    resume_id = _create_resume(client)
    lock = _lock(client, resume_id, path="experience.0.company", object_id="expobj0001")

    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    reordered = dict(record.content)
    reordered["experience"] = [
        {"id": "otheroo001", "company": "另一家公司", "role": "产品", "description": []},
        record.content["experience"][0],
    ]
    assert fact_locks.validate_fact_locks(db_session, record, reordered) == []

    changed = dict(record.content)
    changed["experience"] = [{"id": "expobj0001", "company": "另一家公司", "role": "后端"}]
    violations = fact_locks.validate_fact_locks(db_session, record, changed)
    assert len(violations) == 1
    assert violations[0].lock_id == lock["id"]
    assert violations[0].current_value == "另一家公司"


def test_missing_locked_object_is_a_violation(client, db_session):
    resume_id = _create_resume(client)
    _lock(client, resume_id, path="experience.0.company", object_id="expobj0001")

    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    without_entry = {**record.content, "experience": []}

    violations = fact_locks.validate_fact_locks(db_session, record, without_entry)
    assert len(violations) == 1
    assert violations[0].reason == "锁定对象在本次修改后已不存在"


def test_name_lock_rejects_renamed_candidate(client, db_session):
    resume_id = _create_resume(client)
    _lock(client, resume_id, path="name", kind="name", label="姓名")

    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    content = dict(record.content)
    content["name"] = "李示例"
    violations = fact_locks.validate_fact_locks(db_session, record, content)
    assert len(violations) == 1
    assert violations[0].kind == "name"
    assert violations[0].locked_value == "张示例"


# ===== W14 科研字段：事实锁字段识别 + 校验覆盖 =====


def _research_content(status: str = "published", *, is_self: bool = True) -> dict:
    return {
        "name": "张示例",
        "summary": "一段总结",
        "publications": [
            {
                "title": "合成数据接口可复现性研究",
                "status": status,
                "doi": "10.1234/synthetic.2024.001",
                "year": "2024",
                "authors": [{"name": "张示例", "is_self": is_self, "corresponding": True}],
            }
        ],
        "patents": [
            {"title": "一种合成数据生成方法", "status": "filed", "patent_number": "CN-2024-0001"}
        ],
    }


def test_infer_fact_lock_kind_covers_research_fields():
    assert fact_locks.infer_fact_lock_kind("publications.0.status") == "status"
    assert fact_locks.infer_fact_lock_kind("patents.1.status") == "status"
    assert fact_locks.infer_fact_lock_kind("publications.0.doi") == "identifier"
    assert fact_locks.infer_fact_lock_kind("patents.0.patent_number") == "identifier"
    assert fact_locks.infer_fact_lock_kind("publications.0.year") == "time"
    assert fact_locks.infer_fact_lock_kind("publications.0.authors.0.is_self") == "authorship"
    assert fact_locks.infer_fact_lock_kind("publications.0.authors.0.corresponding") == "authorship"
    # 识别不到时保持既有兜底（研究栏目→identifier，其余→number）。
    assert fact_locks.infer_fact_lock_kind("publications.0.some_new_field") == "identifier"
    assert fact_locks.infer_fact_lock_kind("summary") == "number"


def test_lock_without_kind_infers_research_field_kind(client):
    resume_id = _create_resume(client, _research_content())
    response = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"path": "publications.0.doi", "label": "DOI"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["kind"] == "identifier"

    status_lock = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"path": "publications.0.status", "label": "发表状态"},
    )
    assert status_lock.status_code == 201
    assert status_lock.json()["kind"] == "status"


def test_research_status_change_is_rejected_by_lock(client, db_session):
    from app.models.resume import ResumeRecord

    resume_id = _create_resume(client, _research_content())
    client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"path": "publications.0.status", "label": "发表状态"},
    )
    record = db_session.get(ResumeRecord, resume_id)
    assert record is not None

    violations = fact_locks.validate_fact_locks(
        db_session, record, _research_content(status="retracted")
    )

    assert any(item.path == "publications.0.status" for item in violations)


def test_author_order_year_and_patent_number_locks_are_enforced(client, db_session):
    from app.models.resume import ResumeRecord

    resume_id = _create_resume(client, _research_content())
    for path in (
        "publications.0.authors.0.is_self",
        "publications.0.year",
        "patents.0.patent_number",
    ):
        response = client.post(
            f"/api/provenance/resumes/{resume_id}/fact-locks",
            json={"path": path, "label": path},
        )
        assert response.status_code == 201, response.text
    record = db_session.get(ResumeRecord, resume_id)
    changed = _research_content(is_self=False)
    changed["publications"][0]["year"] = "2023"
    changed["patents"][0]["patent_number"] = "CN-9999-9999"

    violations = fact_locks.validate_fact_locks(db_session, record, changed)

    paths = {item.path for item in violations}
    assert {
        "publications.0.authors.0.is_self",
        "publications.0.year",
        "patents.0.patent_number",
    } <= paths

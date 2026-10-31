# SPDX-License-Identifier: Apache-2.0
"""W06 lock_content：锁定条目正文只读（AI/采纳类写入），排版/隐藏仍可调。

锁是条目里的 ``lock_content`` 布尔字段（没有独立锁表）。服务端硬校验在
``fact_locks.enforce_ai_content``（AI 修订/翻译/采纳同一入口）：正文变了或被删 → 409
``fact_lock_conflict`` + violations（kind="lock_content"，lock_id=0）；用户手写保存不拦。
"""

from __future__ import annotations

import json

from app.schemas.setting import LLMConfig
from app.services.resume import fact_locks
from tests.document_test_support import body_texts, entries_of, field_value, section_of


def _locked_content(*, lock_content: bool = True) -> dict:
    return {
        "name": "张示例",
        "summary": "一段总结",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["负责合成数据接口"],
                "point_ids": {"description": ["pnt0000001"]},
                "lock_content": lock_content,
            }
        ],
        "education": [{"id": "eduobj0001", "school": "示例大学"}],
    }


def _create_resume(client, content: dict | None = None) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "正文锁测试", "content": content or _locked_content()},
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _resume(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


class FakeProvider:
    def __init__(self, payload: dict, usage=None) -> None:
        self._payload = payload
        self.last_usage = usage

    async def chat(self, messages, *, thinking: bool = True):
        return json.dumps(self._payload, ensure_ascii=False)


def _install_provider(monkeypatch, payload: dict) -> None:
    provider = FakeProvider(payload)

    def _get_config(db):  # noqa: ANN001 - 与既有 patch 契约一致
        return LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        )

    monkeypatch.setattr("app.api.resumes.get_llm_config", _get_config)
    monkeypatch.setattr("app.api.resumes.create_provider", lambda config: provider)


def _revise(client, resume_id: int, payload: dict, monkeypatch) -> object:
    before = _resume(client, resume_id)
    _install_provider(monkeypatch, payload)
    return client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "改写表达", "base_revision": before["revision"]},
    )


def test_ai_revision_changing_locked_entry_is_rejected(client, monkeypatch):
    resume_id = _create_resume(client)
    before = _resume(client, resume_id)

    response = _revise(
        client,
        resume_id,
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
        monkeypatch,
    )

    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "fact_lock_conflict"
    violation = body["violations"][0]
    assert violation["kind"] == "lock_content"
    assert violation["lock_id"] == 0
    assert violation["reason"] == "锁定条目正文被改动"
    assert violation["path"] == "experience.0"
    after = _resume(client, resume_id)
    assert body_texts(after["content"], "experience") == ["负责合成数据接口"]
    assert after["revision"] == before["revision"]


def test_ai_revision_only_toggling_layout_or_hidden_is_allowed(client, monkeypatch):
    resume_id = _create_resume(client)

    response = _revise(
        client,
        resume_id,
        {
            "summary": "一段总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "后端实习生",
                    "description": ["负责合成数据接口"],
                    "hidden": True,
                    "lock_layout": True,
                }
            ],
        },
        monkeypatch,
    )

    assert response.status_code == 200, response.text
    after = response.json()
    # 正文一个字节没变（隐藏/排版标记不算正文）；锁标记由服务端带回，不依赖模型回显。
    assert body_texts(after["content"], "experience") == ["负责合成数据接口"]
    assert entries_of(after["content"], "experience")[0]["lock_content"] is True


def test_ai_revision_deleting_locked_entry_is_rejected(client, monkeypatch):
    resume_id = _create_resume(client)

    response = _revise(client, resume_id, {"summary": "只改总结", "experience": []}, monkeypatch)

    assert response.status_code == 409, response.text
    violation = response.json()["violations"][0]
    assert violation["kind"] == "lock_content"
    assert violation["reason"] == "锁定条目在本次修改后已不存在"


def test_user_save_is_not_blocked_but_adopt_is(client):
    resume_id = _create_resume(client)
    record = _resume(client, resume_id)
    changed = _locked_content()
    changed["experience"][0]["description"] = ["用户自己手写的新描述"]
    saved = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": changed, "expected_revision": record["revision"]},
    )
    # 锁的是 AI/采纳类写入，不拦用户的手。
    assert saved.status_code == 200, saved.text
    assert body_texts(saved.json()["content"], "experience") == ["用户自己手写的新描述"]

    text = "来源里的新表述"
    source = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": {
                "kind": "claim",
                "external_ref": "claim_record:77",
                "title": "示例主张",
                "payload": text,
            },
            "object_id": "expobj0001",
            "point_id": "pnt0000001",
        },
    )
    assert source.status_code == 201, source.text
    link = source.json()
    adopted = client.post(
        f"/api/provenance/links/{link['link_id']}/adopt",
        json={"text": text, "expected_revision": saved.json()["revision"]},
    )
    assert adopted.status_code == 409, adopted.text
    body = adopted.json()
    assert body["code"] == "fact_lock_conflict"
    assert body["violations"][0]["kind"] == "lock_content"
    assert body_texts(_resume(client, resume_id)["content"], "experience") == [
        "用户自己手写的新描述"
    ]


def test_adopt_still_respects_fact_locks_on_locked_field(client):
    resume_id = _create_resume(client, _locked_content(lock_content=False))
    lock = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "institution", "path": "experience.0.company", "label": "公司"},
    )
    assert lock.status_code == 201, lock.text
    text = "另一家公司"
    source = client.post(
        f"/api/provenance/resumes/{resume_id}/links",
        json={
            "source": {
                "kind": "claim",
                "external_ref": "claim_record:88",
                "title": "来源主张",
                "payload": text,
            },
            "object_id": "expobj0001",
        },
    ).json()
    adopted = client.post(
        f"/api/provenance/links/{source['link_id']}/adopt",
        json={"text": text, "path": "experience.0.company"},
    )
    assert adopted.status_code == 409, adopted.text
    violation = adopted.json()["violations"][0]
    assert violation["kind"] == "institution"
    assert violation["locked_value"] == "示例科技有限公司"
    assert (
        field_value(_resume(client, resume_id)["content"], "company", section="experience")
        == "示例科技有限公司"
    )


def test_validate_content_locks_follows_object_id_and_ignores_meta(client, db_session):
    resume_id = _create_resume(client)
    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    original = record.content
    import copy

    # 1) 原样/只改排版标记：不违规（从库里读回的原样内容复制，避免存储归一化造成假差异）。
    same = copy.deepcopy(original)
    assert fact_locks.validate_content_locks(record, same) == []
    meta_only = copy.deepcopy(original)
    entries_of(meta_only, "experience")[0]["hidden"] = True
    assert fact_locks.validate_content_locks(record, meta_only) == []
    # 2) 正文变了：违规（v2：改 experience 条目里的 TextItem 文本）。
    changed = copy.deepcopy(original)
    for item in entries_of(changed, "experience")[0]["items"]:
        if item.get("kind") == "text":
            item["text"] = "新描述"
            break
    violations = fact_locks.validate_content_locks(record, changed)
    assert len(violations) == 1
    assert violations[0].path == "experience.0"
    # 3) 条目按 object_id 跟住排序：换到下标的锁条目没改正文 → 不违规。
    reordered = copy.deepcopy(original)
    experience_section = section_of(reordered, "experience")
    locked_entry = copy.deepcopy(experience_section["entries"][0])
    experience_section["entries"] = [
        {
            "id": "other0001",
            "items": [
                {"kind": "field", "key": "company", "value": "另一家公司", "placement": "title"}
            ],
        },
        locked_entry,
    ]
    assert fact_locks.validate_content_locks(record, reordered) == []
    # 4) 同一对象在新下标上被改正文：报告新路径（v2：改该条目里的 TextItem 文本）。
    reordered_changed = copy.deepcopy(reordered)
    second_entry = entries_of(reordered_changed, "experience")[1]
    for item in second_entry["items"]:
        if item.get("kind") == "text":
            item["text"] = "换位置后改了正文"
            break
    violations = fact_locks.validate_content_locks(record, reordered_changed)
    assert [item.path for item in violations] == ["experience.1"]

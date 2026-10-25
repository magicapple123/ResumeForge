# SPDX-License-Identifier: Apache-2.0
"""W16 语言变体：翻译候选不落库、术语锁定、事实锁、逐项采纳、独立排版、隔离。"""

from __future__ import annotations

import json

from app.schemas.setting import LLMConfig


def _content() -> dict:
    return {
        "name": "张示例",
        "summary": "在示例科技有限公司负责合成数据接口",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["负责合成数据接口"],
                "point_ids": {"description": ["pnt0000001"]},
            }
        ],
    }


def _create_resume(client) -> int:
    response = client.post("/api/resumes/manual", json={"title": "双语测试", "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _create_variant(client, resume_id: int, *, language: str = "") -> dict:
    response = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "英文变体", "language": language, "variant_group_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()


class FakeProvider:
    def __init__(self, translated: str) -> None:
        self.translated = translated
        self.last_usage = None

    async def chat(self, messages, *, thinking: bool = True):
        return json.dumps({"result": self.translated}, ensure_ascii=False)


def _install(monkeypatch, translated: str) -> None:
    monkeypatch.setattr(
        "app.api.resumes.get_llm_config",
        lambda db: LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        ),
    )
    monkeypatch.setattr("app.api.resumes.create_provider", lambda config: FakeProvider(translated))


def test_variant_carries_language_and_independent_layout(client):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id, language="en-US")
    assert variant["language"] == "en-US"
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["render_context"]["page_limit"] >= 1
    patched = client.patch(
        f"/api/resumes/{resume_id}/variants/{variant['id']}",
        json={"language": "zh-CN"},
    )
    assert patched.status_code == 200 and patched.json()["language"] == "zh-CN"


def test_translate_returns_candidate_without_writing(client, monkeypatch):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    _install(monkeypatch, "Engineer at Example Tech")

    response = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["candidate"]["summary"] == "Engineer at Example Tech"
    assert body["diff"]["stats"]["added"] > 0
    # 候选只在响应里：变体内容没变（取消 = 不采纳，不改正文）。
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["content"]["summary"] == _content()["summary"]


def test_locked_glossary_term_blocks_field(client, monkeypatch):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    client.post(
        "/api/glossary-terms",
        json={
            "source_term": "示例科技有限公司",
            "target_term": "Example Tech",
            "language_from": "zh-CN",
            "language_to": "en-US",
        },
    )
    _install(monkeypatch, "a synthetic company without the fixed name")

    blocked = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    ).json()
    assert "summary" in blocked["blocked_fields"]
    assert blocked["candidate"]["summary"] == _content()["summary"]

    _install(monkeypatch, "Example Tech builds synthetic data")
    allowed = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    ).json()
    assert "summary" not in allowed["blocked_fields"]
    assert allowed["glossary_hits"][0]["target"] == "Example Tech"


def test_fact_lock_blocks_translation_of_locked_value(client, monkeypatch):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    created = client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "responsibility_boundary", "path": "summary", "label": "总结事实"},
    )
    assert created.status_code == 201, created.text
    _install(monkeypatch, "a totally different fact")

    body = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    ).json()

    assert "summary" in body["blocked_fields"]
    assert body["candidate"]["summary"] == _content()["summary"]


def test_adopt_writes_only_listed_items_to_variant(client):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)

    response = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={"items": [{"path": "summary", "text": "Engineer at Example Tech"}]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applied_paths"] == ["summary"]
    assert body["variant"]["content"]["summary"] == "Engineer at Example Tech"
    # 变体的岗位定制字段没被一起改；当前简历正文也不变。
    assert body["variant"]["content"]["experience"][0]["description"] == ["负责合成数据接口"]
    current = client.get(f"/api/resumes/{resume_id}").json()
    assert current["content"]["summary"] == _content()["summary"]

    bad = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={"items": [{"path": "experience.9.description.0", "text": "x"}]},
    )
    assert bad.status_code == 422
    after = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert after["content"]["summary"] == "Engineer at Example Tech"


def test_adopt_respects_fact_locks_and_writes_nothing_on_failure(client):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "responsibility_boundary", "path": "summary", "label": "总结事实"},
    )

    response = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={"items": [{"path": "summary", "text": "changed fact"}]},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "fact_lock_conflict"
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["content"]["summary"] == _content()["summary"]

# ===== W06 正文锁：翻译候选/采纳以**变体旧内容**为基准 =====


def test_locked_variant_entry_blocks_translation_candidate_and_adopt(
    client, monkeypatch, db_session
):
    import copy

    from app.models.versions import ResumeVariant

    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    row = db_session.get(ResumeVariant, variant["id"])
    locked_content = copy.deepcopy(row.content)
    locked_content["experience"][0]["lock_content"] = True
    row.content = locked_content
    db_session.commit()
    _install(monkeypatch, "Engineer at Example Tech")

    preview = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    # 锁定条目的候选保留原文，并出现在 blocked_fields（不展示会被拒绝的改写）。
    assert body["candidate"]["experience"][0]["description"] == ["负责合成数据接口"]
    assert "experience.0" in body["blocked_fields"]

    adopted = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={
            "items": [
                {"path": "experience.0.description.0", "text": "Engineer at Example Tech"}
            ]
        },
    )
    assert adopted.status_code == 409, adopted.text
    rejected = adopted.json()
    assert rejected["code"] == "fact_lock_conflict"
    violation = rejected["violations"][0]
    assert violation["kind"] == "lock_content"
    assert violation["path"] == "experience.0"
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["content"]["experience"][0]["description"] == ["负责合成数据接口"]


def test_translation_adopt_uses_variant_baseline_not_current_resume(client, db_session):
    """当前简历锁了条目 ≠ 变体锁了条目：采纳基准必须是变体自己的旧内容。"""
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    # 变体创建之后再锁当前简历的同一条目（变体内容保持不变、也没有锁标记）。
    record = client.get(f"/api/resumes/{resume_id}").json()
    locked = record["content"]
    locked["experience"][0]["lock_content"] = True
    saved = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": locked, "expected_revision": record["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["content"]["experience"][0]["lock_content"] is True

    adopted = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={
            "items": [
                {"path": "experience.0.description.0", "text": "Engineer at Example Tech"}
            ]
        },
    )
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["variant"]["content"]["experience"][0]["description"] == [
        "Engineer at Example Tech"
    ]

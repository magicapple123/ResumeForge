# SPDX-License-Identifier: Apache-2.0
"""W16 语言变体：翻译候选不落库、术语锁定、事实锁、逐项采纳、独立排版。

（批量翻译主题拆在 test_bilingual_batch_translation.py，2026-11-01 守 500 行预算。）
"""

from __future__ import annotations

import json

from app.schemas.setting import LLMConfig
from tests.document_test_support import body_texts, entries_of


def _summary(content: dict) -> str:
    """v2 content 的个人总结文本（summary 是 text 分区里的 TextItem）。"""
    texts = body_texts(content, "summary")
    assert texts, "v2 content 里没有 summary 文本"
    return texts[0]


def _experience_texts(content: dict) -> list[str]:
    return body_texts(content, "experience")


def _summary_path(content: dict) -> str:
    entry = entries_of(content, "summary")[0]
    item = next(item for item in entry["items"] if item["kind"] == "text")
    return f"summary.{entry['id']}.{item['id']}"


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


def _create_resume(client, content: dict | None = None) -> int:
    response = client.post(
        "/api/resumes/manual", json={"title": "双语测试", "content": content or _content()}
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _var_url(resume_id: int, variant_id: int, action: str = "") -> str:
    return f"/api/resumes/{resume_id}/variants/{variant_id}{action}"


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


class _ScriptedProvider:
    """记录每次 provider.chat；回复由 handler 按用户提示词现场生成（区分批量/逐段）。"""

    def __init__(self, handler) -> None:
        self.handler = handler
        self.calls: list[list[dict]] = []

    async def chat(self, messages, *, thinking: bool = True):
        self.calls.append(messages)
        return self.handler(messages[-1]["content"])

    @property
    def prompts(self) -> list[str]:
        return [call[-1]["content"] for call in self.calls]


def _install_provider(monkeypatch, provider) -> None:
    monkeypatch.setattr(
        "app.api.resumes.get_llm_config",
        lambda db: LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        ),
    )
    monkeypatch.setattr("app.api.resumes.create_provider", lambda config: provider)


def _install(monkeypatch, translated: str) -> None:
    _install_provider(monkeypatch, FakeProvider(translated))


def test_variant_carries_language_and_independent_layout(client):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id, language="en-US")
    assert variant["language"] == "en-US"
    detail = client.get(_var_url(resume_id, variant["id"])).json()
    assert detail["render_context"]["page_limit"] >= 1
    patched = client.patch(
        _var_url(resume_id, variant["id"]),
        json={"language": "zh-CN"},
    )
    assert patched.status_code == 200 and patched.json()["language"] == "zh-CN"


def test_translate_returns_candidate_without_writing(client, monkeypatch):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    _install(monkeypatch, "Engineer at Example Tech")

    response = client.post(
        _var_url(resume_id, variant["id"], "/translate"),
        json={"target_language": "en-US"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert _summary(body["candidate"]) == "Engineer at Example Tech"
    assert body["diff"]["stats"]["added"] > 0
    # 候选只在响应里：变体内容没变（取消 = 不采纳，不改正文）。
    detail = client.get(_var_url(resume_id, variant["id"])).json()
    assert _summary(detail["content"]) == _content()["summary"]


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
        _var_url(resume_id, variant["id"], "/translate"),
        json={"target_language": "en-US"},
    ).json()
    assert _summary_path(blocked["candidate"]) in blocked["blocked_fields"]
    assert _summary(blocked["candidate"]) == _content()["summary"]

    _install(monkeypatch, "Example Tech builds synthetic data")
    allowed = client.post(
        _var_url(resume_id, variant["id"], "/translate"),
        json={"target_language": "en-US"},
    ).json()
    assert _summary_path(allowed["candidate"]) not in allowed["blocked_fields"]
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
        _var_url(resume_id, variant["id"], "/translate"),
        json={"target_language": "en-US"},
    ).json()

    assert "summary" in body["blocked_fields"]
    assert _summary(body["candidate"]) == _content()["summary"]


def test_adopt_rejects_language_mismatch(client):
    """#17a：译文只能写进与目标语言一致的变体（在中文版上采纳英文候选被整批拦下）。"""
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id, language="zh-CN")

    mismatch = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={
            "items": [{"path": "summary", "text": "Engineer at Example Tech"}],
            "target_language": "en-US",
        },
    )
    assert mismatch.status_code == 422
    # 整批不落库：正文保持中文。
    after = client.get(_var_url(resume_id, variant["id"])).json()
    assert _summary(after["content"]) == _content()["summary"]

    # 目标语言与变体一致时照常采纳。
    ok = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={
            "items": [{"path": "summary", "text": "在示例科技有限公司负责合成数据接口（改）"}],
            "target_language": "zh-CN",
        },
    )
    assert ok.status_code == 200, ok.text
    # 旧客户端不传 target_language：保持旧行为（不校验），不破坏兼容。
    legacy = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={"items": [{"path": "summary", "text": "在示例科技有限公司负责合成数据接口"}]},
    )
    assert legacy.status_code == 200, legacy.text


def test_overwrite_variant_restores_main_content(client):
    """#17b：被译文污染的变体可以「用当前简历覆盖」恢复；名称/语言标签/排版不动。"""
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id, language="zh-CN")
    # 模拟污染：英文写进中文版。
    polluted = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={"items": [{"path": "summary", "text": "Engineer at Example Tech"}]},
    )
    assert polluted.status_code == 200, polluted.text
    assert _summary(polluted.json()["variant"]["content"]) == "Engineer at Example Tech"

    restored = client.post(
        _var_url(resume_id, variant["id"], "/overwrite")
    )
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert _summary(body["content"]) == _content()["summary"]
    assert body["language"] == "zh-CN"
    assert body["name"] == "英文变体"
    # 再被污染一次仍能恢复（幂等，不依赖第一次的状态）。
    again = client.post(_var_url(resume_id, variant["id"], "/overwrite"))
    assert again.status_code == 200
    assert _summary(again.json()["content"]) == _content()["summary"]


def test_adopt_writes_only_listed_items_to_variant(client):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)

    response = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={"items": [{"path": "summary", "text": "Engineer at Example Tech"}]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applied_paths"] == ["summary"]
    assert _summary(body["variant"]["content"]) == "Engineer at Example Tech"
    # 变体的岗位定制字段没被一起改；当前简历正文也不变。
    assert _experience_texts(body["variant"]["content"]) == ["负责合成数据接口"]
    current = client.get(f"/api/resumes/{resume_id}").json()
    assert _summary(current["content"]) == _content()["summary"]

    bad = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={"items": [{"path": "experience.9.description.0", "text": "x"}]},
    )
    assert bad.status_code == 422
    after = client.get(_var_url(resume_id, variant["id"])).json()
    assert _summary(after["content"]) == "Engineer at Example Tech"


def test_adopt_respects_fact_locks_and_writes_nothing_on_failure(client):
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    client.post(
        f"/api/provenance/resumes/{resume_id}/fact-locks",
        json={"kind": "responsibility_boundary", "path": "summary", "label": "总结事实"},
    )

    response = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={"items": [{"path": "summary", "text": "changed fact"}]},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "fact_lock_conflict"
    detail = client.get(_var_url(resume_id, variant["id"])).json()
    assert _summary(detail["content"]) == _content()["summary"]


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
    entries_of(locked_content, "experience")[0]["lock_content"] = True
    row.content = locked_content
    db_session.commit()
    _install(monkeypatch, "Engineer at Example Tech")

    preview = client.post(
        _var_url(resume_id, variant["id"], "/translate"),
        json={"target_language": "en-US"},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    # 锁定条目的候选保留原文，并出现在 blocked_fields（不展示会被拒绝的改写）。
    assert _experience_texts(body["candidate"]) == ["负责合成数据接口"]
    assert (
        f"experience.{entries_of(body['candidate'], 'experience')[0]['id']}"
        in body["blocked_fields"]
    )

    adopted = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={
            "items": [{"path": "experience.0.description.0", "text": "Engineer at Example Tech"}]
        },
    )
    assert adopted.status_code == 409, adopted.text
    rejected = adopted.json()
    assert rejected["code"] == "fact_lock_conflict"
    violation = rejected["violations"][0]
    assert violation["kind"] == "lock_content"
    assert violation["path"] == "experience.0"
    detail = client.get(_var_url(resume_id, variant["id"])).json()
    assert _experience_texts(detail["content"]) == ["负责合成数据接口"]


def test_translation_adopt_uses_variant_baseline_not_current_resume(client, db_session):
    """当前简历锁了条目 ≠ 变体锁了条目：采纳基准必须是变体自己的旧内容。"""
    resume_id = _create_resume(client)
    variant = _create_variant(client, resume_id)
    # 变体创建之后再锁当前简历的同一条目（变体内容保持不变、也没有锁标记）。
    record = client.get(f"/api/resumes/{resume_id}").json()
    locked = record["content"]
    entries_of(locked, "experience")[0]["lock_content"] = True
    saved = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": locked, "expected_revision": record["revision"]},
    )
    assert saved.status_code == 200, saved.text
    assert entries_of(saved.json()["content"], "experience")[0]["lock_content"] is True

    adopted = client.post(
        _var_url(resume_id, variant["id"], "/adopt"),
        json={
            "items": [{"path": "experience.0.description.0", "text": "Engineer at Example Tech"}]
        },
    )
    assert adopted.status_code == 200, adopted.text
    assert _experience_texts(adopted.json()["variant"]["content"]) == ["Engineer at Example Tech"]

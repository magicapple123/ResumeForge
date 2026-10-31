# SPDX-License-Identifier: Apache-2.0
"""W16 语言变体：翻译候选不落库、批量翻译与回退、术语锁定、事实锁、逐项采纳、独立排版。"""

from __future__ import annotations

import json
import logging

import pytest
from app.schemas.setting import LLMConfig
from tests.document_test_support import body_texts, entries_of, field_value


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
    assert _summary(body["candidate"]) == "Engineer at Example Tech"
    assert body["diff"]["stats"]["added"] > 0
    # 候选只在响应里：变体内容没变（取消 = 不采纳，不改正文）。
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
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
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    ).json()
    assert _summary_path(blocked["candidate"]) in blocked["blocked_fields"]
    assert _summary(blocked["candidate"]) == _content()["summary"]

    _install(monkeypatch, "Example Tech builds synthetic data")
    allowed = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
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
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
        json={"target_language": "en-US"},
    ).json()

    assert "summary" in body["blocked_fields"]
    assert _summary(body["candidate"]) == _content()["summary"]


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
    assert _summary(body["variant"]["content"]) == "Engineer at Example Tech"
    # 变体的岗位定制字段没被一起改；当前简历正文也不变。
    assert _experience_texts(body["variant"]["content"]) == ["负责合成数据接口"]
    current = client.get(f"/api/resumes/{resume_id}").json()
    assert _summary(current["content"]) == _content()["summary"]

    bad = client.post(
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={"items": [{"path": "experience.9.description.0", "text": "x"}]},
    )
    assert bad.status_code == 422
    after = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert _summary(after["content"]) == "Engineer at Example Tech"


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
        f"/api/resumes/{resume_id}/variants/{variant['id']}/translate",
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
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
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
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
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
        f"/api/resumes/{resume_id}/variants/{variant['id']}/adopt",
        json={
            "items": [{"path": "experience.0.description.0", "text": "Engineer at Example Tech"}]
        },
    )
    assert adopted.status_code == 200, adopted.text
    assert _experience_texts(adopted.json()["variant"]["content"]) == ["Engineer at Example Tech"]


# ===== 批量翻译：多段一次调用，坏响应只回退该块 =====

_MULTI_CONTENT = {
    "summary": "负责合成数据接口的稳定性",
    "experience": [
        {
            "id": "expobj0001",
            "company": "示例科技有限公司",
            "role": "后端实习生",
            "description": ["把离线评测脚本接入 CI", "维护合成数据接口"],
            "point_ids": {"description": ["pnt0000001", "pnt0000002"]},
        }
    ],
}

_MULTI_TRANSLATIONS = {
    "负责合成数据接口的稳定性": "Kept the synthetic data API stable",
    "后端实习生": "Backend intern",
    "把离线评测脚本接入 CI": "Wired the offline evaluation scripts into CI",
    "维护合成数据接口": "Maintained the synthetic data API",
}


def _prompt_segments(prompt: str) -> list[str]:
    """批量提示词把片段 JSON 放在独立一行；用它确认模型实际收到的段序。"""
    for line in prompt.splitlines():
        if line.startswith("["):
            return json.loads(line)
    raise AssertionError("批量提示词里没有片段 JSON")


def _provider_for(translations: dict[str, str], *, batch_reply: str | None = None):
    """按"源文 → 译文"查表回复；batch_reply 非空时批量调用直接返回它（回退用例）。"""

    def handler(prompt: str) -> str:
        if "translations" in prompt:
            if batch_reply is not None:
                return batch_reply
            segments = _prompt_segments(prompt)
            return json.dumps(
                {"translations": [translations[text] for text in segments]},
                ensure_ascii=False,
            )
        for source, target in translations.items():
            if source in prompt:
                return json.dumps({"result": target}, ensure_ascii=False)
        raise AssertionError("逐段翻译的提示词里找不到已知原文")

    return _ScriptedProvider(handler)


def _translate(client, resume_id: int, variant_id: int) -> dict:
    response = client.post(
        f"/api/resumes/{resume_id}/variants/{variant_id}/translate",
        json={"target_language": "en-US"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _assert_multi_candidate(candidate: dict) -> None:
    assert _summary(candidate) == _MULTI_TRANSLATIONS["负责合成数据接口的稳定性"]
    assert field_value(candidate, "role", section="experience") == _MULTI_TRANSLATIONS["后端实习生"]
    assert _experience_texts(candidate) == [
        _MULTI_TRANSLATIONS["把离线评测脚本接入 CI"],
        _MULTI_TRANSLATIONS["维护合成数据接口"],
    ]


def test_all_fields_are_translated_in_a_single_batch(client, monkeypatch):
    """字段一多就逐段调模型是这次超时的根因：同一批必须只发一次调用。"""
    resume_id = _create_resume(client, _MULTI_CONTENT)
    variant = _create_variant(client, resume_id)
    provider = _provider_for(_MULTI_TRANSLATIONS)
    _install_provider(monkeypatch, provider)

    body = _translate(client, resume_id, variant["id"])

    assert len(provider.calls) == 1
    prompt = provider.prompts[0]
    assert all(text in prompt for text in _MULTI_TRANSLATIONS)
    assert "zh2en" in prompt
    assert body["blocked_fields"] == []
    _assert_multi_candidate(body["candidate"])


def test_long_resume_is_split_into_bounded_batches(client, monkeypatch):
    """25 段 → 24 段一批 + 1 段走逐段：单块有上限，且跨块顺序不变。"""
    points = [f"第 {index} 条离线评测脚本说明" for index in range(1, 24)]
    content = {
        "summary": "负责合成数据接口的稳定性",
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": points,
                "point_ids": {"description": [f"pnt{index:07d}" for index in range(1, 24)]},
            }
        ],
    }
    translations = {
        "负责合成数据接口的稳定性": "Kept the synthetic data API stable",
        "后端实习生": "Backend intern",
    }
    translations.update({text: f"EN {index}" for index, text in enumerate(points, start=1)})
    resume_id = _create_resume(client, content)
    variant = _create_variant(client, resume_id)
    provider = _provider_for(translations)
    _install_provider(monkeypatch, provider)

    body = _translate(client, resume_id, variant["id"])

    assert len(provider.calls) == 2
    assert len(_prompt_segments(provider.prompts[0])) == 24
    # 剩下的单段走原有 translate()，提示词形状与历史一致（result）。
    assert "translations" not in provider.prompts[1]
    assert _experience_texts(body["candidate"]) == [translations[text] for text in points]


@pytest.mark.parametrize(
    "batch_reply",
    [
        "抱歉，我无法完成这次翻译。",
        '{"translations": ["only one"]}',
        '{"translations": ["a", 3, "c", "d"]}',
        '{"result": "wrong schema"}',
    ],
)
def test_broken_batch_response_falls_back_to_per_field(client, monkeypatch, caplog, batch_reply):
    """模型输出不合格时只回退该块逐段翻译：结果仍然正确，不整单失败。"""
    resume_id = _create_resume(client, _MULTI_CONTENT)
    variant = _create_variant(client, resume_id)
    provider = _provider_for(_MULTI_TRANSLATIONS, batch_reply=batch_reply)
    _install_provider(monkeypatch, provider)

    with caplog.at_level(logging.WARNING, logger="app.services.resume.bilingual_variants"):
        body = _translate(client, resume_id, variant["id"])

    # 1 次批量 + 4 次逐段；只有失败的那块回退。
    assert len(provider.calls) == 5
    assert "translations" in provider.prompts[0]
    assert all("translations" not in prompt for prompt in provider.prompts[1:])
    assert "回退逐段翻译" in caplog.text
    assert body["blocked_fields"] == []
    _assert_multi_candidate(body["candidate"])


def test_single_translatable_field_skips_the_batch(client, monkeypatch):
    resume_id = _create_resume(client, {"summary": "负责合成数据接口的稳定性"})
    variant = _create_variant(client, resume_id)
    provider = _provider_for({"负责合成数据接口的稳定性": "Kept the synthetic data API stable"})
    _install_provider(monkeypatch, provider)

    body = _translate(client, resume_id, variant["id"])

    assert len(provider.calls) == 1
    assert "translations" not in provider.prompts[0]
    assert _summary(body["candidate"]) == "Kept the synthetic data API stable"


def test_batch_translation_still_enforces_locked_glossary_term(client, monkeypatch):
    """批量路径复用同一套术语锁定：漏掉锁定译名的字段保留原文并记 blocked。"""
    resume_id = _create_resume(client, _MULTI_CONTENT)
    variant = _create_variant(client, resume_id)
    client.post(
        "/api/glossary-terms",
        json={
            "source_term": "合成数据接口",
            "target_term": "synthetic data API",
            "language_from": "zh-CN",
            "language_to": "en-US",
        },
    )
    translations = dict(_MULTI_TRANSLATIONS)
    # 这一段漏了锁定译名 → 必须 blocked；description 那条带上了 → 正常采纳并记命中。
    translations["负责合成数据接口的稳定性"] = "Kept the interface stable"
    provider = _provider_for(translations)
    _install_provider(monkeypatch, provider)

    body = _translate(client, resume_id, variant["id"])

    assert len(provider.calls) == 1
    assert _summary_path(body["candidate"]) in body["blocked_fields"]
    assert _summary(body["candidate"]) == "负责合成数据接口的稳定性"
    assert _experience_texts(body["candidate"])[1] == "Maintained the synthetic data API"
    assert {"source": "合成数据接口", "target": "synthetic data API"} in body["glossary_hits"]

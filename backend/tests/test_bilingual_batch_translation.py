# SPDX-License-Identifier: Apache-2.0
"""W16 批量翻译：多段一次调用、分段上限、坏响应按块回退、锁定术语照常生效。

（2026-11-01 从 test_bilingual_variants.py 拆出，守 500 行预算；共享 helper 从原文件导入。）
"""

from __future__ import annotations

import json
import logging

import pytest
from tests.document_test_support import field_value
from tests.test_bilingual_variants import (
    _create_resume,
    _create_variant,
    _experience_texts,
    _install_provider,
    _ScriptedProvider,
    _summary,
    _summary_path,
)

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

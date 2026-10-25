# SPDX-License-Identifier: Apache-2.0
"""A5：按职业场景派生已有简历变体（创建 → 预览候选 → 采纳）。

守的边界：

- 创建/预览/采纳都**不写源简历**（内容、revision 不变）；
- 预览**不落库**（变体内容指纹不变），候选只存在于响应里；
- 采纳只写这条变体、且是双条件写（变体内容指纹 + 场景上下文哈希）；
- 场景在候选生成后被改 → 409，要求重新生成；
- 变体正文锁以变体旧内容为基准，违规不写一个字段；
- 未知场景/未配置模型/非法请求都明确失败，不留半成品。
"""

from __future__ import annotations

import json

from app.schemas.setting import LLMConfig
from app.services.resume.resume_delivery import canonical_content_sha256

CONTENT = {
    "name": "张示例",
    "phone": "13800000000",
    "summary": "原始总结",
    "experience": [
        {
            "company": "示例公司",
            "role": "工程师",
            "description": ["负责示例模块。", "把流程自动化。"],
            "id": "exp_12345678",
            "lock_content": True,
        }
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
}


def _configure(client):
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="integration-secret",
        model="integration-model",
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _create_resume(client, content=None):
    response = client.post(
        "/api/resumes/manual",
        json={"title": "场景变体测试", "content": content or CONTENT, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_scenario(client, name="跨行转岗", config=None):
    payload = {
        "name": name,
        "config": config
        or {
            "purpose": "career_change",
            "career_stage": "experienced",
            "target_industries": ["制造业"],
            "target_function": "数据分析",
            "employment_status": "unemployed",
        },
    }
    response = client.post("/api/career-scenarios", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _scenario_ref(scenario, **overrides):
    payload = {"scenario_id": scenario["id"], "expected_revision": scenario["revision"]}
    payload.update(overrides)
    return payload


class FakeProvider:
    """记录提示词，并按预设 JSON 返回修订结果。"""

    instances: list[FakeProvider] = []

    def __init__(self, payload: dict):
        self.payload = payload
        self.messages: list[list[dict]] = []
        FakeProvider.instances.append(self)

    async def chat(self, messages, *, thinking: bool = True):
        self.messages.append(messages)
        return json.dumps(self.payload, ensure_ascii=False)


def _patch_provider(monkeypatch, payload: dict) -> FakeProvider:
    provider = FakeProvider(payload)
    monkeypatch.setattr("app.api.resumes.create_provider", lambda _config: provider)
    return provider


def _variant_content(client, resume_id: int, variant_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}/variants/{variant_id}")
    assert response.status_code == 200, response.text
    return response.json()["content"]


def _create_variant(client, resume_id: int, scenario: dict, name="跨行转岗变体") -> dict:
    response = client.post(
        f"/api/resumes/{resume_id}/scenario-variants",
        json={"name": name, "career_context": _scenario_ref(scenario)},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ===== 创建 =====


def test_create_scenario_variant_freezes_context_and_leaves_source_untouched(client):
    resume = _create_resume(client)
    scenario = _create_scenario(client)

    variant = _create_variant(client, resume["id"], scenario)

    assert variant["context_snapshot"]["display_name"] == "跨行转岗"
    assert variant["context_snapshot"]["scenario_id"] == scenario["id"]
    # 源简历零写入：内容、revision、context_snapshot 都不变。
    source = client.get(f"/api/resumes/{resume['id']}").json()
    assert source["content"]["summary"] == "原始总结"
    assert source["revision"] == resume["revision"]
    assert source["context_snapshot"] is None
    # 变体内容从源简历复制。
    assert _variant_content(client, resume["id"], variant["id"])["summary"] == "原始总结"


def test_create_with_unknown_scenario_fails_without_variant(client):
    resume = _create_resume(client)
    response = client.post(
        f"/api/resumes/{resume['id']}/scenario-variants",
        json={
            "name": "坏的",
            "career_context": {"scenario_id": 9999, "expected_revision": 1},
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == "career_scenario_not_found"
    listing = client.get(f"/api/resumes/{resume['id']}/variants").json()
    assert listing["items"] == []


# ===== 预览（不落库） =====


def test_preview_returns_candidate_without_writing(client, monkeypatch):
    _configure(client)
    resume = _create_resume(client)
    scenario = _create_scenario(client)
    variant = _create_variant(client, resume["id"], scenario)
    before_sha = variant["content_sha256"]

    payload = dict(CONTENT)
    payload["summary"] = "场景改写后的总结"
    provider = _patch_provider(monkeypatch, payload)

    response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-preview",
        json={"career_context": _scenario_ref(scenario), "instructions": "突出可转移技能"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["candidate_content"]["summary"] == "场景改写后的总结"
    assert body["base_content_sha256"] == before_sha
    assert body["context_sha256"] == variant["context_snapshot"]["context_sha256"]
    # 提示词确实带上了场景表达块与用户指令；事实字段仍在。
    prompt = provider.messages[-1][-1]["content"]
    assert "本次表达场景" in prompt
    assert "跨行转岗" in prompt
    assert "突出可转移技能" in prompt
    # 预览不落库：变体内容与源简历都没变。
    assert _variant_content(client, resume["id"], variant["id"])["summary"] == "原始总结"
    source = client.get(f"/api/resumes/{resume['id']}").json()
    assert source["content"]["summary"] == "原始总结"
    assert source["revision"] == resume["revision"]


def test_preview_requires_llm_config(client):
    resume = _create_resume(client)
    scenario = _create_scenario(client)
    variant = _create_variant(client, resume["id"], scenario)

    response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-preview",
        json={"career_context": _scenario_ref(scenario)},
    )
    assert response.status_code == 400
    assert "配置大模型" in response.json()["detail"]


# ===== 采纳（双条件写） =====


def _preview(client, monkeypatch, resume_id: int, variant_id: int, scenario: dict, summary: str):
    payload = dict(CONTENT)
    payload["summary"] = summary
    _patch_provider(monkeypatch, payload)
    response = client.post(
        f"/api/resumes/{resume_id}/variants/{variant_id}/scenario-preview",
        json={"career_context": _scenario_ref(scenario)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_adopt_writes_only_the_variant(client, monkeypatch):
    _configure(client)
    resume = _create_resume(client)
    scenario = _create_scenario(client)
    variant = _create_variant(client, resume["id"], scenario)
    preview = _preview(client, monkeypatch, resume["id"], variant["id"], scenario, "采纳后的总结")

    response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-adopt",
        json={
            "content": preview["candidate_content"],
            "expected_content_sha256": preview["base_content_sha256"],
            "expected_context_sha256": preview["context_sha256"],
            "career_context": _scenario_ref(scenario),
        },
    )
    assert response.status_code == 200, response.text
    adopted = response.json()
    assert adopted["content"]["summary"] == "采纳后的总结"
    assert adopted["context_snapshot"]["display_name"] == "跨行转岗"
    # 锁标记随采纳保留（模型输出通常不带锁字段）。
    assert adopted["content"]["experience"][0]["lock_content"] is True
    # 源简历一个字段都不写。
    source = client.get(f"/api/resumes/{resume['id']}").json()
    assert source["content"]["summary"] == "原始总结"
    assert source["revision"] == resume["revision"]
    # 变体详情与列表都反映新内容。
    detail = _variant_content(client, resume["id"], variant["id"])
    assert detail["summary"] == "采纳后的总结"


def test_adopt_rejects_when_variant_changed_after_preview(client, monkeypatch):
    _configure(client)
    resume = _create_resume(client)
    scenario = _create_scenario(client)
    variant = _create_variant(client, resume["id"], scenario)
    preview = _preview(client, monkeypatch, resume["id"], variant["id"], scenario, "候选")

    # 另一个窗口改过这条变体（直接改库模拟：既有 API 没有变体内容写入口）。
    from app.database import SessionLocal
    from app.models.versions import ResumeVariant

    db = SessionLocal()
    try:
        row = db.get(ResumeVariant, variant["id"])
        row.content_sha256 = "f" * 64
        db.commit()
    finally:
        db.close()

    response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-adopt",
        json={
            "content": preview["candidate_content"],
            "expected_content_sha256": preview["base_content_sha256"],
            "expected_context_sha256": preview["context_sha256"],
            "career_context": _scenario_ref(scenario),
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "variant_content_conflict"
    assert _variant_content(client, resume["id"], variant["id"])["summary"] == "原始总结"


def test_adopt_rejects_when_scenario_changed_after_preview(client, monkeypatch):
    _configure(client)
    resume = _create_resume(client)
    scenario = _create_scenario(client)
    variant = _create_variant(client, resume["id"], scenario)
    preview = _preview(client, monkeypatch, resume["id"], variant["id"], scenario, "候选")

    renamed = client.patch(
        f"/api/career-scenarios/{scenario['id']}",
        json={"name": "改名后的场景", "expected_revision": scenario["revision"]},
    )
    assert renamed.status_code == 200

    response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-adopt",
        json={
            "content": preview["candidate_content"],
            "expected_content_sha256": preview["base_content_sha256"],
            "expected_context_sha256": preview["context_sha256"],
            "career_context": _scenario_ref(renamed.json()),
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "career_scenario_context_changed"


def test_adopt_respects_variant_content_locks(client, monkeypatch):
    _configure(client)
    resume = _create_resume(client)
    scenario = _create_scenario(client)
    variant = _create_variant(client, resume["id"], scenario)
    # 模型改了锁定条目的正文（把职责描述改写）。
    payload = json.loads(json.dumps(CONTENT, ensure_ascii=False))
    payload["experience"][0]["description"] = ["主导整个部门。"]
    _patch_provider(monkeypatch, payload)
    preview_response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-preview",
        json={"career_context": _scenario_ref(scenario)},
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()

    response = client.post(
        f"/api/resumes/{resume['id']}/variants/{variant['id']}/scenario-adopt",
        json={
            "content": preview["candidate_content"],
            "expected_content_sha256": preview["base_content_sha256"],
            "expected_context_sha256": preview["context_sha256"],
            "career_context": _scenario_ref(scenario),
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "fact_lock_conflict"
    assert response.json()["violations"]
    assert _variant_content(client, resume["id"], variant["id"])["summary"] == "原始总结"


def test_canonical_sha_is_stable_for_untouched_content():
    first = canonical_content_sha256(CONTENT)
    second = canonical_content_sha256(json.loads(json.dumps(CONTENT)))
    assert first == second and len(first) == 64

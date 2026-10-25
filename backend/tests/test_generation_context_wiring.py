# SPDX-License-Identifier: Apache-2.0
"""A5/A3 生成入口接线（Lead 集成）：场景快照冻结、旧请求兼容、事实候选注入。

守的是计划 §6 的硬合同与 §13.1 的验收项：
- G01：旧请求（不传 career_context）的候选资料、提示词、岗位关联与基线一致；
- G02：只想"切换场景"不产生任何请求（后端只验证"未显式选用就不发"）；
- G04/G05：任务创建时冻结快照，运行前后改名/归档场景不影响本次生成与落库；
- G09/G10：未知场景 / 版本不符 / 归档场景明确失败且不创建任务；
- G11：SSE 与后台任务对同一输入得到同一语义快照（context_sha256 一致）；
- A3：补充事实进入候选提示词，证号绝不进入任何提示词文本；
- C2：没有新增事实时提示词不出现扩展输出结构块。
"""

from __future__ import annotations

import json

import pytest
from app.services.llm.base import BaseLLMProvider
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


class CapturingProvider(BaseLLMProvider):
    """记录收到的消息，然后产出一份合法简历 JSON。"""

    def __init__(self, config):
        super().__init__(config)
        self.calls: list[list[dict]] = []

    async def chat(self, _messages, *, thinking: bool = True):
        raise AssertionError("合法流式 JSON 不应触发一次性对话")

    async def stream_chat(self, messages):
        self.calls.append(messages)
        yield json.dumps(
            {
                "summary": "具备后端开发经验。",
                "projects": [{"name": "简历通", "role": "核心开发"}],
            },
            ensure_ascii=False,
        )


def _prompt_text(provider: CapturingProvider) -> str:
    assert provider.calls, "模型没有被调用"
    return "\n".join(str(message.get("content") or "") for message in provider.calls[-1])


def _capture(monkeypatch, module: str) -> CapturingProvider:
    holder: list[CapturingProvider] = []

    def factory(config):
        provider = CapturingProvider(config)
        holder.append(provider)
        return provider

    monkeypatch.setattr(f"{module}.create_provider", factory)
    return holder  # type: ignore[return-value]


def _create_scenario(client, name="跨行转岗", **config_overrides):
    config = {
        "purpose": "career_change",
        "career_stage": "experienced",
        "target_industries": ["制造业"],
        "target_function": "数据分析",
        "employment_status": "unemployed",
        **config_overrides,
    }
    response = client.post("/api/career-scenarios", json={"name": name, "config": config})
    assert response.status_code == 201, response.text
    return response.json()


def _scenario_payload(scenario, **overrides):
    payload = {
        "scenario_id": scenario["id"],
        "expected_revision": scenario["revision"],
    }
    payload.update(overrides)
    return payload


def _start_task(client, job, career_context):
    response = client.post(
        "/api/resumes/generate/tasks",
        json={"job_id": job["id"], "options": {"career_context": career_context}},
    )
    return response


def _task_count() -> int:
    from app.database import SessionLocal
    from app.models.resume import ResumeGenerateTask

    db = SessionLocal()
    try:
        return db.query(ResumeGenerateTask).count()
    finally:
        db.close()


# ===== G01：旧请求（不传职业场景）仍走同一生成编排 =====


def test_request_without_context_keeps_scoped_prompt_and_null_snapshot(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    prompt = _prompt_text(holder[0])
    assert "本次职业场景" not in prompt
    # F3/R-28：提示词只描述当前组参与的大字段（不再走旧"补充事实"口径）。
    assert "当前组参与的大字段" in prompt
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["context_snapshot"] is None
    # 旧请求的岗位关联不变。
    assert record["job_id"] == job["id"]


# ===== G04 / G05：创建时冻结，运行前后改名/归档不影响 =====


def test_saved_scenario_is_frozen_at_creation_and_survives_archive(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    scenario = _create_scenario(client)
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = _start_task(client, job, _scenario_payload(scenario))
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    prompt = _prompt_text(holder[0])
    assert "本次职业场景" in prompt
    assert "跨行转岗" in prompt
    # 就业状态默认不外发（请求未允许 → 连值都不出现）。
    assert "待业" not in prompt

    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    snapshot = record["context_snapshot"]
    assert snapshot is not None
    assert snapshot["display_name"] == "跨行转岗"
    assert snapshot["scenario_origin"] == "saved"
    assert "employment_status" not in snapshot["resolved_dimensions"]
    frozen_hash = snapshot["context_sha256"]
    frozen_content = record["content"]

    # 运行完之后改名 + 归档场景：历史快照与内容一个字节都不变。
    renamed = client.patch(
        f"/api/career-scenarios/{scenario['id']}",
        json={
            "name": "改名后的场景",
            "archived": True,
            "expected_revision": scenario["revision"],
        },
    )
    assert renamed.status_code == 200, renamed.text
    again = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert again["content"] == frozen_content
    assert again["context_snapshot"]["display_name"] == "跨行转岗"
    assert again["context_snapshot"]["context_sha256"] == frozen_hash


def test_explicit_employment_status_disclosure_only_when_requested(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    scenario = _create_scenario(client)
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    payload = _scenario_payload(scenario, include_employment_status=True)
    started = _start_task(client, job, payload)
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    prompt = _prompt_text(holder[0])
    # 显式允许后，值只用于用户要求的解释，且仍以"不得进正文"为约束。
    assert "待业" in prompt
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    snapshot = record["context_snapshot"]
    assert snapshot["disclosure"] == {"include_employment_status": True}
    assert snapshot["resolved_dimensions"]["employment_status"] == "unemployed"


# ===== G09 / G10：明确失败，不创建任务 =====


def test_unknown_scenario_is_rejected_without_task(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    response = _start_task(
        client,
        job,
        {"scenario_id": 9999, "expected_revision": 1},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "career_scenario_not_found"
    assert _task_count() == 0


def test_stale_expected_revision_is_rejected_without_task(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    scenario = _create_scenario(client)
    _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    # 另一窗口先改了一版。
    updated = client.patch(
        f"/api/career-scenarios/{scenario['id']}",
        json={"name": "新名字", "expected_revision": scenario["revision"]},
    )
    assert updated.status_code == 200

    response = _start_task(client, job, _scenario_payload(scenario))
    assert response.status_code == 409
    assert response.json()["code"] == "career_scenario_revision_conflict"
    assert _task_count() == 0


def test_archived_scenario_is_rejected(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    scenario = _create_scenario(client)
    _capture(monkeypatch, "app.services.resume.resume_generate_runner")
    archived = client.patch(
        f"/api/career-scenarios/{scenario['id']}",
        json={"archived": True, "expected_revision": scenario["revision"]},
    )
    assert archived.status_code == 200
    response = _start_task(
        client,
        job,
        _scenario_payload(archived.json()),
    )
    assert response.status_code == 409
    assert response.json()["code"] == "career_scenario_archived"
    assert _task_count() == 0


def test_preset_requires_matching_catalog_version(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    catalog = client.get("/api/career-scenarios/catalog").json()
    preset = catalog["presets"][0]
    _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    stale = _start_task(
        client,
        job,
        {
            "preset_key": preset["key"],
            "catalog_version": "999",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "career_scenario_catalog_version_conflict"
    assert _task_count() == 0

    # 目录版本正确时内置场景可用（不落库，但生成成功）。
    ok = _start_task(
        client,
        job,
        {
            "preset_key": preset["key"],
            "catalog_version": catalog["catalog_version"],
        },
    )
    assert ok.status_code == 201, ok.text
    final = _wait_terminal(client, ok.json()["id"])
    assert final["status"] == "completed"
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["context_snapshot"]["scenario_origin"] == "preset"
    assert record["context_snapshot"]["preset_key"] == preset["key"]


# ===== G11：两种传输同一 resolver =====


def test_sse_and_background_share_the_same_semantic_snapshot(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    scenario = _create_scenario(client)
    payload = _scenario_payload(scenario, include_employment_status=True)

    # 后台任务路径
    bg_holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")
    started = _start_task(client, job, payload)
    assert started.status_code == 201, started.text
    background = _wait_terminal(client, started.json()["id"])
    background_record = client.get(f"/api/resumes/{background['resume_id']}").json()

    # SSE 路径（同一个 resolver；同一个 scenario/revision）。
    sse_holder = _capture(monkeypatch, "app.api.resumes")
    sse = client.post(
        "/api/resumes/generate",
        json={"job_id": job["id"], "options": {"career_context": payload}},
    )
    assert sse.status_code == 200, sse.text
    assert '"type": "saved"' in sse.text or '"type":"saved"' in sse.text
    listing = client.get("/api/resumes").json()
    assert listing["total"] == 2
    records = [client.get(f"/api/resumes/{item['id']}").json() for item in listing["items"]]
    sse_record = next(item for item in records if item["id"] != background["resume_id"])
    assert sse_holder and bg_holder

    bg_snapshot = background_record["context_snapshot"]
    sse_snapshot = sse_record["context_snapshot"]
    assert bg_snapshot["context_sha256"] == sse_snapshot["context_sha256"]
    for field in (
        "scenario_origin",
        "scenario_id",
        "scenario_revision",
        "display_name",
        "resolved_dimensions",
        "approved_guidance",
        "disclosure",
    ):
        assert bg_snapshot[field] == sse_snapshot[field], field


# ===== F3：只有新资料模型进入候选提示词；证书编号不外发 =====


def _create_entry(client, section_key: str, values: dict) -> dict:
    response = client.post(
        f"/api/profile/sections/{section_key}/entries", json={"values": values}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_new_model_entries_reach_candidate_prompt_without_private_number(client, monkeypatch):
    """A3/H 的新口径：新资料模型（学术成果/证书资质）进入候选，证书编号永不外发。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _create_entry(
        client,
        "publications",
        {
            "publications.title": "跨库事务一致性研究",
            "publications.authors": "张三",
            "publications.venue": "软件工程实践",
        },
    )
    _create_entry(
        client,
        "credentials",
        {
            "credentials.title": "注册质量工程师",
            "credentials.issuer": "示例认证机构",
            "credentials.credential_number": "SECRET-NUMBER-123",
        },
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"

    prompt = _prompt_text(holder[0])
    assert "跨库事务一致性研究" in prompt
    assert "注册质量工程师" in prompt
    # 私密证书编号（catalog private/llm_allowed=False）绝不进入提示词。
    assert "SECRET-NUMBER-123" not in prompt


# ===== R-54/F3：旧"补充事实"模块退役，不再作为生成输入 =====


def test_retired_profile_facts_do_not_count_as_content(client, db_session, monkeypatch):
    """只有旧事实、新模型为空 → 明确 400；生成不再读旧事实表（R-46/R-54）。"""
    from app.services.profile import fact_store

    _configure(client)
    job = _job(client)
    _capture(monkeypatch, "app.services.resume.resume_generate_runner")
    fact_store.create_fact(
        db_session,
        kind="publication",
        payload={
            "title": "只有旧论文的用户",
            "authors": [{"name": "匿名作者", "is_self": True}],
            "status": "under_review",
        },
    )

    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert started.status_code == 400, started.text
    assert "个人资料为空" in started.json()["detail"]


def test_truly_empty_profile_still_rejected(client):
    _configure(client)
    job = _job(client)
    response = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
    assert response.status_code == 400
    assert "个人资料为空" in response.json()["detail"]

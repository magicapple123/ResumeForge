# SPDX-License-Identifier: Apache-2.0
"""灵活补充事实（9 类 + 自定义字段 + 隐藏字段）进入真实生成候选提示词。

守 Lead 集成层：
- 新类型 award/training/language 与自定义字段确实进入模型提示词；
- 被隐藏的默认字段、以及 credential_number 永远不进入提示词；
- 旧事实类型行为不变（由既有 test_generation_context_wiring 守着）。
"""

from __future__ import annotations

import pytest
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import _configure, _job, _seed_profile, _wait_terminal
from tests.test_generation_context_wiring import _capture, _prompt_text


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _create_fact(client, kind: str, payload: dict) -> dict:
    response = client.post("/api/profile/facts", json={"kind": kind, "payload": payload})
    assert response.status_code == 201, response.text
    return response.json()


def _schema(client) -> dict:
    response = client.get("/api/profile/facts/schema")
    assert response.status_code == 200
    return {item["kind"]: item for item in response.json()["kinds"]}


def _set_schema(client, kind: str, *, hidden_fields, custom_fields) -> None:
    current = _schema(client)[kind]
    response = client.put(
        f"/api/profile/facts/schema/{kind}",
        json={
            "hidden_fields": hidden_fields,
            "custom_fields": custom_fields,
            "expected_revision": current["revision"],
        },
    )
    assert response.status_code == 200, response.text


def test_flexible_facts_reach_generation_prompt_without_private_fields(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = client.post(
        "/api/jobs",
        json={
            "title": "护理培训师",
            "company": "示例医疗机构",
            "requirements": "护理经验；慢病管理培训；健康宣教；英语 CET-6；技能竞赛获奖优先",
        },
    ).json()
    _set_schema(
        client,
        "credential",
        hidden_fields=[],
        custom_fields=[{"key": "cf_aaaaaaaaaaaa", "label": "证书编号后四位"}],
    )
    _create_fact(
        client,
        "credential",
        {
            "name": "示例注册护理师",
            "issuer": "示例卫生健康委员会",
            "status": "active",
            "credential_number": "SECRET-REAL-0001",
            "custom_fields": [
                {"key": "cf_aaaaaaaaaaaa", "label": "证书编号后四位", "value": "0001"}
            ],
        },
    )
    _create_fact(
        client,
        "award",
        {"name": "示例护理技能竞赛二等奖", "issuer": "示例护理学会", "date": "2023-10"},
    )
    _create_fact(
        client,
        "training",
        {"name": "慢病管理培训", "organization": "示例继续教育学院", "hours": "32"},
    )
    _create_fact(
        client,
        "language",
        {"name": "英语", "level": "熟练", "certificate": "CET-6", "score": "560"},
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = client.post(
        "/api/resumes/generate/tasks",
        json={"job_id": job["id"], "options": {}},
    )
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed", final

    prompt = _prompt_text(holder[0])
    for expected in (
        "示例注册护理师",
        "证书编号后四位",
        "0001",
        "示例护理技能竞赛二等奖",
        "慢病管理培训",
        "CET-6",
    ):
        assert expected in prompt, expected
    # 私密证号与没有定义的隐藏字段绝不出现。
    assert "SECRET-REAL-0001" not in prompt


def test_hidden_default_field_does_not_reach_generation_prompt(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    _create_fact(
        client,
        "award",
        {"name": "示例优秀员工", "issuer": "示例单位", "date": "2024-01"},
    )
    current = _schema(client)["award"]
    _set_schema(
        client,
        "award",
        hidden_fields=["issuer"],
        custom_fields=list(current["custom_fields"]),
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")
    started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"], "options": {}})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed", final
    prompt = _prompt_text(holder[0])
    assert "示例优秀员工" in prompt
    assert "示例单位" not in prompt

# SPDX-License-Identifier: Apache-2.0
"""新资料模型（13 大字段 + 自定义小字段 + 隐藏偏好）进入真实生成候选提示词。

F3/R-54 后"补充事实"模块退役，生成输入只来自当前组的新资料模型。守 Lead 集成层：
- 新类型（学术成果/知识产权/证书资质/语言能力）与自定义小字段确实进入模型提示词；
- 被用户隐藏的默认字段、以及 credential_number 永远不进入提示词。
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


def _create_entry(client, section_key: str, values: dict) -> dict:
    response = client.post(
        f"/api/profile/sections/{section_key}/entries", json={"values": values}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _hide_field(client, section_key: str, field_id: str) -> None:
    response = client.patch(
        f"/api/profile/field-preferences/{field_id}",
        json={"section_key": section_key, "hidden": True},
    )
    assert response.status_code == 200, response.text


def test_new_model_fields_reach_generation_prompt_without_private_fields(
    client, monkeypatch
):
    _seed_profile(client)
    _configure(client)
    field = client.post(
        "/api/profile/sections/projects/fields",
        json={"label": "合作方", "field_type": "single_line"},
    ).json()
    _create_entry(
        client,
        "projects",
        {
            "projects.name": "示例合作项目",
            "projects.description": "示例合作描述",
            field["field_id"]: "示例合作方",
        },
    )
    _create_entry(
        client,
        "publications",
        {
            "publications.title": "示例跨库事务一致性研究",
            "publications.authors": "张三",
            "publications.venue": "示例软件工程实践",
        },
    )
    _create_entry(
        client,
        "credentials",
        {
            "credentials.title": "示例注册护理师",
            "credentials.issuer": "示例卫生健康委员会",
            "credentials.credential_number": "SECRET-REAL-0001",
        },
    )
    _create_entry(
        client,
        "awards",
        {"awards.title": "示例护理技能竞赛二等奖", "awards.issuer": "示例护理学会"},
    )
    _create_entry(
        client,
        "languages",
        {
            "languages.language": "英语",
            "languages.level": "熟练",
            "languages.certificate": "CET-6",
            "languages.score": "560",
        },
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    # 通用简历（不按岗位筛选）：所有参与分区都进入候选，验证的是"内容进提示词"。
    started = client.post("/api/resumes/generate/tasks", json={})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed", final

    prompt = _prompt_text(holder[0])
    for expected in (
        "示例注册护理师",
        "示例护理技能竞赛二等奖",
        "示例跨库事务一致性研究",
        "合作方",
        "示例合作方",
        "CET-6",
    ):
        assert expected in prompt, expected
    # 私密证号（catalog private / llm_allowed=False）绝不进入提示词。
    assert "SECRET-REAL-0001" not in prompt


def test_hidden_default_field_does_not_reach_generation_prompt(client, monkeypatch):
    _seed_profile(client)
    _configure(client)
    _job(client)  # 岗位存在与否不影响通用简历路径；这里只复用脚手架
    _create_entry(
        client,
        "awards",
        {"awards.title": "示例优秀员工", "awards.issuer": "示例不出现单位"},
    )
    _hide_field(client, "awards", "awards.issuer")
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = client.post("/api/resumes/generate/tasks", json={})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed", final
    prompt = _prompt_text(holder[0])
    assert "示例优秀员工" in prompt
    # 用户隐藏的默认字段既不进候选、也不进提示词（值仍保留在库内，另行由 Q 验收守护）。
    assert "示例不出现单位" not in prompt

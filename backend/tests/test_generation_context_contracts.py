# SPDX-License-Identifier: Apache-2.0
"""G17/G18/G19：场景只影响表达，不改岗位、不改事实（从 wiring 拆出：行数预算）。

- G17：同一 JD、同一资料，换场景只换提示词里的表达块；两次生成的事实内容与 job_id 不变；
- G18：场景与岗位不匹配时，不换岗位、不因场景补造资格，仍按原 JD 生成；
- G19：通用简历 + 显式场景，job_id 仍为空，场景只提供表达建议。
"""

from __future__ import annotations

import pytest
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.document_test_support import values
from tests.resume_generate_task_support import _configure, _job, _seed_profile, _wait_terminal
from tests.test_generation_context_wiring import (
    _capture,
    _create_scenario,
    _prompt_text,
    _scenario_payload,
    _start_task,
)


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


# ===== G17/G18/G19：场景只影响表达，不改岗位、不改事实 =====


def test_two_scenarios_on_same_job_keep_facts_and_job_unchanged(client, monkeypatch):
    """G17：同一 JD、同一资料，换场景只换提示词里的表达块；事实内容与 job_id 不变。"""
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    first = _create_scenario(client, "场景一", target_function="数据分析")
    second = _create_scenario(
        client,
        "场景二",
        purpose="general",
        target_function="运营",
        target_industries=["消费品"],
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")
    records = []
    for scenario in (first, second):
        started = _start_task(client, job, _scenario_payload(scenario))
        assert started.status_code == 201, started.text
        final = _wait_terminal(client, started.json()["id"])
        assert final["status"] == "completed"
        record = client.get(f"/api/resumes/{final['resume_id']}").json()
        records.append(record)
        assert record["job_id"] == job["id"]
        assert record["context_snapshot"]["display_name"] == scenario["name"]

    # 场景不参与筛选与事实生成：假 provider 输出固定，两次内容必须一致
    # （v2 的 item/entry id 每次转换各自生成，按内容值对拍）。
    assert values(records[0]["content"]) == values(records[1]["content"])
    prompts = [_prompt_text(provider) for provider in holder]
    assert len(prompts) == 2
    assert "场景一" in prompts[0] and "场景二" in prompts[1]
    assert "场景二" not in prompts[0]
    for prompt in prompts:
        assert "受限场景参考" in prompt
        assert "不得推断就业状态" in prompt
    assert job["title"] in prompts[0] and job["title"] in prompts[1]


def test_unsuitable_scenario_keeps_job_and_adds_no_fabricated_qualification(
    client, monkeypatch
):
    """G18：场景与岗位不匹配时，不换岗位、不因场景补造资格，仍按原 JD 生成。"""
    _seed_profile(client)
    _configure(client)
    nursing = client.post(
        "/api/jobs", json={"title": "护士", "company": "示例医院"}
    ).json()
    academic = _create_scenario(
        client,
        "科研申请",
        purpose="research_application",
        career_stage="student",
        target_industries=["医疗健康"],
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = _start_task(client, nursing, _scenario_payload(academic))
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    # 岗位目标不变：仍绑定护理岗，而不是被场景改写成"科研岗"。
    assert record["job_id"] == nursing["id"]
    assert record["job_title"] == "护士"
    prompt = _prompt_text(holder[0])
    assert "科研申请" in prompt
    # 场景块只给表达约束，并且要求不得推断资格/证书。
    assert "不得推断就业状态、任职年限、资格" in prompt


def test_general_resume_with_scenario_keeps_null_job(client, monkeypatch):
    """G19：通用简历 + 显式场景：job_id 仍为空，场景只提供表达建议。"""
    _seed_profile(client)
    _configure(client)
    scenario = _create_scenario(
        client,
        "通用表达",
        purpose="general",
        target_function="",
    )
    holder = _capture(monkeypatch, "app.services.resume.resume_generate_runner")

    started = client.post(
        "/api/resumes/generate/tasks",
        json={"options": {"career_context": _scenario_payload(scenario)}},
    )
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "completed"
    record = client.get(f"/api/resumes/{final['resume_id']}").json()
    assert record["job_id"] is None
    assert record["context_snapshot"]["display_name"] == "通用表达"
    prompt = _prompt_text(holder[0])
    assert "通用简历" in prompt
    assert "通用表达" in prompt

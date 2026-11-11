# SPDX-License-Identifier: Apache-2.0
"""#18A 接线：task_create 落参数、API start/resume 拉起执行器、重启恢复后仍能续。

这些用例只测"接线"，执行器行为本身在 test_assistant_task_runner.py。
"""

from __future__ import annotations

import json

from app.models.agent_task import AgentTask
from app.services import agent_task_service
from app.services import assistant_task_runner as runner_module
from app.services.assistant_task_handler_common import clear_all_task_state
from app.services.assistant_task_handlers import execute_step
from app.services.assistant_tools import task_tools
from assistant_task_fixtures import create_job, create_resume, make_task


def test_task_create_persists_execution_params_for_four_kinds(client, db_session):
    resume_id = create_resume(client)
    job_ids = [
        create_job(client, "后端开发工程师"),
        create_job(client, "前端开发工程师", "示例网络"),
    ]
    cases = [
        (
            "resume_batch_edit",
            {"resume_id": resume_id, "section": "", "instruction": "按 STAR 重写"},
            {
                "kind": "resume_batch_edit",
                "resume_id": resume_id,
                "section": "",
                "instruction": "按 STAR 重写",
            },
        ),
        (
            "job_import",
            {"url": "https://jobs.example.com/campus/position", "limit": 5},
            {"kind": "job_import", "url": "https://jobs.example.com/campus/position", "limit": 5},
        ),
        ("match_batch", {"job_ids": job_ids}, {"kind": "match_batch", "job_ids": job_ids}),
        (
            "greeting_batch",
            {"job_ids": job_ids, "template": "您好"},
            {"kind": "greeting_batch", "job_ids": job_ids, "template": "您好"},
        ),
    ]
    for kind, raw_params, expected in cases:
        result = task_tools._tool_task_create(db_session, {"kind": kind, "params": raw_params})
        task_id = int(json.loads(result.text)["task_id"])
        db_session.expire_all()
        row = db_session.get(AgentTask, task_id)
        assert row is not None
        assert row.source == "assistant"
        assert row.params == expected, kind


def test_task_create_rejects_oversized_params(db_session):
    # 直接走服务层：超过 4000 字符的参数必须被显式拒绝（不撑大任务行）。
    from app.services.agent_task_service import AgentTaskError

    try:
        agent_task_service.create_task(
            db_session,
            title="脏参数",
            steps=["一步"],
            source="assistant",
            params={"kind": "job_import", "blob": "x" * 5000},
        )
    except AgentTaskError as exc:
        assert "任务参数" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("超长 params 应当被拒绝")


def test_start_and_resume_endpoints_kick_runner_for_assistant_only(client, db_session, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        runner_module.runner, "start", lambda task_id: calls.append(task_id) or True
    )
    assistant_task = agent_task_service.create_task(
        db_session,
        title="助手任务",
        steps=[{"title": "一步", "kind": "x"}],
        source="assistant",
        params={"kind": "mystery_kind"},
    )
    started = client.post(f"/api/agent-tasks/{assistant_task.id}/start")
    assert started.status_code == 200, started.text
    assert calls == [assistant_task.id]
    detail = client.get(f"/api/agent-tasks/{assistant_task.id}").json()
    assert detail["params"]["kind"] == "mystery_kind"

    manual_task = agent_task_service.create_task(db_session, title="手动任务", steps=["一步"])
    manual_started = client.post(f"/api/agent-tasks/{manual_task.id}/start")
    assert manual_started.status_code == 200
    assert calls == [assistant_task.id], "手动任务不启动助手执行器"

    agent_task_service.pause(db_session, assistant_task.id)
    resumed = client.post(f"/api/agent-tasks/{assistant_task.id}/resume")
    assert resumed.status_code == 200, resumed.text
    assert calls == [assistant_task.id, assistant_task.id], "resume 也要拉起执行器"


def test_recovery_pauses_then_resume_continues_and_progress_is_readable(
    client, db_session, monkeypatch
):
    from app.services.agent_task_recovery import recover_running_tasks

    job_ids = [create_job(client, "后端开发工程师")]
    task = make_task(
        db_session,
        kind="match_batch",
        params={"job_ids": job_ids},
        steps=(("读取", "read"), ("匹配", "match"), ("汇总", "report")),
    )
    current = agent_task_service.get_task(db_session, task.id)
    agent_task_service.mark_step_running(db_session, task.id, 0)
    read_result = execute_step(db_session, current, current.steps[0])
    assert read_result.ok
    agent_task_service.advance_step(db_session, task.id, 0, output_ref=read_result.output_ref)

    assert recover_running_tasks(db_session) == 1
    detail = client.get(f"/api/agent-tasks/{task.id}").json()
    assert detail["status"] == "paused"
    assert detail["resume_cursor"] == 1
    assert detail["steps"][0]["status"] == "done"

    # resume 端点会拉起执行器线程；测试里替换成记录调用，随后用同步核心跑完。
    monkeypatch.setattr(runner_module.runner, "start", lambda task_id: True)
    resumed = client.post(f"/api/agent-tasks/{task.id}/resume")
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "running"
    final = runner_module.run_task_once(db_session, task.id)
    assert final.status == "done", final.error
    assert final.steps[0].output_ref == read_result.output_ref
    clear_all_task_state()

# SPDX-License-Identifier: Apache-2.0
"""T19 任务层验收：跨轮推进 / 等待审批 / 重启恢复 / 幂等重试（+ 状态机与越权）。

用 conftest 的 `client`（真实 REST + lifespan）与 `db_session`（直接读业务行）组合：
两者在同一个测试进程里指向同一个测试库，所以可以"经 API 写、用会话断言行"。

四个验收点对应 T18 Gate 的四问：
a. 跨轮推进：建 3 步任务，连续三次 complete，每步之间读 GET 确认游标前进 → done；
b. 等待审批：停在 waiting_approval 的任务不会被任何自动逻辑（启动恢复）放行；
c. 重启恢复：running → paused（**断言不是 failed**），resume 后从下一步继续；
d. 幂等重试：同一步 complete 两次，业务行数 / attempt / output_ref 只变化一次。
"""

from __future__ import annotations

import pytest
from app.models.agent_task import (
    AGENT_TASK_STEP_STATUS_DONE,
    AGENT_TASK_STEP_STATUS_PENDING,
    AgentTask,
    AgentTaskStep,
)
from app.services import agent_task_service


def _create(client, steps, *, title="整理岗位并改写简历", source="manual", **extra):
    payload = {"title": title, "steps": steps, "source": source, **extra}
    response = client.post("/api/agent-tasks", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _get(client, task_id):
    response = client.get(f"/api/agent-tasks/{task_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _complete(client, task_id, step_index, **body):
    return client.post(f"/api/agent-tasks/{task_id}/steps/{step_index}/complete", json=body)


def _step_statuses(snapshot):
    return [step["status"] for step in snapshot["steps"]]


# ===== a. 跨轮推进 =====


def test_task_advances_across_turns_until_done(client):
    """三次 complete 每次推进一格游标；中间态可读，终态是 done。"""
    task = _create(client, ["收集岗位要求", "改写简历要点", "导出 PDF"])
    task_id = task["id"]
    assert task["status"] == "draft"
    assert task["resume_cursor"] == 0
    assert _step_statuses(task) == ["pending"] * 3

    for index in range(3):
        response = _complete(client, task_id, index)
        assert response.status_code == 200, response.text
        advanced = response.json()
        assert advanced["resume_cursor"] == index + 1
        # 每次之间读一次 GET：确认落库状态（而不只是响应体）也在前进。
        snapshot = _get(client, task_id)
        assert snapshot["resume_cursor"] == index + 1
        assert _step_statuses(snapshot)[: index + 1] == ["done"] * (index + 1)
        assert snapshot["steps"][index]["finished_at"] is not None
        if index < 2:
            assert snapshot["status"] == "running"
        else:
            assert snapshot["status"] == "done"
            assert snapshot["finished_at"] is not None

    # 列表接口带步骤摘要（"含 steps 摘要"）。
    listed = client.get("/api/agent-tasks").json()
    assert [item["id"] for item in listed] == [task_id]
    assert [step["status"] for step in listed[0]["steps"]] == ["done"] * 3


# ===== b. 等待审批 =====


def test_waiting_approval_is_not_released_by_startup_recovery(client, db_session):
    """停在 waiting_approval 的任务：自动恢复不得放行，状态/游标/步骤/时间戳都不变。"""
    task = _create(client, ["生成计划", "提交给用户确认", "执行写入"])
    task_id = task["id"]
    assert _complete(client, task_id, 0).status_code == 200
    assert _get(client, task_id)["status"] == "running"

    agent_task_service.mark_waiting_approval(db_session, task_id)
    waiting = _get(client, task_id)
    assert waiting["status"] == "waiting_approval"
    assert _step_statuses(waiting) == ["done", "waiting_approval", "pending"]
    before = (waiting["resume_cursor"], waiting["updated_at"], waiting["steps"])

    # 启动恢复是唯一的自动收尾逻辑：连续跑多次都不得放行（不占线程、不自动执行）。
    assert agent_task_service.recover_running_tasks(db_session) == 0
    assert agent_task_service.recover_running_tasks(db_session) == 0

    after = _get(client, task_id)
    assert after["status"] == "waiting_approval"
    assert after["status"] != "failed"
    assert (after["resume_cursor"], after["updated_at"], after["steps"]) == before


# ===== c. 重启恢复 =====


def test_restart_marks_running_task_paused_not_failed_and_resumes(client, db_session):
    """running → paused（不是 failed）；resume 后从下一步继续，已完成步骤不重跑。"""
    task = _create(client, ["第一步", "第二步", "第三步"])
    task_id = task["id"]
    assert _complete(client, task_id, 0).status_code == 200
    assert _get(client, task_id)["status"] == "running"

    assert agent_task_service.recover_running_tasks(db_session) == 1

    recovered = _get(client, task_id)
    assert recovered["status"] == "paused"
    assert recovered["status"] != "failed", "重启语义必须是暂停，不是失败"
    assert recovered["finished_at"] is None
    assert recovered["resume_cursor"] == 1

    resumed = client.post(f"/api/agent-tasks/{task_id}/resume")
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "running"

    # 已完成的第 0 步不重跑：再 complete 它是幂等空转，游标停在 1。
    replay = _complete(client, task_id, 0)
    assert replay.status_code == 200, replay.text
    assert replay.json()["resume_cursor"] == 1
    assert _step_statuses(replay.json()) == ["done", "pending", "pending"]
    assert _complete(client, task_id, 1).status_code == 200
    assert _complete(client, task_id, 2).status_code == 200
    final = _get(client, task_id)
    assert final["status"] == "done"
    assert final["resume_cursor"] == 3


# ===== d. 幂等重试 =====


def test_completing_the_same_step_twice_has_one_side_effect(client, db_session):
    """同一步 complete 两次：业务行数、attempt、output_ref 都只变化一次。"""
    task = _create(client, ["写入一条记录", "校验结果"])
    task_id = task["id"]

    first = _complete(client, task_id, 0, output_ref={"record_id": 7}, attempt=2)
    assert first.status_code == 200, first.text
    assert first.json()["steps"][0]["attempt"] == 2

    db_session.expire_all()
    rows = db_session.query(AgentTaskStep).filter_by(task_id=task_id, step_index=0)
    assert rows.count() == 1, "重试不得新增步骤行（唯一键 = task_id + step_index）"
    assert rows.one().attempt == 2

    # 第二次换一个 output_ref 重试：返回幂等快照，不覆盖第一次的产物、不增加尝试次数。
    second = _complete(client, task_id, 0, output_ref={"record_id": 8}, attempt=9)
    assert second.status_code == 200, second.text
    payload = second.json()
    assert payload["resume_cursor"] == 1
    assert payload["steps"][0]["output_ref"] == {"record_id": 7}
    assert payload["steps"][0]["attempt"] == 2
    assert payload["steps"][0]["status"] == "done"

    db_session.expire_all()
    assert db_session.query(AgentTask).filter_by(id=task_id).count() == 1
    assert db_session.query(AgentTaskStep).filter_by(task_id=task_id).count() == 2, (
        "任务始终是 2 个步骤行"
    )
    assert (
        db_session.query(AgentTaskStep)
        .filter_by(task_id=task_id)
        .filter(AgentTaskStep.status == AGENT_TASK_STEP_STATUS_DONE)
        .count()
        == 1
    )


# ===== 状态机 / 数据集归属 / 请求模型 =====


def test_illegal_transitions_raise_value_error_and_api_returns_409(client, db_session):
    """非法迁移显式抛 ValueError（不静默），API 映射 409 且状态不变。"""
    task = _create(client, ["唯一一步"])
    task_id = task["id"]
    assert _complete(client, task_id, 0).status_code == 200
    assert _get(client, task_id)["status"] == "done"

    with pytest.raises(ValueError, match="不能暂停"):
        agent_task_service.pause(db_session, task_id)
    with pytest.raises(ValueError, match="不能取消"):
        agent_task_service.cancel(db_session, task_id)

    for path, detail in (("pause", "不能暂停"), ("resume", "只有 paused"), ("cancel", "不能取消")):
        response = client.post(f"/api/agent-tasks/{task_id}/{path}")
        assert response.status_code == 409, response.text
        assert detail in response.json()["detail"]
    assert _get(client, task_id)["status"] == "done"

    # 跳步同样拒绝：仍是 3 步任务时，未完成第 0 步不能直接完成第 2 步。
    other = _create(client, ["A", "B", "C"])
    skipped = _complete(client, other["id"], 2)
    assert skipped.status_code == 409
    assert _get(client, other["id"])["resume_cursor"] == 0


def test_write_on_another_dataset_row_is_rejected(client, db_session):
    """写入前校验 dataset_key：别的数据集的行按"不存在"处理，状态不被改动。"""
    task = _create(client, ["跨数据集写入"])
    task_id = task["id"]
    row = db_session.get(AgentTask, task_id)
    row.dataset_key = "another-dataset"
    db_session.commit()

    response = _complete(client, task_id, 0)
    assert response.status_code == 404, response.text

    db_session.expire_all()
    row = db_session.get(AgentTask, task_id)
    assert row.status == "draft" and row.resume_cursor == 0
    step = db_session.query(AgentTaskStep).filter_by(task_id=task_id).one()
    assert step.status == AGENT_TASK_STEP_STATUS_PENDING


def test_request_models_forbid_unknown_fields_and_list_filters(client):
    """请求模型 extra="forbid"；列表支持 conversation_id / status 过滤。"""
    rejected = client.post("/api/agent-tasks", json={"title": "x", "steps": ["a"], "unknown": 1})
    assert rejected.status_code == 422, rejected.text
    empty_steps = client.post("/api/agent-tasks", json={"title": "x", "steps": []})
    assert empty_steps.status_code == 422, empty_steps.text

    alone = _create(client, ["单独任务"], title="任务一")
    in_conversation = _create(client, ["会话任务"], title="任务二", conversation_id=42)
    assert _complete(client, alone["id"], 0).status_code == 200

    in_conversation_list = client.get("/api/agent-tasks", params={"conversation_id": 42}).json()
    # 会话过滤的语义是「本会话的任务 **加** 数据集级任务（conversation_id 为空）」：
    # 提醒到期生成的任务卡不属于任何会话，但必须出现在每个会话的任务区里，否则永远
    # 不可达（T26 收尾）。跨会话仍然隔离——别的会话的任务不会出现在这里。
    assert [item["id"] for item in in_conversation_list] == [
        in_conversation["id"],
        alone["id"],
    ]
    other_conversation = client.get("/api/agent-tasks", params={"conversation_id": 43}).json()
    assert [item["id"] for item in other_conversation] == [alone["id"]]
    done_list = client.get("/api/agent-tasks", params={"status": "done"}).json()
    assert [item["id"] for item in done_list] == [alone["id"]]
    assert client.get("/api/agent-tasks", params={"status": "bogus"}).status_code == 400


# ===== T20：start / wait-approval 端点 =====


def test_start_endpoint_moves_draft_to_running_and_is_idempotent(client):
    """start 把 draft 任务变成 running；重复 start 幂等；终态不允许 start。"""
    task = _create(client, ["第一步", "第二步"])
    task_id = task["id"]
    assert task["status"] == "draft"

    started = client.post(f"/api/agent-tasks/{task_id}/start")
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "running"

    again = client.post(f"/api/agent-tasks/{task_id}/start")
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "running"

    # 完成两步 → done；done 再 start 是非法迁移（409，不静默）。
    assert _complete(client, task_id, 0).status_code == 200
    assert _complete(client, task_id, 1).status_code == 200
    assert client.post(f"/api/agent-tasks/{task_id}/start").status_code == 409
    assert _get(client, task_id)["status"] == "done"


def test_wait_approval_endpoint_targets_current_step_and_is_idempotent(client, db_session):
    """wait-approval 只能指定当前步骤；同一步重复调用幂等（无第二次副作用）。"""
    task = _create(client, ["准备计划", "等待确认", "执行写入"])
    task_id = task["id"]
    assert client.post(f"/api/agent-tasks/{task_id}/start").status_code == 200
    assert _complete(client, task_id, 0).status_code == 200

    response = client.post(f"/api/agent-tasks/{task_id}/steps/1/wait-approval")
    assert response.status_code == 200, response.text
    waiting = response.json()
    assert waiting["status"] == "waiting_approval"
    assert _step_statuses(waiting) == ["done", "waiting_approval", "pending"]
    assert waiting["resume_cursor"] == 1

    # 幂等：重复调用同一当前步骤返回同一快照，不产生第二次写（updated_at 也不变）。
    replay = client.post(f"/api/agent-tasks/{task_id}/steps/1/wait-approval")
    assert replay.status_code == 200, replay.text
    assert replay.json() == waiting

    # 非当前步骤（已经完成的 0 / 还没到的 2）一律 409，状态不被改动。
    for skipped_index in (0, 2):
        refused = client.post(f"/api/agent-tasks/{task_id}/steps/{skipped_index}/wait-approval")
        assert refused.status_code == 409, refused.text
        assert "当前步骤" in refused.json()["detail"]
    assert _get(client, task_id)["status"] == "waiting_approval"

    # 自动恢复不得放行这个状态（T18 §2 在 T20 新端点上的同一断言）。
    assert agent_task_service.recover_running_tasks(db_session) == 0
    assert _get(client, task_id)["status"] == "waiting_approval"

    # 用户确认后完成这一步：waiting_approval 起点允许完成，任务回到 running。
    completed = _complete(client, task_id, 1)
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "running"
    assert completed.json()["resume_cursor"] == 2

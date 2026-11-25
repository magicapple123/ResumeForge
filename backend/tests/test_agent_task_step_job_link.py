# SPDX-License-Identifier: Apache-2.0
"""CR-19：任务步骤的只读 ``job_id``（首页任务卡的「岗位」跳转要它）。

巡检卡（``source="followup"``）的每个步骤用 ``output_ref={"track_id": …}`` 指回一条
求职进度；首页要在步骤行上给一个「打开这个岗位」的链接，而链接参数是 ``job_id``。
``job_id`` 落在 ``application_track`` 上，所以这里由接口层**批查询**补齐：

- 有 ``track_id`` 且进度还挂着岗位 → 步骤带 ``job_id``；
- 旧卡（没有 ``output_ref`` / 进度已删 / 进度没挂岗位）→ ``job_id`` 为 ``null``，
  接口照常返回，不因为补不出链接就 500 或整卡消失。

``job_id`` 是**只读派生字段**，不在任何请求模型里——它不是可写状态。
"""

from __future__ import annotations

from app.models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_STATUS_DRAFT,
    AgentTask,
    AgentTaskStep,
)
from app.models.job import Job
from app.models.tracker import ApplicationTrack, normalize_key


def _make_track(job_id: int | None, company: str) -> ApplicationTrack:
    return ApplicationTrack(
        company=company,
        title="后端开发",
        company_key=normalize_key(company),
        title_key=normalize_key("后端开发"),
        status="applied",
        job_id=job_id,
    )


def _make_task(steps: list[AgentTaskStep], title: str = "巡检：2 个岗位") -> int:
    task = AgentTask(
        conversation_id=None,
        title=title,
        goal="",
        status=AGENT_TASK_STATUS_DRAFT,
        resume_cursor=0,
        source=AGENT_TASK_SOURCE_FOLLOWUP,
        steps=steps,
    )
    from app.database import SessionLocal

    with SessionLocal() as db:
        db.add(task)
        db.commit()
        return int(task.id)


def test_step_job_id_filled_from_track(client, db_session):
    """步骤 → track_id → 岗位：详情与列表都带同一个 job_id。"""
    job = Job(title="后端开发", company="甲公司")
    db_session.add(job)
    db_session.commit()
    track = _make_track(job.id, "甲公司")
    db_session.add(track)
    db_session.commit()

    task_id = _make_task(
        [
            AgentTaskStep(
                step_index=0,
                kind="followup",
                title="跟进：甲公司 · 后端开发",
                output_ref={"track_id": int(track.id)},
            )
        ]
    )

    detail = client.get(f"/api/agent-tasks/{task_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["steps"][0]["job_id"] == job.id

    listing = client.get("/api/agent-tasks")
    assert listing.status_code == 200, listing.text
    row = next(item for item in listing.json() if item["id"] == task_id)
    assert row["steps"][0]["job_id"] == job.id


def test_old_step_without_track_reference_keeps_null(client):
    """旧卡没有 output_ref：job_id 为 null，接口不报错。"""
    task_id = _make_task([AgentTaskStep(step_index=0, kind="followup", title="跟进：乙公司")])

    detail = client.get(f"/api/agent-tasks/{task_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["steps"][0]["job_id"] is None


def test_step_job_id_null_when_track_has_no_job(client, db_session):
    """进度没挂岗位（手动记的一条）：补不出 job_id，但 track_id 本身仍然存在。"""
    track = _make_track(None, "丙公司")
    db_session.add(track)
    db_session.commit()

    task_id = _make_task(
        [
            AgentTaskStep(
                step_index=0,
                kind="followup",
                title="跟进：丙公司 · 后端开发",
                output_ref={"track_id": int(track.id)},
            )
        ]
    )

    detail = client.get(f"/api/agent-tasks/{task_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["steps"][0]["job_id"] is None

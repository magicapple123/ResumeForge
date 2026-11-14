# SPDX-License-Identifier: Apache-2.0
"""F36：用户消息 context 里的岗位/简历标题快照。

消息气泡要显示「本轮引用」，但 context 原本只有 ID——岗位改名或删除后界面只剩 `#12`。
这里守四件事：

1. 选了岗位：`job_title` / `job_company` 与 `job_id` 一起落进 metadata；
2. 只选其中一个时，另一个来源的键**不存在**（不是空串），前端据此决定不渲染那一行；
3. 对象已被删除时照旧抛错（上层转 404），不会写出半个快照；
4. 重新生成的重放只读 `job_id` / `resume_id`，多出来的展示键既不影响也不回灌。
"""

from __future__ import annotations

import pytest
from app.api.assistant_regenerate_api import AssistantRegenerateRequest, _replay_payload
from app.models.assistant import ChatMessage
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.schemas.assistant import AssistantMessageCreate
from app.services.assistant.assistant_context import load_local_context


def _seed_job(db_session, *, title: str = "用户增长运营", company: str = "示例网络科技") -> Job:
    job = Job(title=title, company=company, description="负责增长实验与渠道投放。")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _seed_resume(db_session, *, title: str = "增长运营简历") -> ResumeRecord:
    resume = ResumeRecord(title=title, content={"name": "张示例", "summary": "增长方向"})
    db_session.add(resume)
    db_session.commit()
    db_session.refresh(resume)
    return resume


def test_job_selection_snapshots_title_and_company(db_session):
    job = _seed_job(db_session)
    payload = AssistantMessageCreate(content="按这个岗位改简历。", job_id=job.id)

    _blocks, metadata = load_local_context(db_session, payload)

    assert metadata["job_id"] == job.id
    assert metadata["job_title"] == "用户增长运营"
    assert metadata["job_company"] == "示例网络科技"
    # 没选简历时不该出现简历键：前端按「键存在」决定渲染引用片。
    assert "resume_title" not in metadata


def test_resume_selection_snapshots_title(db_session):
    resume = _seed_resume(db_session)
    payload = AssistantMessageCreate(content="这份简历有什么问题？", resume_id=resume.id)

    _blocks, metadata = load_local_context(db_session, payload)

    assert metadata["resume_id"] == resume.id
    assert metadata["resume_title"] == "增长运营简历"
    assert "job_title" not in metadata
    assert "job_company" not in metadata


def test_both_selections_carry_both_snapshots(db_session):
    job = _seed_job(db_session)
    resume = _seed_resume(db_session)
    payload = AssistantMessageCreate(content="对比一下。", job_id=job.id, resume_id=resume.id)

    _blocks, metadata = load_local_context(db_session, payload)

    assert metadata["job_title"] == job.title
    assert metadata["resume_title"] == resume.title


def test_deleted_job_still_fails_instead_of_writing_partial_snapshot(db_session):
    payload = AssistantMessageCreate(content="按这个岗位改简历。", job_id=987_654)

    with pytest.raises(ValueError, match="岗位"):
        load_local_context(db_session, payload)


def test_regenerate_replay_ignores_snapshot_keys(db_session):
    """重放只认 id：历史 context 里多出的标题键既不能顶替 id，也不能带进新请求。"""
    user_message = ChatMessage(
        conversation_id=1,
        role="user",
        content="按这个岗位改简历。",
        context={
            "job_id": 7,
            "resume_id": 9,
            "job_title": "旧标题",
            "job_company": "旧公司",
            "resume_title": "旧简历",
        },
    )

    replay = _replay_payload(user_message, AssistantRegenerateRequest())

    assert replay.job_id == 7
    assert replay.resume_id == 9
    assert "job_title" not in replay.model_dump()
    assert "resume_title" not in replay.model_dump()

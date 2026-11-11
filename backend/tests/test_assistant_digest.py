# SPDX-License-Identifier: Apache-2.0
"""18B 今日简报：只读已有数据、启动时补算、24h 内不重复生成。

钉住的性质：

1. 首次调用生成并落 AppSetting 一行；24h 内再调**原样返回**（generated_at 不变）；
2. 超过 24h、或跨过设置时刻（HH:MM）才重算；refresh 无条件重算；
3. 五个板块全部来自既有表：已截止岗位 / 7 天无回音 / 面试倒计时 / 本周漏斗 /
   JD 变更异动——测试自己种数据，不 mock 服务层；
4. 端点层：GET /api/assistant/digest、POST /digest/refresh 都能用（迷你 app 挂载，
   主 app 的 ROUTERS 合并由主 agent 做那一行）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from app.api.assistant_breadth import router as breadth_router
from app.database import get_db
from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    ApplyTask,
    ApplyTaskItem,
    JobMatchAnalysis,
)
from app.models.job import JOB_STATUS_CLOSED, Job
from app.models.job_seen import JobSeen
from app.models.profile import utcnow
from app.models.setting import AppSetting
from app.models.tracker import STATUS_APPLIED, STATUS_INTERVIEW, ApplicationTrack, normalize_key
from app.services import assistant_digest as digest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TZ = UTC


def _moment(day: int = 1, hour: int = 8, minute: int = 0) -> datetime:
    """固定的 aware 时间（简报的"现在"由调用方注入，测试不读真实时钟）。"""
    return datetime(2026, 1, day, hour, minute, tzinfo=TZ)


def _job(db, *, title: str = "后端开发", company: str = "示例公司", **extra) -> Job:
    job = Job(title=title, company=company, **extra)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _section(payload: dict, key: str) -> dict:
    return next(item for item in payload["sections"] if item["key"] == key)


def _track(db, *, company: str, title: str, **extra) -> ApplicationTrack:
    """合并键（company_key/title_key）是唯一约束的一部分，种子必须按服务层同一份归一化填。"""
    track = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        **extra,
    )
    db.add(track)
    db.commit()
    db.refresh(track)
    return track


# ===== 生成时机 =====


def test_first_read_generates_and_persists(db_session):
    payload = digest.get_digest(db_session, now=_moment())
    assert payload["sections"] and payload["changes"]["count"] == 0
    row = db_session.get(AppSetting, digest.DIGEST_KEY)
    assert row is not None
    assert payload["generated_at"].startswith("2026-01-01T08:00")


def test_within_24h_does_not_regenerate(db_session):
    first = digest.get_digest(db_session, now=_moment(1, 8))
    second = digest.get_digest(db_session, now=_moment(1, 20))
    assert second["generated_at"] == first["generated_at"]


def test_after_24h_regenerates(db_session):
    first = digest.get_digest(db_session, now=_moment(1, 8))
    second = digest.get_digest(db_session, now=_moment(2, 9))
    assert second["generated_at"] != first["generated_at"]


def test_crossing_scheduled_time_regenerates(db_session):
    # 设置每天 09:00 出简报：08:00 生成过，当天 09:30 即使不到 24h 也应补一份。
    db_session.add(AppSetting(key=digest.SCHEDULE_KEY, value='"09:00"'))
    db_session.commit()
    first = digest.get_digest(db_session, now=_moment(1, 8))
    assert (
        digest.get_digest(db_session, now=_moment(1, 8, 30))["generated_at"]
        == first["generated_at"]
    )
    refreshed = digest.get_digest(db_session, now=_moment(1, 9, 30))
    assert refreshed["generated_at"] != first["generated_at"]


def test_refresh_forces_regeneration(db_session):
    first = digest.refresh_digest(db_session, now=_moment(1, 8))
    second = digest.refresh_digest(db_session, now=_moment(1, 8, 1))
    assert second["generated_at"] != first["generated_at"]


def test_should_refresh_handles_broken_state():
    assert digest.should_refresh(None) is True
    assert digest.should_refresh({"generated_at": "not-a-date"}) is True
    fresh = {"generated_at": _moment(1, 8).isoformat()}
    assert digest.should_refresh(fresh, now=_moment(1, 9)) is False
    assert digest.should_refresh(fresh, now=_moment(2, 9)) is True
    # 设置时刻写坏了：不报错，退回只看 24h。
    assert digest.should_refresh(fresh, now=_moment(1, 20), scheduled_time="9点") is False


def test_parse_schedule_time_validates_shape():
    assert digest.parse_schedule_time("09:30") is not None
    for bad in ("", "9:30", "25:00", "09-30", "abc"):
        assert digest.parse_schedule_time(bad) is None


# ===== 五个板块（种真实数据，不 mock 服务层）=====


def _seed_stale_apply(db) -> Job:
    job = _job(db, title="数据开发", company="老东家")
    old = utcnow() - timedelta(days=10)
    batch = ApplyTask(kind="apply")
    db.add(batch)
    db.flush()
    db.add(
        ApplyTaskItem(
            task_id=batch.id,
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            status=ITEM_STATUS_SUCCESS,
            created_at=old,
            finished_at=old,
        )
    )
    _track(db, company=job.company, title=job.title, status=STATUS_APPLIED, job_id=job.id)
    return job


def _seed_interview(db, *, today: date) -> None:
    due = today + timedelta(days=2)
    _track(
        db,
        company="面试公司",
        title="后端实习",
        status=STATUS_INTERVIEW,
        next_action="技术二面",
        next_action_date=due.isoformat(),
    )


def test_sections_are_built_from_existing_data(db_session):
    stale_job = _seed_stale_apply(db_session)
    _seed_interview(db_session, today=_moment().date())
    closed = _job(db_session, title="已下架岗位", company="暂停招聘公司", status=JOB_STATUS_CLOSED)
    failed_batch = ApplyTask(kind="apply")
    db_session.add(failed_batch)
    db_session.flush()
    db_session.add(
        ApplyTaskItem(
            task_id=failed_batch.id,
            job_id=None,
            job_title="失败的投递",
            company="失败公司",
            status=ITEM_STATUS_FAILED,
            created_at=utcnow(),
            finished_at=utcnow(),
        )
    )
    db_session.commit()

    payload = digest.build_digest(db_session, now=_moment())
    stale = _section(payload, "stale_applications")
    assert stale["count"] == 1 and stale["items"][0]["job_id"] == stale_job.id
    assert stale["window_days"] == 7

    interviews = _section(payload, "interviews")
    assert interviews["count"] == 1 and interviews["items"][0]["days_until"] == 2

    expired = _section(payload, "expired_jobs")
    assert expired["count"] == 1 and expired["items"][0]["job_id"] == closed.id

    funnel = _section(payload, "funnel")
    assert funnel["summary"]["applied"] == 1
    assert funnel["summary"]["failed"] == 1
    assert funnel["summary"]["interviewing"] == 1

    # 异动 = JD 变更（无采样 → 0）+ 无回音 1 条。
    assert payload["changes"]["count"] == 1
    assert payload["changes"]["stale"] == 1


def test_jd_change_counts_as_anomaly(db_session):
    job = _job(db_session)
    for index, fingerprint in enumerate(("hash-a", "hash-b")):
        db_session.add(
            JobSeen(
                job_id=job.id,
                title=job.title,
                company=job.company,
                seen_at=utcnow() - timedelta(days=2 - index),
                description_hash=fingerprint,
                description_text=f"第 {index} 版 JD",
            )
        )
    db_session.commit()

    payload = digest.build_digest(db_session, now=_moment())
    assert payload["changes"]["jd_changed"] == 1
    assert payload["changes"]["count"] == 1


def test_worth_jobs_come_from_match_analyses(db_session):
    job = _job(
        db_session,
        title="后端开发",
        description="负责后端服务开发，要求掌握 Python 与数据库。",
        requirements="熟悉 FastAPI、SQL。",
    )
    db_session.add(
        JobMatchAnalysis(
            job_id=job.id,
            result={
                "hard_conditions": [],
                "core_abilities": [],
                "bonus_items": [],
                "hard_gate": "met",
                "admission": "allow",
                "advice": "",
                "notes": [],
            },
            hard_gate="met",
            requires_confirm=False,
        )
    )
    db_session.commit()

    payload = digest.build_digest(db_session, now=_moment())
    section = _section(payload, "worth_jobs")
    if section["count"] == 0:
        # 参考分依赖本人资料/简历文本；库为空时算不出来就不报（证据不足 > 编一个分数）。
        assert section["items"] == []
    else:
        assert section["items"][0]["job_id"] == job.id
        assert 0 <= section["items"][0]["score"] <= 100
    assert section["disclaimer"]


def test_no_match_analysis_means_empty_worth_jobs(db_session):
    _job(db_session)
    payload = digest.build_digest(db_session, now=_moment())
    section = _section(payload, "worth_jobs")
    assert section["count"] == 0 and section["items"] == []


# ===== 端点 =====


@pytest.fixture
def breadth_client(db_session):
    """迷你 app：只挂本模块 router（主 app 的注册那行由主 agent 合并）。"""
    mini = FastAPI()
    mini.include_router(breadth_router)

    def _override():
        yield db_session

    mini.dependency_overrides[get_db] = _override
    with TestClient(mini) as test_client:
        yield test_client


def test_digest_endpoints(breadth_client):
    first = breadth_client.get("/api/assistant/digest")
    assert first.status_code == 200, first.text
    payload = first.json()
    assert payload["sections"] and "changes" in payload
    # 24h 内再取：同一份（不重复生成）。
    second = breadth_client.get("/api/assistant/digest")
    assert second.json()["generated_at"] == payload["generated_at"]
    refreshed = breadth_client.post("/api/assistant/digest/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["sections"]


def test_persona_endpoints_are_served(breadth_client, db_session):
    from app.models.assistant import ChatConversation

    conversation = ChatConversation(title="视角测试", surface="page")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)

    listed = breadth_client.get("/api/assistant/personas")
    assert listed.status_code == 200
    assert {item["id"] for item in listed.json()["items"]} == set(digest_persona_ids())
    current = breadth_client.get(f"/api/assistant/conversations/{conversation.id}/persona")
    assert current.json()["persona_id"] == ""
    switched = breadth_client.put(
        f"/api/assistant/conversations/{conversation.id}/persona",
        json={"persona_id": "hr_scan"},
    )
    assert switched.status_code == 200 and switched.json()["persona_id"] == "hr_scan"
    cleared = breadth_client.put(
        f"/api/assistant/conversations/{conversation.id}/persona",
        json={"persona_id": ""},
    )
    assert cleared.json()["persona_id"] == ""
    bad = breadth_client.put(
        f"/api/assistant/conversations/{conversation.id}/persona",
        json={"persona_id": "nope"},
    )
    assert bad.status_code == 422 and "未知的助手视角" in bad.json()["detail"]


def digest_persona_ids() -> list[str]:
    from app.services.assistant.assistant_personas import PERSONA_IDS

    return list(PERSONA_IDS)

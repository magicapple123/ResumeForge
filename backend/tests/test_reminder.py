# SPDX-License-Identifier: Apache-2.0
"""R-12 日历提醒：CRUD、upcoming 升序、绑定对象 SET NULL、软删除。

重点验证：
1. 增删改查完整可用，删除走软删除（列表不可见、行仍在）；
2. ``upcoming`` 只返回"还有未处理那一次"的 active 计划，按那一次的时刻升序；
3. 关联求职进度/岗位/简历后，被绑对象删除不连坐（外键 SET NULL）。

CR-28：``status`` 已收窄为 active/archived；``done``/``dismissed`` 仍是 PATCH 的动作
（落在 occurrence 上），单次提醒做完 → 计划归档，列表默认只看 active。
"""

from datetime import UTC, timedelta

from app.models.job import Job
from app.models.profile import utcnow
from app.models.reminder import Reminder
from app.models.resume import ResumeRecord
from app.models.tracker import ApplicationTrack
from app.services import trash
from app.services.reminder_service import reminder_days_until, reminder_urgency


def _job(db_session, title="后端开发工程师", company="示例公司") -> Job:
    job = Job(title=title, company=company, description="负责高并发服务")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def _track(db_session, status="applied") -> ApplicationTrack:
    track = ApplicationTrack(company="示例公司", title="后端开发工程师", status=status)
    db_session.add(track)
    db_session.commit()
    db_session.refresh(track)
    return track


def _resume(db_session) -> ResumeRecord:
    resume = ResumeRecord(title="我的简历", content={})
    db_session.add(resume)
    db_session.commit()
    db_session.refresh(resume)
    return resume


def test_create_list_patch_delete_round_trip(client):
    created = client.post(
        "/api/reminders",
        json={
            "title": "参加某司面试",
            "remind_at": "2026-09-21T10:00:00",
            "kind": "interview",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["title"] == "参加某司面试"
    assert body["kind"] == "interview"
    assert body["status"] == "active"

    assert len(client.get("/api/reminders").json()) == 1

    patched = client.patch(
        f"/api/reminders/{body['id']}", json={"status": "done", "note": "已面完"}
    )
    assert patched.status_code == 200, patched.text
    # 单次提醒做完 → 这次结束了、计划也跟着归档（不再出现在待办里）。
    assert patched.json()["status"] == "archived"
    assert patched.json()["note"] == "已面完"

    assert client.delete(f"/api/reminders/{body['id']}").status_code == 204
    assert client.get("/api/reminders").json() == []


def test_upcoming_only_pending_and_ascending(client):
    client.post(
        "/api/reminders",
        json={"title": "晚一点的提醒", "remind_at": "2026-10-02T09:00:00", "kind": "other"},
    )
    client.post(
        "/api/reminders",
        json={"title": "早一点的提醒", "remind_at": "2026-09-25T09:00:00", "kind": "hr_reply"},
    )
    done = client.post(
        "/api/reminders",
        json={"title": "已完成", "remind_at": "2026-09-20T09:00:00", "kind": "other"},
    ).json()
    client.patch(f"/api/reminders/{done['id']}", json={"status": "done"})

    upcoming = client.get("/api/reminders/upcoming").json()
    assert [item["title"] for item in upcoming] == ["早一点的提醒", "晚一点的提醒"]


def test_binding_job_hard_delete_sets_null(client, db_session):
    job = _job(db_session)
    track = _track(db_session)
    resume = _resume(db_session)

    created = client.post(
        "/api/reminders",
        json={
            "title": "绑定三个对象",
            "remind_at": "2026-09-22T10:00:00",
            "kind": "interview",
            "track_id": track.id,
            "job_id": job.id,
            "resume_id": resume.id,
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["job_id"] == job.id
    assert created.json()["track_id"] == track.id
    assert created.json()["resume_id"] == resume.id

    # 硬删除岗位：外键 SET NULL，提醒仍在、只是失去岗位关联。
    db_session.delete(job)
    db_session.commit()
    got = client.get("/api/reminders")
    assert got.status_code == 200
    item = [row for row in got.json() if row["id"] == created.json()["id"]][0]
    assert item["job_id"] is None
    assert item["track_id"] == track.id
    assert item["resume_id"] == resume.id


def test_delete_is_soft_and_hides_from_list(client, db_session):
    created = client.post(
        "/api/reminders",
        json={"title": "待删提醒", "remind_at": "2026-09-23T10:00:00"},
    ).json()

    assert client.delete(f"/api/reminders/{created['id']}").status_code == 204
    assert client.get("/api/reminders").json() == []

    db_session.expire_all()
    row = db_session.get(Reminder, created["id"])
    assert row is not None and trash.is_deleted(row)


def test_validation_rejects_blank_title_and_bad_kind(client):
    assert (
        client.post(
            "/api/reminders", json={"title": "  ", "remind_at": "2026-09-21T10:00:00"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/reminders",
            json={"title": "x", "remind_at": "2026-09-21T10:00:00", "kind": "unknown_kind"},
        ).status_code
        == 422
    )


def test_reminder_urgency_mapping_and_labels():
    now = utcnow().replace(hour=12, minute=0, second=0, microsecond=0)

    assert reminder_urgency(now - timedelta(days=2, hours=1), now) == ("overdue", "已逾期 2 天")
    assert reminder_urgency(now + timedelta(hours=2), now) == ("soon", "今天")
    assert reminder_urgency(now + timedelta(days=1), now) == ("soon", "明天")
    assert reminder_urgency(now + timedelta(hours=25), now) == ("upcoming", "明天")
    assert reminder_urgency(now + timedelta(days=3), now) == ("upcoming", "3 天后")
    assert reminder_urgency(now + timedelta(days=4), now) == ("later", "4 天后")


def test_reminder_days_until_matches_label_semantics():
    """结构化倒计时必须与历史中文标签同一口径（前端靠它自己拼文案）。"""
    now = utcnow().replace(hour=12, minute=0, second=0, microsecond=0)

    # 逾期不足 24 小时也按"1 天"算——与「已逾期 1 天」逐字一致。
    assert reminder_days_until(now - timedelta(hours=2), now) == -1
    assert reminder_urgency(now - timedelta(hours=2), now) == ("overdue", "已逾期 1 天")
    # 逾期 3 天整 → -3（不会因为多出的 0 小时变成 -2）。
    assert reminder_days_until(now - timedelta(days=3), now) == -3
    # 今天稍后 → 0；明天同一时刻 → 1；5 天后 → 5。
    assert reminder_days_until(now + timedelta(hours=2), now) == 0
    assert reminder_days_until(now + timedelta(days=1), now) == 1
    assert reminder_days_until(now + timedelta(days=5), now) == 5
    # 带时区的入参与无时区 now 混用时不抛 TypeError（统一走 _naive_utc）。
    assert reminder_days_until((now + timedelta(days=2)).replace(tzinfo=UTC), now) == 2


def _utc_iso(value) -> str:
    """把测试里的 naive UTC 时刻显式标成 UTC 再下发。

    CR-27 起，**裸 datetime 按本机时区解释**（助手给的是本地时间）；这里的 ``utcnow()``
    是 UTC 墙钟，不标时区会被当成"本地 12:00"而整体偏移一个时区，紧急度断言就会随
    测试机时区漂移。
    """
    return value.replace(tzinfo=UTC).isoformat()


def test_upcoming_enriches_urgency_and_sorts(client):
    now = utcnow()

    client.post(
        "/api/reminders", json={"title": "later", "remind_at": _utc_iso(now + timedelta(days=5))}
    )
    client.post(
        "/api/reminders", json={"title": "soon", "remind_at": _utc_iso(now + timedelta(hours=3))}
    )
    client.post(
        "/api/reminders", json={"title": "overdue", "remind_at": _utc_iso(now - timedelta(days=2))}
    )
    client.post(
        "/api/reminders", json={"title": "upcoming", "remind_at": _utc_iso(now + timedelta(days=2))}
    )

    data = client.get("/api/reminders/upcoming").json()
    assert [item["title"] for item in data] == ["overdue", "soon", "upcoming", "later"]

    by_title = {item["title"]: item for item in data}
    assert by_title["overdue"]["urgency"] == "overdue"
    assert by_title["overdue"]["due_label"] == "已逾期 2 天"
    assert by_title["soon"]["urgency"] == "soon"
    assert by_title["soon"]["due_label"] in {"今天", "明天"}
    assert by_title["upcoming"]["urgency"] == "upcoming"
    assert by_title["upcoming"]["due_label"] == "2 天后"
    assert by_title["later"]["urgency"] == "later"
    assert by_title["later"]["due_label"] == "5 天后"

    # 新增的结构化倒计时：出参必须带上，且与 due_label 同一口径。
    # （due_label 上面几条断言逐字未变——它是给旧前端/其它调用方的兼容字段。）
    for item in data:
        assert "days_until" in item
        assert isinstance(item["days_until"], int)
    assert by_title["overdue"]["days_until"] == -2
    assert by_title["soon"]["days_until"] in {0, 1}
    assert by_title["upcoming"]["days_until"] == 2
    assert by_title["later"]["days_until"] == 5


def test_list_route_enriches_urgency_and_days_until(client):
    """T06：列表接口在 ReminderOut 之外补 urgency / days_until（只给列表用）。

    逾期口径与首页「近期提醒」同一份实现（reminder_service）：刚过 2 小时也算
    「已逾期 1 天」，列表红标与筛选都靠这个 -1，不能在前端按小时重算。
    """
    now = utcnow()
    just_overdue = client.post(
        "/api/reminders",
        json={"title": "刚过两小时", "remind_at": _utc_iso(now - timedelta(hours=2))},
    ).json()
    future = client.post(
        "/api/reminders",
        json={"title": "五天后", "remind_at": _utc_iso(now + timedelta(days=5))},
    ).json()
    done = client.post(
        "/api/reminders",
        json={"title": "已完成", "remind_at": _utc_iso(now - timedelta(days=2))},
    ).json()
    client.patch(f"/api/reminders/{done['id']}", json={"status": "done"})

    listed = client.get("/api/reminders").json()
    by_id = {item["id"]: item for item in listed}

    # 每条列表项都带两个派生字段（不是只给逾期项）。
    for item in listed:
        assert "urgency" in item and "days_until" in item
        assert isinstance(item["days_until"], int)

    # 边界：刚过 2 小时 → 逾期 1 天（不足 24 小时也按 1 天，与「已逾期 1 天」逐字一致）。
    assert by_id[just_overdue["id"]]["urgency"] == "overdue"
    assert by_id[just_overdue["id"]]["days_until"] == -1
    # 已完成的历史提醒在归档筛选里仍如实回显天数为负（前端只在待办上标红）。
    archived = {item["id"]: item for item in client.get("/api/reminders?status=archived").json()}
    assert archived[done["id"]]["days_until"] == -2
    assert by_id[future["id"]]["urgency"] in {"soon", "upcoming", "later"}
    assert by_id[future["id"]]["days_until"] == 5

    # 与首页 /upcoming 的口径逐条一致（两处不能各算一套）。
    upcoming = {item["id"]: item for item in client.get("/api/reminders/upcoming").json()}
    assert upcoming[just_overdue["id"]]["urgency"] == "overdue"
    assert upcoming[just_overdue["id"]]["days_until"] == -1


def test_write_echo_does_not_gain_list_only_fields(client):
    """写操作回显仍是 ReminderOut：创建 / PATCH 不应多出 urgency / days_until。"""
    created = client.post(
        "/api/reminders",
        json={"title": "写回显", "remind_at": "2026-11-08T10:00:00"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert "urgency" not in body and "days_until" not in body

    patched = client.patch(f"/api/reminders/{body['id']}", json={"note": "补备注"})
    assert patched.status_code == 200, patched.text
    assert "urgency" not in patched.json() and "days_until" not in patched.json()


def test_reminder_popup_setting_default_and_toggle(client):
    # 缺失时默认开启。
    assert client.get("/api/settings/reminder-popup").json() == {"enabled": True}

    # 关闭后持久化。
    assert client.put("/api/settings/reminder-popup", json={"enabled": False}).json() == {
        "enabled": False
    }
    assert client.get("/api/settings/reminder-popup").json() == {"enabled": False}

    # 重新开启。
    assert client.put("/api/settings/reminder-popup", json={"enabled": True}).json() == {
        "enabled": True
    }
    assert client.get("/api/settings/reminder-popup").json() == {"enabled": True}

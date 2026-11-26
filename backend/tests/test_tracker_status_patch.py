# SPDX-License-Identifier: Apache-2.0
"""``PATCH /api/tracker/{id}/status``：状态就地改（整改 #15）。

为什么这个端点值得单独存在：``PUT /tracker/{id}`` 是**整份替换**（``TrackUpdate`` 继承
``TrackCreate``，要求 job_id/resume_id/channel/link/applied_at 全量回传）。状态胶囊点一下
就发整条记录，既会撞上"内外简历互斥"这类整份替换才有的校验，也会用前端手里的旧快照覆盖
别人刚改的字段。本端点只碰 ``status``（+ 可选 ``status_date``）。

钉六件事：

1. 改状态 → 200 且返回新状态；``application_track_event`` **恰好 +1** 条，``from/to`` 正确；
2. 同状态 → 200 且**不新增事件**（幂等：连点两次不是两次"变化"，写进时间线就是污染历史）；
3. 非法状态 / 非法日期 → 422；记录不存在或已软删 → 404；
4. **只改这两个字段**：备注、简历关联、下一步都不能被动到；
5. 撤销 = 再 PATCH 一次改回去 → 事件再 +1（"改过去"与"改回来"都是真实历史，
   不删旧事件）；
6. 事件来源是 ``user`` + ``user_confirmed=True``，与手动编辑走同一条留痕路径。
"""

from __future__ import annotations

from app.models.tracker import ApplicationTrackEvent

BASE = {
    "company": "示例科技",
    "title": "后端开发实习生",
    "status": "applied",
    "applied_at": "2026-09-18",
}


def _events(db_session) -> list[tuple[str, str, str]]:
    """读事件表（``(from, to, status_date)``）。

    先 ``rollback``：这条会话可能还停在创建记录时开启的事务快照上，不结束事务就读不到
    另一个会话（TestClient 走的那个）刚提交的事件。
    """
    db_session.rollback()
    rows = db_session.query(ApplicationTrackEvent).order_by(ApplicationTrackEvent.id).all()
    return [(row.from_status, row.to_status, row.status_date) for row in rows]


def _create(client, **overrides) -> int:
    response = client.post("/api/tracker", json={**BASE, **overrides})
    assert response.status_code == 201
    return response.json()["id"]


def test_patch_writes_exactly_one_event_with_the_right_from_and_to(client, db_session):
    track_id = _create(client)
    assert _events(db_session) == [("", "applied", "")]

    response = client.patch(f"/api/tracker/{track_id}/status", json={"status": "interview"})

    assert response.status_code == 200
    assert response.json()["status"] == "interview"
    assert _events(db_session) == [
        ("", "applied", ""),
        ("applied", "interview", ""),
    ]


def test_same_status_is_idempotent_and_writes_no_event(client, db_session):
    track_id = _create(client)
    before = _events(db_session)

    response = client.patch(f"/api/tracker/{track_id}/status", json={"status": "applied"})

    assert response.status_code == 200
    assert response.json()["status"] == "applied"
    # 连点两次同一个状态不该在时间线上多出一步。
    assert _events(db_session) == before


def test_only_the_status_fields_are_touched(client, db_session):
    """整份替换的端点会重写所有字段；这个端点必须只碰 status/status_date。"""
    track_id = _create(
        client,
        note="一面约在周三下午",
        next_action="确认面试时间",
        next_action_date="2026-09-25",
        channel="referral",
        link="https://jobs.example.com/a/1",
    )

    client.patch(f"/api/tracker/{track_id}/status", json={"status": "offer"})

    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["status"] == "offer"
    assert detail["note"] == "一面约在周三下午"
    assert detail["next_action"] == "确认面试时间"
    assert detail["next_action_date"] == "2026-09-25"
    assert detail["channel"] == "referral"
    assert detail["link"] == "https://jobs.example.com/a/1"
    assert detail["applied_at"] == "2026-09-18"


def test_status_date_is_written_only_when_given(client, db_session):
    track_id = _create(client)

    client.patch(f"/api/tracker/{track_id}/status", json={"status": "screening"})
    assert client.get(f"/api/tracker/{track_id}").json()["status_date"] == ""

    client.patch(
        f"/api/tracker/{track_id}/status",
        json={"status": "interview", "status_date": "2026-09-20"},
    )
    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["status"] == "interview"
    assert detail["status_date"] == "2026-09-20"
    # 事件上也带业务日期（分析侧用它算"通知口径"的阶段耗时）。
    assert _events(db_session)[-1] == ("screening", "interview", "2026-09-20")


def test_reverting_the_status_is_another_real_event(client, db_session):
    """撤销 = 再 PATCH 一次改回去（不删旧事件）：时间线留两条真实历史。"""
    track_id = _create(client)
    client.patch(f"/api/tracker/{track_id}/status", json={"status": "interview"})
    client.patch(f"/api/tracker/{track_id}/status", json={"status": "applied"})

    assert _events(db_session) == [
        ("", "applied", ""),
        ("applied", "interview", ""),
        ("interview", "applied", ""),
    ]
    assert client.get(f"/api/tracker/{track_id}").json()["status"] == "applied"


def test_event_source_and_confirmation_match_a_manual_edit(client, db_session):
    track_id = _create(client)
    client.patch(f"/api/tracker/{track_id}/status", json={"status": "rejected"})

    db_session.rollback()
    event = (
        db_session.query(ApplicationTrackEvent)
        .filter(ApplicationTrackEvent.track_id == track_id)
        .order_by(ApplicationTrackEvent.id.desc())
        .first()
    )
    assert event is not None
    assert event.to_status == "rejected"
    assert event.source == "user"
    assert event.user_confirmed is True


def test_unknown_status_is_rejected(client):
    track_id = _create(client)
    response = client.patch(f"/api/tracker/{track_id}/status", json={"status": "hired"})
    assert response.status_code == 422


def test_impossible_calendar_date_is_rejected(client):
    track_id = _create(client)
    response = client.patch(
        f"/api/tracker/{track_id}/status",
        json={"status": "interview", "status_date": "2026-02-31"},
    )
    assert response.status_code == 422


def test_unknown_or_deleted_track_is_not_found(client):
    assert (
        client.patch("/api/tracker/999999/status", json={"status": "interview"}).status_code == 404
    )

    track_id = _create(client)
    assert client.delete(f"/api/tracker/{track_id}").status_code == 204
    # 软删后与"不存在"同一口径：回收站里的记录不该还能被改状态。
    assert (
        client.patch(f"/api/tracker/{track_id}/status", json={"status": "interview"}).status_code
        == 404
    )

# SPDX-License-Identifier: Apache-2.0
"""期一 T04：``POST /api/followups/decisions`` 的契约守卫。

契约见 ``D:/rf_verify/contracts/CONTRACTS.md`` A 节与 ``contracts/core.md``。
钉四件事：

1. 整卡一次事务：5 家可乱序提交、全部落 application_follow_up，全部 step 置 done；
2. 幂等：重复提交不新增行（created_rows=0、idempotent=true）；
3. **绝不写 application_track**：决策前后 (status, updated_at, next_action_date) 快照一致；
4. 错误码：404 任务不存在 / 409 不是 followup 来源 / 422 参数非法（重复 track_id、
   卡里没有的岗位、非法 decision、空列表、超过 5 条）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_SOURCE_MANUAL,
    AGENT_TASK_STATUS_DRAFT,
    AgentTask,
)
from app.models.followup import ApplicationFollowUp
from app.models.tracker import (
    STATUS_APPLIED,
    STATUS_INTERVIEW,
    STATUS_SCREENING,
    ApplicationTrack,
    normalize_key,
)
from app.services.followup_sweep import scan_stalled_tracks

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
URL = "/api/followups/decisions"


def _track(db, *, company: str, title: str = "后端开发", status: str = STATUS_APPLIED):
    record = ApplicationTrack(
        company=company,
        title=title,
        company_key=normalize_key(company),
        title_key=normalize_key(title),
        status=status,
        next_action_date="2026-11-01",
        updated_at=(NOW - timedelta(days=8)).replace(tzinfo=None),
    )
    db.add(record)
    db.commit()
    return record


def _followup_card(db, tracks: list[ApplicationTrack]) -> AgentTask:
    db.expire_all()
    result = scan_stalled_tracks(db, now=NOW, enabled=True)
    db.expire_all()
    assert result["created"] == 1, result
    card = db.query(AgentTask).filter(AgentTask.source == AGENT_TASK_SOURCE_FOLLOWUP).one()
    assert {int(step.output_ref["track_id"]) for step in card.steps} == {t.id for t in tracks}
    return card


def _track_snapshot(db) -> dict[int, tuple]:
    db.expire_all()
    return {
        track.id: (track.status, track.updated_at, track.next_action_date)
        for track in db.query(ApplicationTrack).all()
    }


def _rows(db) -> list[ApplicationFollowUp]:
    db.expire_all()
    return list(db.query(ApplicationFollowUp).order_by(ApplicationFollowUp.id).all())


def _decisions(*pairs: tuple[int, str]) -> list[dict]:
    return [{"track_id": track_id, "decision": decision} for track_id, decision in pairs]


def test_whole_card_is_saved_in_one_transaction_out_of_order(client, db_session):
    tracks = [
        _track(db_session, company="甲公司"),
        _track(db_session, company="乙公司", status=STATUS_SCREENING),
        _track(db_session, company="丙公司", status=STATUS_INTERVIEW),
    ]
    card = _followup_card(db_session, tracks)
    before = _track_snapshot(db_session)

    response = client.post(
        URL,
        json={
            "task_id": card.id,
            # 故意乱序（step 顺序是 甲/乙/丙）：三家彼此独立，不能强制按卡上顺序点。
            "decisions": [
                {"track_id": tracks[2].id, "decision": "replied"},
                {"track_id": tracks[0].id, "decision": "contacted"},
                {"track_id": tracks[1].id, "decision": "stopped"},
            ],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["task_id"] == card.id
    assert body["status"] == "done"
    assert body["decided"] == 3
    assert body["created_rows"] == 3
    assert body["idempotent"] is False
    assert {step["status"] for step in body["steps"]} == {"done"}
    assert {step["kind"] for step in body["steps"]} == {"followup"}

    rows = _rows(db_session)
    assert len(rows) == 3
    assert {(row.track_id, row.decision, row.task_id) for row in rows} == {
        (tracks[0].id, "contacted", card.id),
        (tracks[1].id, "stopped", card.id),
        (tracks[2].id, "replied", card.id),
    }
    # **绝不写 application_track**：状态 / 更新时间 / 下次动作日期一个都不许动。
    assert _track_snapshot(db_session) == before


def test_repeated_submit_is_idempotent(client, db_session):
    tracks = [_track(db_session, company="甲公司"), _track(db_session, company="乙公司")]
    card = _followup_card(db_session, tracks)
    payload = {
        "task_id": card.id,
        "decisions": _decisions((tracks[0].id, "contacted"), (tracks[1].id, "replied")),
    }

    first = client.post(URL, json=payload)
    second = client.post(URL, json=payload)

    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["created_rows"] == 2
    assert second.json()["created_rows"] == 0
    assert second.json()["idempotent"] is True
    assert second.json()["status"] == "done"
    assert len(_rows(db_session)) == 2


def test_partial_submit_keeps_card_open_until_all_steps_done(client, db_session):
    tracks = [
        _track(db_session, company="甲公司"),
        _track(db_session, company="乙公司"),
    ]
    card = _followup_card(db_session, tracks)

    first = client.post(
        URL, json={"task_id": card.id, "decisions": _decisions((tracks[0].id, "contacted"))}
    )
    assert first.status_code == 200, first.text
    assert first.json()["created_rows"] == 1
    assert first.json()["status"] != "done"

    second = client.post(
        URL, json={"task_id": card.id, "decisions": _decisions((tracks[1].id, "stopped"))}
    )
    assert second.json()["status"] == "done"
    assert len(_rows(db_session)) == 2


def test_missing_task_returns_404(client):
    response = client.post(URL, json={"task_id": 999999, "decisions": _decisions((1, "contacted"))})
    assert response.status_code == 404


def test_non_followup_task_returns_409(client, db_session):
    manual = AgentTask(
        conversation_id=None,
        dataset_key="main",
        title="手动任务",
        status=AGENT_TASK_STATUS_DRAFT,
        source=AGENT_TASK_SOURCE_MANUAL,
    )
    db_session.add(manual)
    db_session.commit()

    response = client.post(
        URL, json={"task_id": manual.id, "decisions": _decisions((1, "contacted"))}
    )
    assert response.status_code == 409
    assert "跟进" in response.json()["detail"]


def test_duplicate_track_ids_are_rejected(client, db_session):
    track = _track(db_session, company="甲公司")
    card = _followup_card(db_session, [track])
    response = client.post(
        URL,
        json={
            "task_id": card.id,
            "decisions": _decisions((track.id, "contacted"), (track.id, "replied")),
        },
    )
    assert response.status_code == 422
    assert _rows(db_session) == []


def test_unknown_track_id_is_rejected(client, db_session):
    track = _track(db_session, company="甲公司")
    card = _followup_card(db_session, [track])
    other = _track(db_session, company="不在卡里")
    response = client.post(
        URL, json={"task_id": card.id, "decisions": _decisions((other.id, "contacted"))}
    )
    assert response.status_code == 422
    assert _rows(db_session) == []


def test_invalid_decision_value_is_rejected(client, db_session):
    track = _track(db_session, company="甲公司")
    card = _followup_card(db_session, [track])
    response = client.post(
        URL, json={"task_id": card.id, "decisions": _decisions((track.id, "maybe"))}
    )
    assert response.status_code == 422


def test_empty_and_oversized_decision_lists_are_rejected(client, db_session):
    track = _track(db_session, company="甲公司")
    card = _followup_card(db_session, [track])

    empty = client.post(URL, json={"task_id": card.id, "decisions": []})
    assert empty.status_code == 422

    too_many = client.post(
        URL,
        json={
            "task_id": card.id,
            "decisions": [{"track_id": track.id, "decision": "contacted"}] * 6,
        },
    )
    assert too_many.status_code == 422


def test_extra_fields_are_rejected(client, db_session):
    track = _track(db_session, company="甲公司")
    card = _followup_card(db_session, [track])
    response = client.post(
        URL,
        json={
            "task_id": card.id,
            "decisions": [{"track_id": track.id, "decision": "contacted", "note": "外快"}],
        },
    )
    assert response.status_code == 422

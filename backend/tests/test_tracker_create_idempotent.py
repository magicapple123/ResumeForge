# SPDX-License-Identifier: Apache-2.0
"""重复「新增进度」复用同一条公司+岗位记录，不重置已有字段与历史。

没有关联岗位时也要按归一化键命中；而创建服务本身仍保持"纯新建"语义——幂等是接口/动作层
的策略，不能悄悄改变底层服务的行为。
"""

import pytest
from app.models.tracker import ApplicationTrack, ApplicationTrackEvent
from app.schemas.tracker import TrackCreate
from app.services.actions.domains.tracker import (
    CreateApplicationTrackInput,
    _run_create_application_track,
)
from app.services.tracker import create_track
from sqlalchemy.exc import IntegrityError


def test_repeated_post_returns_one_record_and_preserves_existing_fields(client, db_session):
    payload = {
        "company": "R02 Example",
        "title": "AI Product Manager",
        "status": "interview",
        "note": "Keep the original note",
    }
    first = client.post("/api/tracker", json=payload)
    assert first.status_code == 201, first.text
    second = client.post("/api/tracker", json={**payload, "status": "applied", "note": "New draft"})
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first.json()["id"]
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert second.json()["status"] == "interview"
    assert second.json()["note"] == "Keep the original note"
    assert db_session.query(ApplicationTrack).count() == 1
    assert db_session.query(ApplicationTrackEvent).count() == 1


def test_action_uses_existing_normalized_key_even_without_job_link(db_session):
    original = create_track(db_session, TrackCreate(company="Ｒ０２ Example", title="AI Manager"))
    outcome = _run_create_application_track(
        db_session,
        CreateApplicationTrackInput(company="r02example", title="ai manager"),
    )
    assert outcome.changed is False
    assert outcome.summary == "已在求职进度中"
    assert outcome.data.id == original.id
    assert outcome.data.job_id is None
    assert db_session.query(ApplicationTrackEvent).count() == 1


def test_create_service_keeps_pure_creation_semantics(db_session):
    payload = TrackCreate(company="R02 Example", title="Manager")
    create_track(db_session, payload)
    with pytest.raises(IntegrityError):
        create_track(db_session, payload)
    assert db_session.query(ApplicationTrack).count() == 1

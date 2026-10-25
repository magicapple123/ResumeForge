# SPDX-License-Identifier: Apache-2.0
"""回归：SQLite rowid 复用撞上 profile_usage_snapshot.resume_id UNIQUE（P0）。

用户真实库形态（backend/data/datasets/38d2d633da114ac0.db，2026-10-26 02:09/02:33）：
- profile_usage_snapshot 行 1-6 保留 resume_id=641..647 的历史引用，而对应简历已被
  「回收站 → 彻底删除」物理删除；
- SQLite 的 INTEGER PRIMARY KEY 没有 AUTOINCREMENT，删除最大行后下一条新简历会复用
  同一个 rowid（用户库里新简历又拿到 644）；
- 新建简历 / 生成完成落库时回写快照 resume_id → UNIQUE constraint failed:
  profile_usage_snapshot.resume_id → 用户看到「服务器处理请求时发生内部错误」。

修复口径（R-33/R-34 不变）：**不删历史快照行**，只在绑定新 resume_id 前把同 id 的历史
悬空引用解除（resume_id 置 NULL，其余快照字段一个字节不动）；回收站彻底删除简历时也
主动解除引用，不再生产新的悬空行；旧库里的既有悬空引用由迁移 0065 清理。
"""

from __future__ import annotations

import uuid

from app.models.profile import utcnow
from app.models.profile_usage_snapshot import ProfileUsageSnapshot
from app.models.resume import ResumeRecord
from app.services.resume.generate_snapshot import attach_snapshot_resume

PROJECTION_API = "/api/profile/current/projection"
MANUAL_API = "/api/resumes/manual"
PURGE_BATCH_API = "/api/trash/purge"
EMPTY_TRASH_API = "/api/trash"


def _projection(client) -> dict:
    response = client.get(PROJECTION_API)
    assert response.status_code == 200, response.text
    return response.json()


def _profile_context(projection: dict) -> dict:
    """与前端实际发送的形状一致（服务端只用 snapshot_token，其余是展示字段）。"""
    return {
        "snapshot_token": projection["snapshot_token"],
        "participating_keys": projection["scope"]["participating_keys"],
        "layout": [
            {
                "section_key": item["section_key"],
                "section_name": item["section_name"],
                "entry_count": item["entry_count"],
            }
            for item in projection["source_layout"]
        ],
    }


def _create_draft(client, *, title: str = "新建简历") -> dict:
    """走「新建简历 → 前往简历制作台」的真实请求形状（draft=true + profile_context）。"""
    projection = _projection(client)
    response = client.post(
        MANUAL_API,
        json={
            "title": title,
            "content": {"name": "张三", "summary": "后端工程师"},
            "draft": True,
            "profile_context": _profile_context(projection),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _snapshots(db_session) -> list[ProfileUsageSnapshot]:
    db_session.rollback()
    return db_session.query(ProfileUsageSnapshot).order_by(ProfileUsageSnapshot.id).all()


def _resume_ids(db_session) -> list[int]:
    db_session.rollback()
    return [row.id for row in db_session.query(ResumeRecord).order_by(ResumeRecord.id).all()]


def _add_legacy_snapshot(db_session, *, resume_id: int | None = None) -> ProfileUsageSnapshot:
    """直接写一行历史快照（模拟老库升级后留下的悬空引用；父行可能早已不存在）。"""
    row = ProfileUsageSnapshot(
        snapshot_id=uuid.uuid4().hex[:24],
        task_id=None,
        resume_id=resume_id,
        group_id="legacy-group",
        group_name="旧历史组",
        participating=[{"key": "basic_info", "name": "基本信息"}],
        section_order=["basic_info"],
        definition_revision=7,
        data_revision=11,
        layout={"group_id": "legacy-group", "participating": []},
        created_at=utcnow(),
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _frozen_fields(row: ProfileUsageSnapshot) -> dict:
    """快照的不可变字段（R-33/R-34）：解除 resume_id 引用时这些一个字节都不能变。"""
    return {
        "snapshot_id": row.snapshot_id,
        "group_id": row.group_id,
        "group_name": row.group_name,
        "participating": row.participating,
        "section_order": row.section_order,
        "definition_revision": row.definition_revision,
        "data_revision": row.data_revision,
        "layout": row.layout,
        "created_at": row.created_at,
    }


def test_legacy_dangling_resume_id_does_not_break_new_resume(client, db_session) -> None:
    """老库升级后的悬空快照占着 id=1：新建简历拿到同一个 id 时不能再 500。

    这是用户真实库的等价形态（悬空行已在库里，不经过本次修复后的删除路径）。
    """
    legacy = _add_legacy_snapshot(db_session, resume_id=1)
    legacy_frozen = _frozen_fields(legacy)

    created = _create_draft(client)

    assert created["id"] == 1  # SQLite rowid 复用：新简历恰好拿到被悬空引用的 id
    rows = _snapshots(db_session)
    assert len(rows) == 2
    old, new = rows
    # 历史行保留、不可变字段不变，只解除指向不存在简历的引用
    assert _frozen_fields(old) == legacy_frozen
    assert old.resume_id is None
    # 新快照正常绑定本次创建的简历，且写入了当前组的来源元数据
    assert new.resume_id == created["id"]
    assert new.group_name
    assert new.layout is not None
    # 简历本身创建成功且可读
    detail = client.get(f"/api/resumes/{created['id']}")
    assert detail.status_code == 200, detail.text


def test_purge_then_recreate_three_rounds_never_500(client, db_session) -> None:
    """新建→删除→彻底删除→再新建，连续 3 轮不 500；历史快照保留但解除绑定。"""
    seen_ids: list[int] = []
    for _round in range(3):
        created = _create_draft(client)
        resume_id = created["id"]
        assert client.delete(f"/api/resumes/{resume_id}").status_code == 204
        assert client.delete(f"/api/trash/resume/{resume_id}").status_code == 204
        assert _resume_ids(db_session) == []  # 彻底删除是真删
        # 快照行保留、引用解除（不产生新的悬空行）
        rows = _snapshots(db_session)
        assert len(rows) == len(seen_ids) + 1
        assert rows[-1].resume_id is None
        seen_ids.append(resume_id)

    # rowid 复用确实发生了（否则这条回归测试证明不了它要防的东西）
    assert len(set(seen_ids)) == 1, seen_ids
    # 三轮的历史行都还在，快照身份互不相同
    rows = _snapshots(db_session)
    assert len(rows) == 3
    assert len({row.snapshot_id for row in rows}) == 3
    assert all(row.resume_id is None for row in rows)


def test_purge_keeps_snapshot_history_unchanged_except_reference(client, db_session) -> None:
    """彻底删除简历 → 快照行仍可追溯，只把 resume_id 置 NULL。"""
    created = _create_draft(client)
    resume_id = created["id"]
    before = _snapshots(db_session)[0]
    frozen = _frozen_fields(before)
    assert before.resume_id == resume_id

    assert client.delete(f"/api/resumes/{resume_id}").status_code == 204
    assert client.delete(f"/api/trash/resume/{resume_id}").status_code == 204

    after = _snapshots(db_session)
    assert len(after) == 1
    assert _frozen_fields(after[0]) == frozen
    assert after[0].resume_id is None


def test_purge_many_and_empty_detach_snapshot_references(client, db_session) -> None:
    """批量彻底删除与清空回收站同样先解除快照引用。"""
    first = _create_draft(client)
    second = _create_draft(client)
    for item in (first, second):
        assert client.delete(f"/api/resumes/{item['id']}").status_code == 204
    purged = client.post(
        PURGE_BATCH_API,
        json={
            "items": [
                {"type_key": "resume", "id": first["id"]},
                {"type_key": "resume", "id": second["id"]},
            ]
        },
    )
    assert purged.status_code == 200, purged.text
    assert purged.json()["purged"] == 2
    assert all(row.resume_id is None for row in _snapshots(db_session))

    third = _create_draft(client)
    assert client.delete(f"/api/resumes/{third['id']}").status_code == 204
    emptied = client.delete(EMPTY_TRASH_API, params={"type": "resume"})
    assert emptied.status_code == 200, emptied.text
    rows = _snapshots(db_session)
    assert len(rows) == 3
    assert all(row.resume_id is None for row in rows)


def test_attach_snapshot_resume_detaches_conflicting_history(db_session) -> None:
    """attach（后台任务 / SSE 共用）在回写前解除同 resume_id 的历史悬空绑定。"""
    historical = _add_legacy_snapshot(db_session, resume_id=501)
    frozen = _frozen_fields(historical)
    pending = _add_legacy_snapshot(db_session, resume_id=None)

    assert attach_snapshot_resume(db_session, snapshot_id=pending.id, resume_id=501, commit=True)
    db_session.expire_all()
    old = db_session.get(ProfileUsageSnapshot, historical.id)
    new = db_session.get(ProfileUsageSnapshot, pending.id)
    assert old.resume_id is None
    assert _frozen_fields(old) == frozen
    assert new.resume_id == 501

    # 已回写过的行不再改写（既有语义），也不会误解绑别人
    other = _add_legacy_snapshot(db_session, resume_id=None)
    assert not attach_snapshot_resume(db_session, snapshot_id=new.id, resume_id=502, commit=True)
    db_session.expire_all()
    assert db_session.get(ProfileUsageSnapshot, new.id).resume_id == 501
    assert db_session.get(ProfileUsageSnapshot, other.id).resume_id is None

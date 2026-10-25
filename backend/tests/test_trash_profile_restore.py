# SPDX-License-Identifier: Apache-2.0
"""回收站恢复冲突守卫（0064 / F1 契约 §10.3）：组、自建定义、条目恢复的 409 与不半恢复。

**为什么恢复需要守卫**：活动行的唯一性是 partial unique index（WHERE deleted_at IS NULL），
所以回收站里的同名/同排序位行可以和活动行并存；一旦恢复就会撞约束。没有守卫时数据库抛
IntegrityError，API 只回 500，用户既不知道原因、也不知道下一步该做什么；批量恢复还可能在
"前几条已恢复、后一条失败"处留下半恢复状态。

这里逐类钉住四类冲突（组名 / 自建大字段名 / 自建小字段标签 / 条目排序位）与三条边界：
非冲突恢复照常成功；单条与批量都映射 409 且响应体是**顶层** {detail, code}；
批量冲突整批回滚、不出现半恢复。
"""

from __future__ import annotations

import pytest
from app.models.profile import utcnow
from app.models.profile_definition import ProfileCustomField, ProfileCustomSection
from app.models.profile_entry import ProfileEntry
from app.models.profile_group import ProfileGroup
from app.services import trash

CONFLICT_CODE = "trash_restore_conflict"
FIELD_SECTION = "custom:s1"


def _create(db, model, *, trashed: bool, **fields):
    """建一行；trashed=True 表示"已在回收站里"，因此不占活动行唯一约束。"""
    item = model(deleted_at=utcnow() if trashed else None, **fields)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _group(db, group_id: str, name: str, *, trashed: bool = False) -> ProfileGroup:
    return _create(db, ProfileGroup, trashed=trashed, group_id=group_id, name=name, name_key=name)


def _section(db, section_id: str, name: str, *, trashed: bool = False) -> ProfileCustomSection:
    return _create(
        db,
        ProfileCustomSection,
        trashed=trashed,
        section_id=section_id,
        key=f"custom:{section_id}",
        name=name,
        name_key=name,
    )


def _field(
    db, field_id: str, label: str, *, section_key: str = FIELD_SECTION, trashed: bool = False
) -> ProfileCustomField:
    return _create(
        db,
        ProfileCustomField,
        trashed=trashed,
        field_id=field_id,
        section_key=section_key,
        label=label,
        label_key=label,
        field_type="single_line",
    )


def _entry(
    db, entry_id: str, sort_order: int, *, section_key: str = "educations", trashed: bool = False
) -> ProfileEntry:
    return _create(
        db,
        ProfileEntry,
        trashed=trashed,
        entry_id=entry_id,
        section_key=section_key,
        sort_order=sort_order,
    )


def _assert_conflict(db, type_key: str, item) -> str:
    """恢复必须被守卫拒绝，且失败后这条仍在回收站里（守卫不产生半个状态）。"""
    with pytest.raises(trash.RestoreConflict) as excinfo:
        trash.restore(db, type_key, item.id)
    db.expire_all()
    assert trash.is_deleted(db.get(type(item), item.id))
    return excinfo.value.detail


# ===== 四类冲突：抛 RestoreConflict 并给出"发生了什么 + 怎么办" =====


def test_group_name_conflict(db_session):
    _group(db_session, "g-active", "应届生")
    doomed = _group(db_session, "g-doomed", "应届生", trashed=True)

    detail = _assert_conflict(db_session, "profile_group", doomed)

    assert "同名组" in detail and "应届生" in detail
    assert "改名" in detail or "删除" in detail


def test_custom_section_name_conflict(db_session):
    _section(db_session, "s-active", "开源贡献")
    doomed = _section(db_session, "s-doomed", "开源贡献", trashed=True)

    detail = _assert_conflict(db_session, "profile_custom_section", doomed)

    assert "同名自建大字段" in detail and "开源贡献" in detail


def test_custom_field_label_conflict_is_scoped_to_its_section(db_session):
    _field(db_session, "f-active", "导师姓名")
    doomed = _field(db_session, "f-doomed", "导师姓名", trashed=True)

    detail = _assert_conflict(db_session, "profile_custom_field", doomed)

    assert "同名字段" in detail and "导师姓名" in detail
    # 另一个分区里的同名字段不是冲突：标签唯一性只在同一大字段内（契约 §2.2）。
    other = _field(db_session, "f-other", "导师姓名", section_key="custom:s9", trashed=True)
    assert trash.restore(db_session, "profile_custom_field", other.id)


def test_entry_sort_position_conflict_is_scoped_to_its_section(db_session):
    _entry(db_session, "e-active", 0)
    doomed = _entry(db_session, "e-doomed", 0, trashed=True)

    detail = _assert_conflict(db_session, "profile_entry", doomed)

    assert "第 1 位" in detail and "调整排序" in detail
    # 同一排序位在别的分区不冲突。
    other = _entry(db_session, "e-other", 0, section_key="projects", trashed=True)
    assert trash.restore(db_session, "profile_entry", other.id)


# ===== 非冲突恢复：四类都必须照常成功 =====


def test_non_conflicting_restore_succeeds_for_all_four_types(db_session):
    _group(db_session, "g-active", "社招")
    group = _group(db_session, "g-restore", "产品岗", trashed=True)

    _section(db_session, "s-active", "开源贡献")
    section = _section(db_session, "s-restore", "培训与课程", trashed=True)

    _field(db_session, "f-active", "导师姓名")
    field = _field(db_session, "f-restore", "合作方", trashed=True)

    _entry(db_session, "e-active", 0)
    entry = _entry(db_session, "e-restore", 1, trashed=True)

    for type_key, item in (
        ("profile_group", group),
        ("profile_custom_section", section),
        ("profile_custom_field", field),
        ("profile_entry", entry),
    ):
        assert trash.restore(db_session, type_key, item.id), type_key
        db_session.refresh(item)
        assert item.deleted_at is None, type_key


# ===== API：409 body 是顶层 {detail, code} =====


def test_api_restore_conflict_returns_409_with_code(db_session, client):
    _group(db_session, "g-active", "应届生")
    doomed = _group(db_session, "g-doomed", "应届生", trashed=True)

    response = client.post(f"/api/trash/profile_group/{doomed.id}/restore")

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == CONFLICT_CODE
    assert "应届生" in body["detail"]
    # 没有恢复：仍在回收站列表里（列表接口由同一套 spec 驱动）。
    db_session.expire_all()
    assert trash.is_deleted(db_session.get(ProfileGroup, doomed.id))
    trashed_ids = [
        item["id"]
        for item in client.get("/api/trash", params={"type": "profile_group"}).json()["items"]
    ]
    assert doomed.id in trashed_ids


def test_api_batch_restore_conflict_rolls_back_whole_batch(db_session, client):
    """批量恢复先成功一条、后遇到冲突：409 且**先恢复的那条也要回滚**。"""
    _group(db_session, "g-active", "应届生")
    restorable = _group(db_session, "g-ok", "产品岗", trashed=True)
    doomed = _group(db_session, "g-doomed", "应届生", trashed=True)

    response = client.post(
        "/api/trash/restore",
        json={
            "items": [
                {"type_key": "profile_group", "id": restorable.id},
                {"type_key": "profile_group", "id": doomed.id},
            ]
        },
    )

    assert response.status_code == 409
    assert response.json()["code"] == CONFLICT_CODE
    db_session.expire_all()
    assert trash.is_deleted(db_session.get(ProfileGroup, restorable.id)), "不能出现半恢复"
    assert trash.is_deleted(db_session.get(ProfileGroup, doomed.id))

# SPDX-License-Identifier: Apache-2.0
"""存储层 J/Q 验收：条目单例唯一、合并保存、上限、排序与批量原子性（契约 §6）。

断言只走 services/profile/entry_store + 直接查库（不 mock）：
1. 单例分区第二次写入更新同一条，DB 层 partial unique / CHECK 也挡住第二条；
2. 多条分区 sort_order 稳定、200 条上限、显式序号冲突被拒；
3. 合并保存：未提交键保留旧值、显式 "" 清空、已删除自定义字段的旧值保留、未知 field_id 拒绝；
4. field_snapshot 记录定义标签/类型，字段删除后仍能按历史快照显示；
5. 软删不重排其余条目；重排走临时正序号区不撞 partial unique；
6. 批量保存单事务原子（任一失败全回滚），workspace revision 过期 409。
"""

from __future__ import annotations

import pytest
from app.models.profile_entry import ProfileEntry
from app.services.profile import definition_store, entry_store, group_store
from app.services.profile.errors import (
    LimitReached,
    NotFound,
    RevisionConflict,
    ValidationError,
)
from sqlalchemy.exc import IntegrityError


def _create(db, section_key, values=None, sort_order=None):
    return entry_store.upsert_entry(db, section_key, values=values or {}, sort_order=sort_order)


def _raw_add(db, section_key, entry_id, sort_order, values=None):
    row = ProfileEntry(
        entry_id=entry_id,
        section_key=section_key,
        sort_order=sort_order,
        values=values or {},
        field_snapshot=[],
    )
    db.add(row)
    return row


def test_singleton_section_second_write_updates_same_row(db_session):
    first = _create(db_session, "basic_info", {"basic_info.name": "张三"})
    second = entry_store.upsert_entry(
        db_session, "basic_info", values={"basic_info.phone": "13800000000"}
    )
    assert second.entry_id == first.entry_id
    assert second.sort_order == 0
    assert second.revision == 2  # 第二次写入推进同一条的 revision
    assert second.values == {"basic_info.name": "张三", "basic_info.phone": "13800000000"}
    assert db_session.query(ProfileEntry).filter_by(section_key="basic_info").count() == 1
    # DB 层：单例再插一条 sort_order=0 会被 partial unique 挡住（R-02）。
    _raw_add(db_session, "basic_info", "duplicate-singleton", 0, {"basic_info.name": "李四"})
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    # DB 层：单例 sort_order 非 0 被 CHECK 挡住。
    _raw_add(db_session, "summary", "bad-singleton", 3, {"summary.content": "x"})
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_multi_entries_sort_orders_are_stable_and_limited(db_session):
    first = _create(db_session, "awards", {"awards.title": "A"})
    second = _create(db_session, "awards", {"awards.title": "B"})
    third = _create(db_session, "awards", {"awards.title": "C"})
    assert [item.sort_order for item in (first, second, third)] == [0, 1, 2]
    with pytest.raises(ValidationError) as collision:
        _create(db_session, "awards", {"awards.title": "D"}, sort_order=1)
    assert collision.value.code == "sort_order_conflict"
    # 200 条上限：预置满 200 条活动记录后新建被拒（R-03）。
    for index in range(3, 200):
        _raw_add(db_session, "awards", f"entry{index:019d}", index)
    db_session.commit()
    with pytest.raises(LimitReached) as limited:
        _create(db_session, "awards", {"awards.title": "第201条"})
    assert limited.value.code == "limit_reached"
    assert "200" in limited.value.detail


def test_merge_save_keeps_unsubmitted_values_and_explicit_empty_clears(db_session):
    entry = _create(
        db_session,
        "projects",
        {
            "projects.name": "项目A",
            "projects.description": "原描述",
            "projects.tech_stack": "Python",
        },
    )
    patched = entry_store.upsert_entry(
        db_session,
        "projects",
        entry_id=entry.entry_id,
        values={"projects.description": "新描述"},
        expected_revision=entry.revision,
    )
    assert patched.values == {
        "projects.name": "项目A",
        "projects.description": "新描述",
        "projects.tech_stack": "Python",
    }
    cleared = entry_store.upsert_entry(
        db_session,
        "projects",
        entry_id=entry.entry_id,
        values={"projects.description": ""},
        expected_revision=patched.revision,
    )
    assert cleared.values["projects.description"] == ""
    assert cleared.values["projects.name"] == "项目A"


def test_save_preserves_deleted_custom_field_value(db_session):
    field = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    entry = _create(db_session, "projects", {field.field_id: "张伟", "projects.name": "项目A"})
    definition_store.delete_custom_field(
        db_session,
        "projects",
        field.field_id,
        expected_revision=field.revision,
        confirm_with_values=True,
    )
    updated = entry_store.upsert_entry(
        db_session,
        "projects",
        entry_id=entry.entry_id,
        values={"projects.name": "项目B"},
    )
    assert updated.values[field.field_id] == "张伟"  # 已删除字段的值不被清掉
    assert updated.values["projects.name"] == "项目B"


def test_unknown_and_overlong_values_are_rejected(db_session):
    with pytest.raises(ValidationError) as unknown:
        _create(db_session, "projects", {"projects.不存在": "x"})
    assert unknown.value.code == "unknown_field"
    with pytest.raises(ValidationError) as too_long:
        _create(db_session, "projects", {"projects.name": "x" * 201})
    assert too_long.value.code == "value_too_long"
    with pytest.raises(ValidationError) as multi_too_long:
        _create(db_session, "projects", {"projects.description": "x" * 2001})
    assert multi_too_long.value.code == "value_too_long"
    # 日期宽松归一：可识别格式统一成短横线，不因无法识别而报错。
    entry = _create(db_session, "educations", {"educations.start_date": "2024.09"})
    assert entry.values["educations.start_date"] == "2024-09"
    loose = _create(db_session, "educations", {"educations.end_date": "至今"})
    assert loose.values["educations.end_date"] == "至今"
    # 自定义字段按 DB 里的真实类型校验（single_line 200，不回落成 multi_line）。
    field = definition_store.create_custom_field(db_session, "skills", "自定义单行", "single_line")
    with pytest.raises(ValidationError) as custom_too_long:
        _create(db_session, "skills", {field.field_id: "x" * 201})
    assert custom_too_long.value.code == "value_too_long"


def test_field_snapshot_records_labels_and_history(db_session):
    field = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    entry = _create(db_session, "projects", {field.field_id: "张伟", "projects.name": "项目A"})
    snapshot = {item["field_id"]: item for item in entry.field_snapshot}
    assert snapshot["projects.name"]["label"] == "项目名称"
    assert snapshot[field.field_id] == {
        "field_id": field.field_id,
        "label": "导师姓名",
        "field_type": "single_line",
    }
    definition_store.delete_custom_field(
        db_session,
        "projects",
        field.field_id,
        expected_revision=field.revision,
        confirm_with_values=True,
    )
    updated = entry_store.upsert_entry(
        db_session, "projects", entry_id=entry.entry_id, values={"projects.name": "项目B"}
    )
    history = {item["field_id"]: item for item in updated.field_snapshot}
    assert history[field.field_id]["label"] == "导师姓名"  # 定义删了仍保留历史标签
    assert history["projects.name"]["label"] == "项目名称"


def test_expected_revision_conflict_and_soft_delete(db_session):
    entry = _create(db_session, "awards", {"awards.title": "A"})
    with pytest.raises(RevisionConflict) as stale:
        entry_store.upsert_entry(
            db_session,
            "awards",
            entry_id=entry.entry_id,
            values={"awards.title": "B"},
            expected_revision=99,
        )
    assert stale.value.current_revision == entry.revision
    assert stale.value.extra["revision"] == entry.revision
    with pytest.raises(NotFound):
        entry_store.upsert_entry(db_session, "awards", entry_id="no-such-entry", values={})
    with pytest.raises(RevisionConflict):
        entry_store.delete_entry(
            db_session, "awards", entry.entry_id, expected_revision=entry.revision + 99
        )
    entry_store.delete_entry(db_session, "awards", entry.entry_id, expected_revision=entry.revision)
    assert entry_store.get_entry(db_session, "awards", entry.entry_id) is None
    db_session.expire_all()
    stored = entry_store.get_entry(db_session, "awards", entry.entry_id, include_deleted=True)
    assert stored is not None and stored.deleted_at is not None
    with pytest.raises(NotFound):
        entry_store.delete_entry(db_session, "awards", entry.entry_id)


def test_delete_middle_entry_does_not_reorder_others(db_session):
    rows = [_create(db_session, "awards", {"awards.title": name}) for name in "ABC"]
    entry_store.delete_entry(db_session, "awards", rows[1].entry_id)
    db_session.expire_all()
    remaining = entry_store.list_entries(db_session, section_key="awards")
    assert [item.entry_id for item in remaining] == [rows[0].entry_id, rows[2].entry_id]
    assert [item.sort_order for item in remaining] == [0, 2]  # 删除不重排其余条目
    assert (
        entry_store.list_entries(db_session, section_key="awards", include_deleted=True)[
            1
        ].deleted_at
        is not None
    )


def test_reorder_entries_uses_temp_sort_range_and_validates_membership(db_session):
    rows = [_create(db_session, "awards", {"awards.title": name}) for name in "ABC"]
    # 先把序号改成稀疏值，验证临时正序号区不会与既有序号冲突。
    for offset, row in enumerate(rows):
        db_session.query(ProfileEntry).filter_by(entry_id=row.entry_id).update(
            {"sort_order": 5 + offset * 7}
        )
    db_session.commit()
    state_revision = int(group_store.read_state(db_session).revision)
    reordered = entry_store.reorder_entries(
        db_session,
        "awards",
        [rows[2].entry_id, rows[0].entry_id, rows[1].entry_id],
        expected_revision=state_revision,
    )
    assert [item.entry_id for item in reordered] == [
        rows[2].entry_id,
        rows[0].entry_id,
        rows[1].entry_id,
    ]
    assert [item.sort_order for item in reordered] == [0, 1, 2]
    with pytest.raises(ValidationError) as missing:
        entry_store.reorder_entries(db_session, "awards", [rows[0].entry_id])
    assert missing.value.code == "invalid_reorder"
    with pytest.raises(ValidationError):
        entry_store.reorder_entries(
            db_session,
            "awards",
            [rows[0].entry_id, rows[0].entry_id, rows[1].entry_id],
        )
    # expected_revision 语义 = workspace state.revision（§4）：过期 → 409 带当前值。
    definition_store.create_custom_section(db_session, "新分区")
    current = group_store.read_state(db_session).revision
    with pytest.raises(RevisionConflict) as stale:
        entry_store.reorder_entries(
            db_session,
            "awards",
            [rows[0].entry_id, rows[1].entry_id, rows[2].entry_id],
            expected_revision=state_revision,
        )
    assert stale.value.current_revision == current


def test_list_entries_only_active_sections_by_default(db_session):
    section = definition_store.create_custom_section(db_session, "开源贡献")
    entry = _create(db_session, section.key, {})
    definition_store.delete_custom_section(
        db_session, section.key, expected_revision=section.revision
    )
    assert all(row.entry_id != entry.entry_id for row in entry_store.list_entries(db_session))
    explicitly = entry_store.list_entries(db_session, section_keys={section.key})
    assert [row.entry_id for row in explicitly] == [entry.entry_id]
    assert entry_store.list_entries(db_session, section_key=section.key) != []


def test_bulk_save_is_atomic_and_checks_workspace_revision(db_session):
    entry = _create(db_session, "projects", {"projects.name": "原项目"})
    entry_revision = int(entry.revision)
    state = group_store.read_state(db_session)
    state_revision = int(state.revision)
    with pytest.raises(ValidationError) as invalid:
        entry_store.bulk_save_entries(
            db_session,
            [
                {
                    "section_key": "projects",
                    "entry_id": entry.entry_id,
                    "values": {"projects.name": "会被回滚"},
                    "expected_revision": entry.revision,
                },
                {"section_key": "projects", "values": {"projects.不存在": "x"}},
            ],
        )
    assert invalid.value.code == "unknown_field"
    stored = entry_store.get_entry(db_session, "projects", entry.entry_id)
    assert stored.values == {"projects.name": "原项目"}  # 合法项也回滚
    assert stored.revision == entry.revision
    assert group_store.read_state(db_session).revision == state.revision
    with pytest.raises(RevisionConflict) as stale:
        entry_store.bulk_save_entries(
            db_session, [], expected_workspace_revision=state_revision + 99
        )
    assert stale.value.current_revision == state_revision
    # 成功路径：新建 + 更新在同一事务里提交，返回顺序与提交一致。
    created_values = {"projects.name": "批量新建"}
    saved = entry_store.bulk_save_entries(
        db_session,
        [
            {"section_key": "projects", "values": created_values},
            {
                "section_key": "projects",
                "entry_id": entry.entry_id,
                "values": {"projects.name": "批量更新"},
                "expected_revision": entry.revision,
            },
        ],
        expected_workspace_revision=state_revision,
    )
    assert [row.values for row in saved] == [
        created_values,
        {"projects.name": "批量更新"},
    ]
    with pytest.raises(RevisionConflict):
        entry_store.bulk_save_entries(
            db_session,
            [
                {
                    "section_key": "projects",
                    "entry_id": entry.entry_id,
                    "values": {"projects.name": "过期版本"},
                    "expected_revision": entry_revision,
                }
            ],
        )

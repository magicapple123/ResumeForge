# SPDX-License-Identifier: Apache-2.0
"""存储层 J 验收：大字段/小字段定义的读取、CRUD、保护与删除语义（契约 §6）。

断言只走 services/profile/definition_store + 直接查库（不 mock）：
1. 编辑视图的 13 条内置顺序、默认字段在前自建字段在后（R-01/R-09/R-16）；
2. 自建大字段 CRUD：加入当前组 + 全局顺序尾部、重名/超长/内置名冲突、expected_revision 409；
3. 自定义小字段可挂在**任何分区**（内置 13 个也支持，R-11），标签唯一、每分区 ≤20、默认字段保护；
4. 删除定义只软删：条目与值保留、组关系保留、同名重建新 id 不自动关联旧值（R-06/R-13）。
"""

from __future__ import annotations

import pytest
from app.models.profile_definition import ProfileCustomField
from app.models.profile_entry import ProfileEntry
from app.models.profile_group import ProfileGroupMember
from app.services.profile import definition_store, entry_store, group_store
from app.services.profile.errors import (
    Conflict,
    LimitReached,
    NotFound,
    RevisionConflict,
    ValidationError,
)

BUILTIN_ORDER = (
    "basic_info",
    "educations",
    "experiences",
    "projects",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "languages",
)


def _section(db, key):
    return definition_store.get_section(db, key)


def _member_keys(db, group_id):
    return {
        row.section_key for row in db.query(ProfileGroupMember).filter_by(group_id=group_id).all()
    }


def test_list_sections_returns_13_builtins_in_global_order(db_session):
    sections = definition_store.list_sections(db_session)
    assert [section.key for section in sections] == list(BUILTIN_ORDER)
    assert all(section.is_builtin for section in sections)
    assert all(section.revision == 0 for section in sections)
    # R-09：默认小字段逐条来自目录；默认字段在前，order 从 1 递增。
    basic = sections[0]
    assert basic.key == "basic_info" and basic.form == "singleton"
    assert len(basic.fields) == 15
    assert basic.fields[0].field_id == "basic_info.name"
    assert [field.order for field in basic.fields] == list(range(1, 16))
    assert all(field.is_builtin and field.revision == 0 for field in basic.fields)
    # 单例只有 basic_info 与 summary（R-02）。
    assert {section.key for section in sections if section.form == "singleton"} == {
        "basic_info",
        "summary",
    }
    assert definition_store.ensure_section_order(db_session) == list(BUILTIN_ORDER)


def test_create_custom_section_joins_current_group_and_appends_order(db_session):
    before_revision = int(group_store.read_state(db_session).revision)
    section = definition_store.create_custom_section(db_session, " 开源贡献 ")
    assert section.name == "开源贡献"
    assert section.is_builtin is False and section.form == "multi"
    assert section.fields == () and section.revision == 1

    after = group_store.read_state(db_session)
    assert after.revision == before_revision + 1
    assert after.section_order[-1] == section.key
    group = group_store.get_group(db_session, after.current_group_id)
    participants = group_store.group_participating_keys(db_session, group)
    assert participants[0] == "basic_info" and participants[-1] == section.key
    assert section.key in _member_keys(db_session, group.group_id)
    assert definition_store.list_sections(db_session)[-1].key == section.key
    # 自建分区只有自建字段，形态固定 multi。
    merged = _section(db_session, section.key)
    assert merged is not None and merged.is_builtin is False and merged.fields == ()


def test_create_custom_section_rejects_bad_names_and_stale_revision(db_session):
    stale_revision = int(group_store.read_state(db_session).revision)
    for name in ("", "   ", "x" * 41, "基本信息", "教育经历"):
        with pytest.raises(ValidationError):
            definition_store.create_custom_section(db_session, name)
    definition_store.create_custom_section(db_session, "开源贡献")
    with pytest.raises(ValidationError) as duplicate:
        definition_store.create_custom_section(db_session, " 开源贡献 ")
    assert duplicate.value.code == "section_name_duplicate"
    assert "请" in duplicate.value.detail  # 文案必须给出路
    # 场景：另一个窗口拿着旧 state revision 创建 → 409 带当前 revision。
    with pytest.raises(RevisionConflict) as stale:
        definition_store.create_custom_section(
            db_session, "另一个分区", expected_state_revision=stale_revision
        )
    current = group_store.read_state(db_session).revision
    assert stale.value.current_revision == current
    assert stale.value.extra["revision"] == current
    created = definition_store.create_custom_section(
        db_session, "另一个分区", expected_state_revision=current
    )
    assert created.key.startswith("custom:")


def test_rename_custom_section_and_builtin_protection(db_session):
    section = definition_store.create_custom_section(db_session, "开源贡献")
    renamed = definition_store.rename_custom_section(
        db_session, section.key, " 开源贡献集 ", expected_revision=section.revision
    )
    assert renamed.key == section.key
    assert renamed.name == "开源贡献集"
    assert renamed.revision == section.revision + 1
    with pytest.raises(RevisionConflict):
        definition_store.rename_custom_section(
            db_session, section.key, "再改一次", expected_revision=section.revision
        )
    other = definition_store.create_custom_section(db_session, "科研项目经历")
    with pytest.raises(ValidationError) as duplicate:
        definition_store.rename_custom_section(
            db_session, other.key, "开源贡献集", expected_revision=other.revision
        )
    assert duplicate.value.code == "section_name_duplicate"
    for key in ("basic_info", "projects"):
        with pytest.raises(ValidationError) as protected:
            definition_store.rename_custom_section(db_session, key, "改名", expected_revision=0)
        assert protected.value.code == "builtin_protected"
        with pytest.raises(ValidationError) as protected_delete:
            definition_store.delete_custom_section(db_session, key, expected_revision=0)
        assert protected_delete.value.code == "builtin_protected"
    with pytest.raises(NotFound):
        definition_store.rename_custom_section(
            db_session, "custom:missing", "改名", expected_revision=1
        )


def test_delete_custom_section_keeps_entries_and_recreate_is_new_definition(db_session):
    section = definition_store.create_custom_section(db_session, "开源贡献")
    field = definition_store.create_custom_field(db_session, section.key, "仓库地址", "single_line")
    entry_store.upsert_entry(
        db_session, section.key, values={field.field_id: "https://example.com/repo"}
    )
    impact = definition_store.section_deletion_impact(db_session, section.key)
    assert impact == {
        "entry_count": 1,
        "filled_entry_count": 1,
        "can_delete": True,
        "restore_path": "回收站",
        "revision": section.revision,
    }
    deleted = definition_store.delete_custom_section(
        db_session, section.key, expected_revision=impact["revision"]
    )
    assert deleted["entry_count"] == 1 and deleted["can_delete"] is True
    assert _section(db_session, section.key) is None
    state = group_store.read_state(db_session)
    assert section.key not in state.section_order
    # R-06/§6 铁律 4：条目与值保留，组关系也保留（供撤销）。
    kept = db_session.query(ProfileEntry).filter_by(section_key=section.key).all()
    assert len(kept) == 1
    assert kept[0].values == {field.field_id: "https://example.com/repo"}
    assert section.key in _member_keys(db_session, state.current_group_id)
    # 默认编辑视图不含已删分区的历史条目（值仍在库内）。
    assert all(row.section_key != section.key for row in entry_store.list_entries(db_session))
    # 同名重建 = 新定义、新 key、空字段、旧条目不自动关联。
    rebuilt = definition_store.create_custom_section(db_session, "开源贡献")
    assert rebuilt.key != section.key
    assert _section(db_session, rebuilt.key).fields == ()
    assert entry_store.list_entries(db_session, section_key=rebuilt.key) == []


def test_section_deletion_impact_for_builtin_and_missing(db_session):
    builtin = definition_store.section_deletion_impact(db_session, "projects")
    assert builtin["can_delete"] is False
    assert builtin["entry_count"] == 0 and builtin["revision"] == 0
    with pytest.raises(NotFound):
        definition_store.section_deletion_impact(db_session, "custom:missing")


def test_custom_field_allowed_on_builtin_section_and_ordered_after_defaults(db_session):
    before = _section(db_session, "projects")
    default_count = len(before.fields)
    field = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    assert field.is_builtin is False and field.section_key == "projects"
    assert field.revision == 1 and field.order == default_count + 1
    merged = _section(db_session, "projects")
    assert [item.field_id for item in merged.fields][:default_count] == [
        item.field_id for item in before.fields
    ]
    assert [item.is_builtin for item in merged.fields] == [True] * default_count + [False]
    assert merged.fields[-1].field_id == field.field_id
    # 同一内置分区还能继续加（R-11 每个大字段都支持）。
    second = definition_store.create_custom_field(db_session, "projects", "合作方", "multi_line")
    assert [item.field_id for item in _section(db_session, "projects").fields][-2:] == [
        field.field_id,
        second.field_id,
    ]


def test_custom_field_label_rules_and_per_section_limit(db_session):
    definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    with pytest.raises(ValidationError) as duplicate:
        definition_store.create_custom_field(db_session, "projects", " 导师姓名 ", "single_line")
    assert duplicate.value.code == "field_label_duplicate"
    with pytest.raises(ValidationError) as default_conflict:
        definition_store.create_custom_field(db_session, "projects", "项目描述", "multi_line")
    assert default_conflict.value.code == "field_label_duplicate"
    with pytest.raises(ValidationError) as empty:
        definition_store.create_custom_field(db_session, "projects", "  ", "single_line")
    assert empty.value.code == "field_label_empty"
    with pytest.raises(ValidationError) as too_long:
        definition_store.create_custom_field(db_session, "projects", "x" * 41, "single_line")
    assert too_long.value.code == "field_label_too_long"
    with pytest.raises(ValidationError) as bad_type:
        definition_store.create_custom_field(db_session, "projects", "照片墙", "photo")
    assert bad_type.value.code == "field_type_unsupported"
    # 每分区 ≤20 个活动自定义字段：已 1 个，再补 19 个后第 21 个被拒。
    for index in range(19):
        definition_store.create_custom_field(
            db_session, "projects", f"自定义字段{index}", "single_line"
        )
    assert len(_section(db_session, "projects").fields) == 10 + 20
    with pytest.raises(LimitReached) as limited:
        definition_store.create_custom_field(db_session, "projects", "第21个", "single_line")
    assert limited.value.code == "limit_reached"
    assert "20" in limited.value.detail


def test_update_and_delete_custom_field_on_builtin_section(db_session):
    field = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    entry = entry_store.upsert_entry(db_session, "projects", values={field.field_id: "张伟"})
    updated = definition_store.update_custom_field(
        db_session,
        "projects",
        field.field_id,
        label="合作单位",
        sort_order=9,
        expected_revision=field.revision,
    )
    assert updated.label == "合作单位" and updated.revision == field.revision + 1
    with pytest.raises(RevisionConflict):
        definition_store.update_custom_field(
            db_session, "projects", field.field_id, label="再改", expected_revision=field.revision
        )
    with pytest.raises(ValidationError) as builtin_update:
        definition_store.update_custom_field(
            db_session, "projects", "projects.name", label="改名", expected_revision=0
        )
    assert builtin_update.value.code == "builtin_field_protected"
    with pytest.raises(ValidationError) as builtin_delete:
        definition_store.delete_custom_field(
            db_session, "projects", "projects.name", expected_revision=0
        )
    assert builtin_delete.value.code == "builtin_field_protected"
    with pytest.raises(NotFound):
        definition_store.update_custom_field(
            db_session, "projects", "no-such-field", label="x", expected_revision=1
        )
    with pytest.raises(NotFound):
        definition_store.field_deletion_impact(db_session, "projects", "no-such-field")
    # R-14：含值删除必须二次确认，并把已填写条数带回。
    impact = definition_store.field_deletion_impact(db_session, "projects", field.field_id)
    assert impact["affected_entries"] == 1
    assert impact["can_delete"] is True
    assert impact["revision"] == updated.revision
    with pytest.raises(Conflict) as blocked:
        definition_store.delete_custom_field(
            db_session,
            "projects",
            field.field_id,
            expected_revision=impact["revision"],
        )
    assert blocked.value.code == "field_has_values"
    assert blocked.value.extra["affected_entries"] == 1
    deleted = definition_store.delete_custom_field(
        db_session,
        "projects",
        field.field_id,
        expected_revision=impact["revision"],
        confirm_with_values=True,
    )
    assert deleted["affected_entries"] == 1
    assert field.field_id not in [item.field_id for item in _section(db_session, "projects").fields]
    # 值不被清空（只在界面/链路下线）。
    db_session.expire_all()
    row = db_session.query(ProfileEntry).filter_by(entry_id=entry.entry_id).one()
    assert row.values[field.field_id] == "张伟"
    row = db_session.query(ProfileCustomField).filter_by(field_id=field.field_id).one()
    assert row.deleted_at is not None


def test_custom_field_on_custom_section_and_recreate_new_id(db_session):
    section = definition_store.create_custom_section(db_session, "开源贡献")
    field = definition_store.create_custom_field(db_session, section.key, "仓库地址", "single_line")
    merged = _section(db_session, section.key)
    assert [item.field_id for item in merged.fields] == [field.field_id]
    assert merged.fields[0].order == 1 and merged.fields[0].is_builtin is False
    entry = entry_store.upsert_entry(
        db_session, section.key, values={field.field_id: "https://example.com"}
    )
    definition_store.delete_custom_field(
        db_session,
        section.key,
        field.field_id,
        expected_revision=field.revision,
        confirm_with_values=True,
    )
    assert _section(db_session, section.key).fields == ()
    recreated = definition_store.create_custom_field(
        db_session, section.key, "仓库地址", "single_line"
    )
    assert recreated.field_id != field.field_id
    stored = entry_store.get_entry(db_session, section.key, entry.entry_id)
    assert stored.values[field.field_id] == "https://example.com"  # 旧值保留
    assert recreated.field_id not in stored.values  # 同名重建不自动关联

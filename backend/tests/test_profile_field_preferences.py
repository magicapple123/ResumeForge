# SPDX-License-Identifier: Apache-2.0
"""存储层 Q 验收：hidden 与 collapsed_override 独立、三态更新与 409（契约 §6）。

断言只走 services/profile/field_preferences + definition_store 合并视图：
1. 缺失偏好行 = 全默认（hidden=False、collapsed_override=None、revision=0、default_collapsed 取目录）；
2. hidden 与 collapsed_override 两条状态独立存储、互不覆盖；
3. collapsed_override 三态：不传=保持、None=恢复跟随代码默认、bool=显式；
4. 未知字段/跨分区字段拒绝（unknown_field）；expected_revision 过期 409 带当前 revision。
"""

from __future__ import annotations

import pytest
from app.services.profile import (
    definition_catalog,
    definition_store,
    field_preferences,
    profile_reader,
)
from app.services.profile.errors import RevisionConflict, ValidationError

PROJECT_TITLE = "projects.outcome_type"  # 目录里 default_collapsed=True


def _merged_field(db, field_id, section_key):
    section = definition_store.get_section(db, section_key)
    return next(item for item in section.fields if item.field_id == field_id)


def test_missing_preference_reads_defaults(db_session):
    assert field_preferences.load_preferences(db_session) == {}
    assert field_preferences.preference_map(db_session) == {}
    merged = _merged_field(db_session, PROJECT_TITLE, "projects")
    assert merged.hidden is False
    assert merged.collapsed_override is None
    assert merged.preference_revision == 0
    assert merged.default_collapsed is True  # 定义里的默认收起不受偏好缺失影响


def test_hidden_and_collapsed_override_are_independent(db_session):
    first = field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects", hidden=True
    )
    assert (first.hidden, first.collapsed_override, first.revision) == (True, None, 1)
    second = field_preferences.patch_preference(
        db_session,
        PROJECT_TITLE,
        section_key="projects",
        collapsed_override=False,
        expected_revision=first.revision,
    )
    assert second.hidden is True  # 改折叠不覆盖隐藏
    assert second.collapsed_override is False
    assert second.revision == 2
    third = field_preferences.patch_preference(
        db_session,
        PROJECT_TITLE,
        section_key="projects",
        hidden=False,
        expected_revision=second.revision,
    )
    assert third.hidden is False
    assert third.collapsed_override is False  # 恢复 hidden 后折叠记忆仍在
    assert third.revision == 3
    merged = _merged_field(db_session, PROJECT_TITLE, "projects")
    assert merged.hidden is False and merged.collapsed_override is False
    assert merged.preference_revision == 3
    # 偏好行仍保留字段存在性：hidden 不影响编辑视图（只影响恢复清单与消费链路）。
    assert merged.default_collapsed is True


def test_null_collapsed_restores_default_and_unset_keeps_value(db_session):
    first = field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects", collapsed_override=False
    )
    assert first.collapsed_override is False
    first_revision = int(first.revision)
    restored = field_preferences.patch_preference(
        db_session,
        PROJECT_TITLE,
        section_key="projects",
        collapsed_override=None,
        expected_revision=first_revision,
    )
    assert restored.collapsed_override is None  # 传 None = 恢复跟随代码默认
    assert restored.revision == first_revision + 1
    hidden_only = field_preferences.patch_preference(
        db_session,
        PROJECT_TITLE,
        section_key="projects",
        hidden=True,
        expected_revision=restored.revision,
    )
    assert hidden_only.collapsed_override is None  # 没传 = 保持，不是恢复默认
    assert hidden_only.hidden is True


def test_noop_patch_does_not_bump_revision(db_session):
    first = field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects", hidden=True
    )
    same = field_preferences.patch_preference(
        db_session,
        PROJECT_TITLE,
        section_key="projects",
        hidden=True,
        expected_revision=first.revision,
    )
    assert same.revision == first.revision
    untouched = field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects"
    )
    assert untouched.revision == first.revision


def test_revision_conflict_reports_current_value(db_session):
    first = field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects", hidden=True
    )
    with pytest.raises(RevisionConflict) as stale:
        field_preferences.patch_preference(
            db_session,
            PROJECT_TITLE,
            section_key="projects",
            hidden=False,
            expected_revision=first.revision + 99,
        )
    assert stale.value.current_revision == first.revision
    assert stale.value.extra["revision"] == first.revision
    # 行还不存在时 expected_revision 只能为 0。
    with pytest.raises(RevisionConflict) as missing_row:
        field_preferences.patch_preference(
            db_session,
            "projects.name",
            section_key="projects",
            hidden=True,
            expected_revision=1,
        )
    assert missing_row.value.current_revision == 0


def test_unknown_and_foreign_fields_are_rejected(db_session):
    with pytest.raises(ValidationError) as foreign:
        field_preferences.patch_preference(
            db_session, "projects.name", section_key="educations", hidden=True
        )
    assert foreign.value.code == "unknown_field"
    with pytest.raises(ValidationError) as unknown:
        field_preferences.patch_preference(
            db_session, "does.not.exist", section_key="projects", hidden=True
        )
    assert unknown.value.code == "unknown_field"
    assert "请" in unknown.value.detail


def test_custom_field_preferences_on_builtin_and_custom_sections(db_session):
    builtin_custom = definition_store.create_custom_field(
        db_session, "projects", "导师姓名", "single_line"
    )
    pref = field_preferences.patch_preference(
        db_session,
        builtin_custom.field_id,
        section_key="projects",
        collapsed_override=True,
    )
    assert pref.collapsed_override is True
    merged = _merged_field(db_session, builtin_custom.field_id, "projects")
    assert merged.collapsed_override is True and merged.hidden is False
    assert merged.is_builtin is False
    # 跨分区（把内置分区的自定义字段登记到另一个分区）被拒。
    with pytest.raises(ValidationError) as foreign:
        field_preferences.patch_preference(
            db_session, builtin_custom.field_id, section_key="educations", hidden=True
        )
    assert foreign.value.code == "unknown_field"
    # 自建分区上的自定义字段同样可设偏好。
    section = definition_store.create_custom_section(db_session, "开源贡献")
    custom = definition_store.create_custom_field(
        db_session, section.key, "仓库地址", "single_line"
    )
    patched = field_preferences.patch_preference(
        db_session, custom.field_id, section_key=section.key, hidden=True
    )
    assert patched.hidden is True
    merged_custom = _merged_field(db_session, custom.field_id, section.key)
    assert merged_custom.hidden is True and merged_custom.preference_revision == 1


def test_preference_of_deleted_custom_field_is_rejected(db_session):
    field = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    field_preferences.patch_preference(
        db_session, field.field_id, section_key="projects", hidden=True
    )
    definition_store.delete_custom_field(
        db_session, "projects", field.field_id, expected_revision=field.revision
    )
    with pytest.raises(ValidationError) as deleted:
        field_preferences.patch_preference(
            db_session, field.field_id, section_key="projects", hidden=False
        )
    assert deleted.value.code == "unknown_field"
    # 已删字段的偏好行保留在库内（不丢数据），但不再影响编辑视图。
    assert field.field_id in field_preferences.load_preferences(db_session)


def test_preference_map_exposes_stored_state(db_session):
    row = field_preferences.patch_preference(
        db_session,
        PROJECT_TITLE,
        section_key="projects",
        hidden=True,
        collapsed_override=True,
    )
    mapping = field_preferences.preference_map(db_session)
    assert mapping[PROJECT_TITLE] == {
        "hidden": True,
        "collapsed_override": True,
        "revision": row.revision,
    }
    assert {
        field_id: bool(pref.hidden)
        for field_id, pref in field_preferences.load_preferences(db_session).items()
    } == {PROJECT_TITLE: True}


# --- 7-B：hidden 的公开读取入口（唯一实现，全局搜索复用）---------------------------------
def test_hidden_field_ids_is_empty_when_nothing_is_hidden(db_session):
    """空集合：偏好行缺失 = 没隐藏（不为 106 个字段预建行）。"""
    assert field_preferences.hidden_field_ids(db_session) == frozenset()
    # 搜索判据在空库上只剩 private，且 private 来自目录（不来自偏好）。
    assert field_preferences.search_excluded_field_ids(
        db_session
    ) == definition_catalog.private_field_ids()
    assert definition_catalog.private_field_ids() == frozenset({"credentials.credential_number"})


def test_hidden_field_ids_spans_sections_and_custom_fields(db_session):
    """多分区 + 自建字段：一个入口覆盖内置与自建，显式 hidden=False 不算隐藏。"""
    field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects", hidden=True
    )
    # 显式恢复显示的内置字段：偏好行存在但 hidden=False，不属于隐藏集合。
    field_preferences.patch_preference(db_session, "skills.name", section_key="skills", hidden=False)
    custom = definition_store.create_custom_field(db_session, "projects", "导师姓名", "single_line")
    field_preferences.patch_preference(
        db_session, custom.field_id, section_key="projects", hidden=True
    )

    hidden = field_preferences.hidden_field_ids(db_session)
    assert hidden == frozenset({PROJECT_TITLE, custom.field_id})
    assert "skills.name" not in hidden
    # 搜索判据 = hidden ∪ private。
    assert field_preferences.search_excluded_field_ids(db_session) == hidden | frozenset(
        {"credentials.credential_number"}
    )


def test_search_excluded_ids_ignore_material_only(db_session):
    """仅素材 ≠ 不可搜索：material_only 字段即便恒不上纸面也必须留在可搜索集合外。"""
    material = definition_store.create_custom_field(
        db_session, "projects", "内部素材", "single_line", material_only=True
    )
    assert material.material_only is True
    assert field_preferences.hidden_field_ids(db_session) == frozenset()
    assert material.field_id not in field_preferences.search_excluded_field_ids(db_session)

    # 用户手动隐藏它之后才进集合（两个开关彼此独立）。
    field_preferences.patch_preference(
        db_session, material.field_id, section_key="projects", hidden=True
    )
    assert material.field_id in field_preferences.search_excluded_field_ids(db_session)


def test_profile_reader_consumes_the_shared_hidden_ids(db_session):
    """消费层与搜索层读同一份 hidden：改一处两边同时变（不再是两份实现）。"""
    field_preferences.patch_preference(
        db_session, PROJECT_TITLE, section_key="projects", hidden=True
    )
    profile = profile_reader.load_all_consumed_profile(db_session)
    visible_ids = {
        spec.field_id for section in profile.sections.values() for spec in section.fields
    }
    assert PROJECT_TITLE not in visible_ids
    assert PROJECT_TITLE in field_preferences.hidden_field_ids(db_session)

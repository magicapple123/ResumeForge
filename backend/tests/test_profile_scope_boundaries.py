# SPDX-License-Identifier: Apache-2.0
"""读取边界验收（F2-A；验收 Q + 计划 §11 的"消费 DTO 无 collapsed、三链外全量读"）。

证明：C1 键集合与空分区、消费 DTO 类型无折叠态、hidden 裁掉而 collapsed 有值照常参与、
组过滤只减不增、三链外全量读不受组影响、读取快照可脱离 Session（F3 用法）且不写旧表。

全部走真实 store/服务；只通过 conftest 的临时测试库隔离，不读真实库、不写固定路径。
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from dataclasses import fields as dataclass_fields

import pytest
from app.database import SessionLocal
from app.models.profile import Education, UserProfile
from app.models.profile_definition import ProfileCustomSection
from app.models.profile_entry import ProfileEntry
from app.models.profile_group import ProfileGroupMember
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.profile import (
    definition_store,
    entry_store,
    field_preferences,
    group_store,
    profile_reader,
)
from app.services.profile.definition_catalog import SECTION_BY_KEY
from app.services.profile.group_scope import all_sections_scope, resolve_current_group_scope

# 需求 §3 / R-65 的 13 个顺序。写死期望值：目录改错时本文件要变红，而不是跟着一起"正确地"错。
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
_COLLAPSED_NAMES = {"collapsed", "collapsed_override", "hidden", "default_collapsed"}


def _consumed(db_session):
    scope = resolve_current_group_scope(db_session)
    return scope, profile_reader.load_consumed_profile(db_session, scope)


def test_default_scope_is_all_13_sections_in_global_order(db_session):
    """A/R-08/R-20：默认组参与全部 13 项，顺序即全局顺序、基本信息首位。"""
    scope = resolve_current_group_scope(db_session)

    assert scope.participating_keys == BUILTIN_ORDER
    assert scope.section_order == BUILTIN_ORDER
    assert scope.group_name == "默认组" and scope.is_default is True
    assert scope.workspace_revision >= 1


def test_consumed_profile_covers_every_participating_key_without_data(db_session):
    """C1：参与但无数据 → 空元组 + 完整 fields；未参与才整键不出现。"""
    scope, consumed = _consumed(db_session)

    assert tuple(consumed.sections) == scope.participating_keys == BUILTIN_ORDER
    assert consumed.workspace_revision == scope.workspace_revision
    for key, section in consumed.sections.items():
        spec = SECTION_BY_KEY[key]
        assert section.key == key
        assert section.entries == ()  # 在组里但没数据
        assert [field.field_id for field in section.fields] == [
            field.field_id for field in spec.fields
        ]
        assert section.carrier_field_id == spec.carrier_field_id
        assert section.material_only == spec.material_only
        assert section.primary_field_id is None  # 系统分区没有自建主文本字段


def test_consumed_dto_type_has_no_collapsed_state(db_session):
    """Q/R-66：消费 DTO 类型里根本没有折叠/隐藏态，折叠不可能被下游读走。"""
    for model in (ConsumedFieldSpec, ConsumedSection, ConsumedEntry, ConsumedProfile):
        names = {field.name for field in dataclass_fields(model)}
        assert not (names & _COLLAPSED_NAMES), model.__name__

    scope = resolve_current_group_scope(db_session)
    with pytest.raises(FrozenInstanceError):
        scope.group_id = "another-group"  # type: ignore[misc]


def test_group_scope_filters_sections_and_entries_but_keeps_other_data(db_session):
    """B/C：当前组只减少参与分区；组外条目仍在库、但不出现在消费快照里（C1）。"""
    group = group_store.create_group(db_session, "应届生")
    group_store.set_group_members(
        db_session,
        group.group_id,
        ["basic_info", "educations", "projects"],
        expected_revision=group.revision,
    )
    state = group_store.read_state(db_session)
    group_store.switch_current_group(db_session, group.group_id, expected_revision=state.revision)
    entry_store.upsert_entry(db_session, "educations", values={"educations.school": "某大学"})
    entry_store.upsert_entry(db_session, "experiences", values={"experiences.company": "某公司"})

    scope, consumed = _consumed(db_session)
    assert scope.participating_keys == ("basic_info", "educations", "projects")
    assert scope.group_name == "应届生" and scope.is_default is False
    assert tuple(consumed.sections) == scope.participating_keys
    assert consumed.sections["educations"].entries[0].values == {"educations.school": "某大学"}
    assert "experiences" not in consumed.sections  # 未参与整键不出现
    db_session.rollback()
    assert db_session.query(ProfileEntry).filter_by(section_key="experiences").count() == 1


def test_resolve_repairs_dirty_group_membership(db_session):
    """§2.1：解析时补回 basic_info、清掉定义里不存在的 key（唯一读取口负责修复）。"""
    group = group_store.create_group(db_session, "脏数据组")
    group_store.set_group_members(
        db_session, group.group_id, ["educations"], expected_revision=group.revision
    )
    db_session.query(ProfileGroupMember).filter_by(
        group_id=group.group_id, section_key="basic_info"
    ).delete()
    db_session.add(ProfileGroupMember(group_id=group.group_id, section_key="custom:deleted"))
    db_session.commit()
    state = group_store.read_state(db_session)
    group_store.switch_current_group(db_session, group.group_id, expected_revision=state.revision)

    scope = resolve_current_group_scope(db_session)
    assert scope.participating_keys[0] == "basic_info"
    assert "custom:deleted" not in scope.participating_keys
    stored = {
        row[0]
        for row in db_session.query(ProfileGroupMember.section_key).filter_by(
            group_id=group.group_id
        )
    }
    assert "basic_info" in stored and "custom:deleted" not in stored


def test_custom_fields_participate_in_custom_and_builtin_sections(db_session):
    """R-79/C1：自建分区在组内出现，primary_field_id 与自定义字段（定义顺序）带进消费 DTO。"""
    section = definition_store.create_custom_section(db_session, "开源贡献")
    repo = definition_store.create_custom_field(db_session, section.key, "仓库地址", "single_line")
    note = definition_store.create_custom_field(db_session, section.key, "说明", "multi_line")
    db_session.query(ProfileCustomSection).filter_by(key=section.key).update(
        {"primary_field_id": note.field_id}
    )
    db_session.commit()
    entry_store.upsert_entry(
        db_session,
        section.key,
        values={repo.field_id: "https://example.org/repo", note.field_id: "个人项目"},
    )

    _, consumed = _consumed(db_session)
    custom = consumed.sections[section.key]
    assert custom.primary_field_id == note.field_id
    assert custom.form == "multi" and custom.carrier_field_id is None
    assert [field.field_id for field in custom.fields] == [repo.field_id, note.field_id]
    assert all(field.is_builtin is False for field in custom.fields)
    assert custom.entries[0].values == {
        repo.field_id: "https://example.org/repo",
        note.field_id: "个人项目",
    }

    # R-11：自定义小字段也可以加在内置分区（排在默认字段之后），并照常参与消费。
    advisor = definition_store.create_custom_field(
        db_session, "projects", "导师姓名", "single_line"
    )
    entry_store.upsert_entry(
        db_session, "projects", values={"projects.name": "项目B", advisor.field_id: "张伟"}
    )
    _, consumed = _consumed(db_session)
    projects = consumed.sections["projects"]
    assert projects.fields[-1].field_id == advisor.field_id
    assert projects.fields[-1].is_builtin is False
    assert projects.entries[0].values == {
        "projects.name": "项目B",
        advisor.field_id: "张伟",
    }


def test_hidden_field_is_cut_while_collapsed_field_still_participates(db_session):
    """Q/R-66/R-67：hidden 的定义与值都不进消费；collapsed_override 有值照常进。"""
    entry_store.upsert_entry(
        db_session,
        "projects",
        values={
            "projects.name": "项目A",
            "projects.description": "项目描述",
            "projects.role": "负责人",
        },
    )
    field_preferences.patch_preference(
        db_session, "projects.description", section_key="projects", hidden=True
    )
    field_preferences.patch_preference(
        db_session, "projects.role", section_key="projects", collapsed_override=True
    )

    _, consumed = _consumed(db_session)
    project = consumed.sections["projects"]
    assert project.entries[0].values == {
        "projects.name": "项目A",
        "projects.role": "负责人",  # 折叠只是展示态，有值照常参与（R-66）
    }
    field_ids = {field.field_id for field in project.fields}
    assert "projects.description" not in field_ids
    assert "projects.role" in field_ids
    # 隐藏只影响参与性：值仍留在库里（R-67 可恢复）。
    db_session.expire_all()
    stored = db_session.query(ProfileEntry).filter_by(section_key="projects").one()
    assert stored.values["projects.description"] == "项目描述"


def test_deleted_custom_field_definition_disappears_but_value_stays_in_db(db_session):
    """R-06/R-13：删自定义字段只改变可见性，旧值仍在条目 JSON 里、但不进消费快照。"""
    section = definition_store.create_custom_section(db_session, "开源贡献")
    repo = definition_store.create_custom_field(db_session, section.key, "仓库地址", "single_line")
    note = definition_store.create_custom_field(db_session, section.key, "说明", "multi_line")
    entry_store.upsert_entry(
        db_session,
        section.key,
        values={repo.field_id: "https://example.org/repo", note.field_id: "说明文字"},
    )
    definition_store.delete_custom_field(
        db_session,
        section.key,
        repo.field_id,
        expected_revision=repo.revision,
        confirm_with_values=True,
    )

    _, consumed = _consumed(db_session)
    custom = consumed.sections[section.key]
    assert [field.field_id for field in custom.fields] == [note.field_id]
    assert custom.entries[0].values == {note.field_id: "说明文字"}
    db_session.expire_all()
    stored = db_session.query(ProfileEntry).filter_by(section_key=section.key).one()
    assert stored.values[repo.field_id] == "https://example.org/repo"  # 旧值仍保留


def test_soft_deleted_entries_are_excluded_from_consumption(db_session):
    """R-06：软删条目不参与消费（行仍在库，可经回收站恢复）。"""
    first = entry_store.upsert_entry(db_session, "awards", values={"awards.title": "奖项A"})
    second = entry_store.upsert_entry(db_session, "awards", values={"awards.title": "奖项B"})
    entry_store.delete_entry(db_session, "awards", first.entry_id)

    _, consumed = _consumed(db_session)
    assert [entry.entry_id for entry in consumed.sections["awards"].entries] == [second.entry_id]
    db_session.rollback()
    assert db_session.query(ProfileEntry).filter_by(section_key="awards").count() == 2


def test_entries_follow_explicit_sort_order(db_session):
    """R-03/§6 铁律 10：条目顺序取显式 sort_order（不是主键/创建时间）。"""
    for name, order in (("C", 2), ("A", 0), ("B", 1)):
        entry_store.upsert_entry(
            db_session, "skills", values={"skills.name": name}, sort_order=order
        )

    _, consumed = _consumed(db_session)
    skills = consumed.sections["skills"]
    assert [entry.values["skills.name"] for entry in skills.entries] == ["A", "B", "C"]
    assert [entry.sort_order for entry in skills.entries] == [0, 1, 2]


def test_all_sections_scope_ignores_current_group(db_session):
    """R-64 非目标：助手/评分/审阅等三链外仍读全部资料，不受当前组影响。"""
    group = group_store.create_group(db_session, "只含基本信息")
    group_store.set_group_members(
        db_session, group.group_id, ["basic_info"], expected_revision=group.revision
    )
    state = group_store.read_state(db_session)
    group_store.switch_current_group(db_session, group.group_id, expected_revision=state.revision)
    entry_store.upsert_entry(db_session, "educations", values={"educations.school": "全量大学"})

    scope = resolve_current_group_scope(db_session)
    assert scope.participating_keys == ("basic_info",)
    assert all_sections_scope(db_session).participating_keys == BUILTIN_ORDER

    full = profile_reader.load_all_consumed_profile(db_session)
    assert tuple(full.sections) == BUILTIN_ORDER
    assert full.group_id == "" and full.group_name == "全部大字段"
    assert full.sections["educations"].entries[0].values == {"educations.school": "全量大学"}


def test_consumed_snapshot_survives_session_close(db_session):
    """F3 用法：scope + consumed 冻结后可在 Session 关闭之后继续使用（不可变 dataclass）。"""
    session = SessionLocal()
    try:
        scope = resolve_current_group_scope(session)
        consumed = profile_reader.load_consumed_profile(session, scope)
    finally:
        session.close()

    assert tuple(consumed.sections) == BUILTIN_ORDER
    assert consumed.sections["basic_info"].key == "basic_info"
    assert consumed.participating_keys == scope.participating_keys
    assert consumed.group_name == scope.group_name


def test_consumed_read_never_touches_legacy_tables(db_session):
    """R-46 旁证：消费读取不建 user_profile、不改旧表行数（旧资料不迁移也不读）。"""
    profile = UserProfile(name="旧资料张三")
    db_session.add(profile)
    db_session.flush()
    db_session.add(Education(profile_id=profile.id, school="旧资料大学"))
    db_session.commit()
    before = (db_session.query(UserProfile).count(), db_session.query(Education).count())

    _, consumed = _consumed(db_session)
    assert tuple(consumed.sections) == BUILTIN_ORDER

    db_session.rollback()
    after = (db_session.query(UserProfile).count(), db_session.query(Education).count())
    assert after == before == (1, 1)
    assert db_session.query(ProfileEntry).count() == 0


def test_private_channel_flag_is_carried_for_credential_number(db_session):
    """H 的消费层前提：证书编号保留在消费值里供本地编辑/备份，但标志位禁止外发。"""
    entry_store.upsert_entry(
        db_session,
        "credentials",
        values={"credentials.title": "软考", "credentials.credential_number": "NO-123"},
    )

    _, consumed = _consumed(db_session)
    credentials = consumed.sections["credentials"]
    spec = next(
        field for field in credentials.fields if field.field_id == "credentials.credential_number"
    )
    assert spec.private is True
    assert spec.llm_allowed is False and spec.webform_allowed is False
    assert credentials.entries[0].values["credentials.credential_number"] == "NO-123"

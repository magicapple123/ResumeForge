# SPDX-License-Identifier: Apache-2.0
"""存储层 I 验收：默认组保护、bootstrap 修复、删当前组降级告知、成员与全局顺序（契约 §6）。
断言只走 services/profile/group_store（+ 少量直接改库模拟损坏数据）与直接查库：
1. 干净库 bootstrap 恰好一个默认组（13 项参与）+ 单行 state，连续读取幂等；
2. 当前组/默认组缺失等异常数据在读路径修复：切回默认组并留 pending_notice；
3. 组 CRUD：名称 trim/唯一/≤20、默认组可改名不可删（DB CHECK 兜底）、删组不动条目与定义；
4. 删当前组同事务降级到默认组并写告知，撤销恢复组但当前组不回切；参与清单只增删关系行、
   basic_info 恒在首位；切组持久化；全局顺序校验；notice ack。
"""

from __future__ import annotations

import pytest
from app.models.profile_group import ProfileGroup, ProfileGroupMember
from app.services import trash
from app.services.profile import definition_store, entry_store, group_store
from app.services.profile.errors import LimitReached, NotFound, RevisionConflict, ValidationError
from sqlalchemy.exc import IntegrityError

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


def _state(db):
    return group_store.read_state(db)


def _default(db):
    groups = group_store.list_groups(db)
    assert groups[0].is_default
    return groups[0]


def _create(db, name):
    return group_store.create_group(db, name)


def _switch(db, group_id):
    return group_store.switch_current_group(db, group_id, expected_revision=_state(db).revision)


def test_bootstrap_creates_default_group_and_state_idempotently(db_session):
    state = _state(db_session)
    assert state.current_group_id == state.default_group_id
    assert state.section_order == list(BUILTIN_ORDER)
    assert state.pending_notice is None and state.revision == 1
    groups = group_store.list_groups(db_session)
    assert [group.is_default for group in groups] == [True]
    assert groups[0].name == "默认组"
    default = groups[0]
    assert group_store.group_participating_keys(db_session, default) == list(BUILTIN_ORDER)
    # 幂等：连续读取不推进 state / group revision。
    again = _state(db_session)
    assert again.revision == state.revision
    assert group_store.get_group(db_session, default.group_id).revision == default.revision


def test_bootstrap_repairs_missing_current_group_with_notice(db_session):
    default = _default(db_session)
    group = _create(db_session, "社招")
    switched = _switch(db_session, group.group_id)
    assert switched.current_group_id == group.group_id
    # 直接软删当前组，模拟外部/旧数据造成的异常状态。
    row = group_store.get_group(db_session, group.group_id)
    row.deleted_at = row.updated_at  # 任意非空时间
    db_session.commit()
    state = _state(db_session)
    assert state.current_group_id == default.group_id
    notice = state.pending_notice
    assert notice is not None
    assert notice["kind"] == "current_group_missing"
    assert notice["group_id"] == group.group_id
    assert notice["group_name"] == "社招"
    assert state.notice_id and len(state.notice_id) == 24
    assert "默认组" in notice["message"]
    assert _state(db_session).revision == state.revision  # 修复幂等
    with pytest.raises(NotFound):
        _switch(db_session, group.group_id)


def test_bootstrap_rebuilds_missing_default_group(db_session):
    default = _default(db_session)
    # 硬删默认组与成员关系（模拟旧备份/外部工具造成的损坏数据）。
    db_session.query(ProfileGroupMember).filter_by(group_id=default.group_id).delete()
    db_session.query(ProfileGroup).filter_by(group_id=default.group_id).delete()
    db_session.commit()
    state = _state(db_session)
    groups = group_store.list_groups(db_session)
    assert len(groups) == 1 and groups[0].is_default
    rebuilt = groups[0]
    assert rebuilt.is_default and rebuilt.name == "默认组"
    assert rebuilt.group_id != default.group_id
    assert state.default_group_id == rebuilt.group_id
    assert state.current_group_id == rebuilt.group_id
    assert group_store.group_participating_keys(db_session, rebuilt) == list(BUILTIN_ORDER)


def test_list_groups_default_first_then_creation_order(db_session):
    created = [_create(db_session, name) for name in ("社招", "应届生", "科研岗")]
    listed = group_store.list_groups(db_session)
    expected = [_default(db_session).group_id, *(group.group_id for group in created)]
    assert [group.group_id for group in listed] == expected


def test_create_group_adds_basic_info_and_validates_names(db_session):
    group = _create(db_session, " 应届生 ")
    assert group.name == "应届生" and group.is_default is False and group.revision == 1
    assert group_store.group_participating_keys(db_session, group) == ["basic_info"]
    with pytest.raises(ValidationError) as duplicate:
        _create(db_session, "应届生")
    assert duplicate.value.code == "group_name_duplicate"
    ascii_group = _create(db_session, "YingJie")
    with pytest.raises(ValidationError):
        _create(db_session, "yingjie")  # 仅 ASCII 大小写折叠
    assert group_store.get_group(db_session, ascii_group.group_id) is not None
    for bad in ("", "   ", "x" * 41):
        with pytest.raises(ValidationError):
            _create(db_session, bad)


def test_active_group_limit_is_20(db_session):
    for index in range(19):
        _create(db_session, f"组{index}")
    assert len(group_store.list_groups(db_session)) == 20
    with pytest.raises(LimitReached) as limited:
        _create(db_session, "第21个组")
    assert limited.value.code == "limit_reached"
    assert len(group_store.list_groups(db_session)) == 20


def test_rename_group_and_default_protection(db_session):
    default = _default(db_session)
    default_revision = int(default.revision)
    renamed_default = group_store.rename_group(
        db_session, default.group_id, " 我的默认组 ", expected_revision=default_revision
    )
    assert renamed_default.name == "我的默认组"
    assert renamed_default.is_default is True
    assert renamed_default.revision == default_revision + 1
    with pytest.raises(ValidationError) as protected:
        group_store.delete_group(
            db_session, default.group_id, expected_revision=renamed_default.revision
        )
    assert protected.value.code == "default_group_protected"
    # DB CHECK 兜底：默认组软删写不进去。
    row = group_store.get_group(db_session, default.group_id)
    row.deleted_at = row.updated_at
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    group = _create(db_session, "社招")
    group_revision = int(group.revision)
    renamed = group_store.rename_group(
        db_session, group.group_id, "社招组", expected_revision=group_revision
    )
    assert renamed.name == "社招组" and renamed.revision == group_revision + 1
    with pytest.raises(RevisionConflict):
        group_store.rename_group(
            db_session, group.group_id, "再改", expected_revision=group_revision
        )
    other = _create(db_session, "科研岗")
    with pytest.raises(ValidationError) as duplicate:
        group_store.rename_group(
            db_session, other.group_id, "社招组", expected_revision=other.revision
        )
    assert duplicate.value.code == "group_name_duplicate"
    with pytest.raises(NotFound):
        group_store.rename_group(db_session, "unknown-group", "x", expected_revision=1)


def test_delete_current_group_switches_to_default_notifies_and_can_be_restored(db_session):
    default = _default(db_session)
    section = definition_store.create_custom_section(db_session, "开源贡献")
    entry = entry_store.upsert_entry(db_session, section.key, values={})
    project = entry_store.upsert_entry(db_session, "projects", values={"projects.name": "项目A"})
    group = _create(db_session, "社招")
    _switch(db_session, group.group_id)
    revision_before = int(_state(db_session).revision)
    deleted = group_store.delete_group(db_session, group.group_id, expected_revision=group.revision)
    assert deleted["deleted_group_id"] == group.group_id
    assert deleted["switched_to"] == default.group_id
    assert deleted["notice_id"] and len(deleted["notice_id"]) == 24
    state = _state(db_session)
    assert state.current_group_id == default.group_id
    assert state.pending_notice["kind"] == "current_group_deleted"
    assert state.pending_notice["group_name"] == "社招"
    assert state.revision > revision_before
    # 删组不动条目与自建定义（R-19）。
    assert entry_store.get_entry(db_session, section.key, entry.entry_id) is not None
    assert entry_store.get_entry(db_session, "projects", project.entry_id) is not None
    assert definition_store.get_section(db_session, section.key) is not None
    # notice ack：匹配才清，重复 ack 返回 False（R-25）。
    assert group_store.ack_notice(db_session, deleted["notice_id"]) is True
    assert _state(db_session).pending_notice is None
    assert group_store.ack_notice(db_session, deleted["notice_id"]) is False
    assert group_store.ack_notice(db_session, "not-the-notice") is False
    # 撤销（回收站恢复）后组回来，但当前组不回切（R-25 的另一半）。
    db_session.expire_all()
    row = group_store.get_group(db_session, group.group_id, include_deleted=True)
    assert trash.restore(db_session, "profile_group", row.id) is True
    assert group.group_id in [item.group_id for item in group_store.list_groups(db_session)]
    assert _state(db_session).current_group_id == default.group_id


def test_delete_non_current_group_has_no_notice(db_session):
    default = _default(db_session)
    group = _create(db_session, "应届生")
    revision_before = _state(db_session).revision
    deleted = group_store.delete_group(db_session, group.group_id, expected_revision=group.revision)
    assert deleted == {"deleted_group_id": group.group_id, "switched_to": None, "notice_id": None}
    assert _state(db_session).revision == revision_before
    assert _state(db_session).current_group_id == default.group_id
    assert group_store.get_group(db_session, group.group_id) is None
    assert group_store.get_group(db_session, group.group_id, include_deleted=True) is not None
    with pytest.raises(NotFound):
        group_store.delete_group(db_session, "unknown-group", expected_revision=1)


def test_set_group_members_replaces_relations_only(db_session):
    group = _create(db_session, "应届生")
    group_revision = int(group.revision)
    project = entry_store.upsert_entry(db_session, "projects", values={"projects.name": "项目A"})
    members = group_store.set_group_members(
        db_session,
        group.group_id,
        ["projects", "educations"],
        expected_revision=group_revision,
    )
    assert members == ["basic_info", "educations", "projects"]  # 按全局顺序 + 恒首位
    updated = group_store.get_group(db_session, group.group_id)
    assert updated.revision == group_revision + 1
    assert group_store.group_participating_keys(db_session, updated) == members
    # 只增删关系行：资料条目原样。
    stored = entry_store.get_entry(db_session, "projects", project.entry_id)
    assert stored.values == {"projects.name": "项目A"}
    emptied = group_store.set_group_members(
        db_session, group.group_id, [], expected_revision=updated.revision
    )
    assert emptied == ["basic_info"]  # R-21/R-23
    with pytest.raises(ValidationError) as unknown:
        group_store.set_group_members(
            db_session,
            group.group_id,
            ["不存在"],
            expected_revision=group_store.get_group(db_session, group.group_id).revision,
        )
    assert unknown.value.code == "section_not_found"
    with pytest.raises(RevisionConflict):
        group_store.set_group_members(
            db_session, group.group_id, ["awards"], expected_revision=group_revision
        )


def test_switch_current_group_persists_and_validates(db_session):
    default = _default(db_session)
    group = _create(db_session, "社招")
    state = _switch(db_session, group.group_id)
    assert state.current_group_id == group.group_id
    assert _state(db_session).current_group_id == group.group_id
    assert _state(db_session).revision == state.revision
    with pytest.raises(NotFound):
        group_store.switch_current_group(
            db_session, "unknown-group", expected_revision=_state(db_session).revision
        )
    with pytest.raises(RevisionConflict):
        group_store.switch_current_group(
            db_session, group.group_id, expected_revision=state.revision + 99
        )
    group_store.delete_group(db_session, group.group_id, expected_revision=group.revision)
    with pytest.raises(NotFound):
        group_store.switch_current_group(
            db_session, group.group_id, expected_revision=_state(db_session).revision
        )
    assert _state(db_session).current_group_id == default.group_id


def test_set_section_order_validates_and_persists(db_session):
    initial_revision = int(_state(db_session).revision)
    reordered = [BUILTIN_ORDER[0], BUILTIN_ORDER[2], BUILTIN_ORDER[1], *BUILTIN_ORDER[3:]]
    saved = group_store.set_section_order(db_session, reordered, expected_revision=initial_revision)
    assert saved.section_order == reordered
    assert _state(db_session).section_order == reordered
    for bad in (
        [*BUILTIN_ORDER[1:], BUILTIN_ORDER[0]],  # basic_info 不在首位
        BUILTIN_ORDER[:-1],  # 缺一个
        [*BUILTIN_ORDER, "unknown"],  # 多一个
        [BUILTIN_ORDER[0], *BUILTIN_ORDER],  # 重复
    ):
        with pytest.raises(ValidationError):
            group_store.set_section_order(
                db_session, list(bad), expected_revision=_state(db_session).revision
            )
    with pytest.raises(RevisionConflict):
        group_store.set_section_order(
            db_session, list(BUILTIN_ORDER), expected_revision=initial_revision
        )
    # 自建分区固定在建 13 之后且彼此按创建顺序（R-08）。
    first = definition_store.create_custom_section(db_session, "开源贡献")
    second = definition_store.create_custom_section(db_session, "培训课程")
    custom_tail = [first.key, second.key]
    good = [*BUILTIN_ORDER, *custom_tail]
    saved = group_store.set_section_order(
        db_session, good, expected_revision=_state(db_session).revision
    )
    assert saved.section_order == good
    invalid_tail = [BUILTIN_ORDER[0], first.key, *BUILTIN_ORDER[1:], second.key]
    with pytest.raises(ValidationError) as tail_error:
        group_store.set_section_order(
            db_session, invalid_tail, expected_revision=_state(db_session).revision
        )
    assert tail_error.value.code == "custom_section_tail"
    swapped_tail = [*BUILTIN_ORDER, second.key, first.key]
    with pytest.raises(ValidationError) as tail_swap:
        group_store.set_section_order(
            db_session, swapped_tail, expected_revision=_state(db_session).revision
        )
    assert tail_swap.value.code == "custom_section_tail"


def test_read_path_repairs_tampered_section_order_and_members(db_session):
    initial_revision = int(_state(db_session).revision)
    state = _state(db_session)
    state.section_order = ["educations", "basic_info", "custom:gone"]
    db_session.commit()
    repaired = _state(db_session)
    assert repaired.section_order == list(BUILTIN_ORDER)
    assert repaired.revision > initial_revision
    group = _default(db_session)
    db_session.query(ProfileGroupMember).filter_by(
        group_id=group.group_id, section_key="basic_info"
    ).delete()
    db_session.add(ProfileGroupMember(group_id=group.group_id, section_key="custom:gone"))
    db_session.commit()
    participants = group_store.group_participating_keys(db_session, group)
    assert participants[0] == "basic_info"
    assert "custom:gone" not in participants
    remaining = {
        row.section_key
        for row in db_session.query(ProfileGroupMember).filter_by(group_id=group.group_id)
    }
    assert "custom:gone" not in remaining  # 无效 key 被剔除
    assert "basic_info" in remaining  # 补回且落库

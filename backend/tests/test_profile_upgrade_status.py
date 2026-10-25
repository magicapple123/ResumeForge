# SPDX-License-Identifier: Apache-2.0
"""R-47 升级检测验收（F2-A；验收 F）：旧表有内容 vs 新模型为空的全部分支。

**测的是"提示该不该出现"这一件事**：has_legacy_data 与 new_profile_has_entries 两个布尔。
覆盖计划 §11 的 F 清单：旧子表有数据、只有旧 basic、只有旧 summary、只有旧偏好、新模型
空壳、首次有效保存后消失、读取异常不冒充无旧数据；另加 workspace 的 upgrade 槽位与旧表
缺失时跳过。

所有用例都通过 conftest 的临时测试库隔离；旧表数据由 ORM 直接插入（等价于升级前用户库里
已有的行），不写固定路径、不读真实库。
"""

from __future__ import annotations

import pytest
from app.models.profile import Education, UserProfile, utcnow
from app.models.profile_entry import ProfileEntry
from app.models.profile_fact import ProfileFact
from app.models.profile_fact_field_pref import ProfileFactFieldPref
from app.services.profile import legacy_status, profile_reader
from sqlalchemy import text

UPGRADE_API = "/api/profile/upgrade-status"
WORKSPACE_API = "/api/profile/workspace"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"


@pytest.fixture(autouse=True)
def _reset_legacy_table_cache():
    """表存在性缓存是进程级的；每个用例前后清空，避免"某用例删表"污染下一个用例。"""
    legacy_status.invalidate_table_cache()
    yield
    legacy_status.invalidate_table_cache()


def _status(client) -> dict:
    response = client.get(UPGRADE_API)
    assert response.status_code == 200, response.text
    return response.json()


def _workspace_upgrade(client) -> dict:
    response = client.get(WORKSPACE_API)
    assert response.status_code == 200, response.text
    return response.json()["upgrade"]


def _legacy_profile(db_session, **fields) -> UserProfile:
    profile = UserProfile(**fields)
    db_session.add(profile)
    db_session.commit()
    return profile


def _legacy_education(db_session, profile: UserProfile) -> Education:
    row = Education(profile_id=profile.id, school="旧资料大学", major="计算机")
    db_session.add(row)
    db_session.commit()
    return row


def _count(db_session, model) -> int:
    db_session.rollback()
    return db_session.query(model).count()


def test_clean_database_shows_no_upgrade_signal(client):
    """干净数据集：旧表存在但全空、新模型也空 → 两个布尔都是 False（不误报）。"""
    body = _status(client)

    assert body["has_legacy_data"] is False
    assert body["new_profile_has_entries"] is False
    assert body["checked"] is True
    assert _workspace_upgrade(client) == {
        "has_legacy_data": False,
        "new_profile_has_entries": False,
    }


def test_legacy_child_table_content_is_detected(client, db_session):
    """旧子表有数据：只有 education 一行也足以提示"旧资料未显示"。"""
    profile = _legacy_profile(db_session)
    _legacy_education(db_session, profile)

    assert _status(client)["has_legacy_data"] is True
    assert _status(client)["new_profile_has_entries"] is False
    assert _workspace_upgrade(client)["has_legacy_data"] is True


def test_legacy_basic_info_only_is_detected(client, db_session):
    """只有旧 basic（姓名/手机等简历字段）也算旧内容。"""
    _legacy_profile(db_session, name="旧资料张三", phone="13800000000")

    assert _status(client)["has_legacy_data"] is True


def test_legacy_summary_only_is_detected(client, db_session):
    """只有旧个人总结也算旧内容（它是简历正文的一部分）。"""
    _legacy_profile(db_session, summary="十年经验，擅长后端")

    assert _status(client)["has_legacy_data"] is True


def test_legacy_fact_is_detected_but_deleted_fact_is_not(client, db_session):
    """旧补充事实：活动行有内容 → 算；只剩回收站里的行 → 不算。"""
    profile = _legacy_profile(db_session)
    fact = ProfileFact(
        fact_id="factlegacy0000000000000001",
        profile_id=profile.id,
        kind="publication",
        payload={"title": "旧论文", "authors": ["张三"]},
    )
    db_session.add(fact)
    db_session.commit()
    assert _status(client)["has_legacy_data"] is True

    fact.deleted_at = utcnow()
    db_session.commit()
    assert _status(client)["has_legacy_data"] is False


def test_preferences_and_empty_shells_are_not_legacy_content(client, db_session):
    """契约 §2.3：旧偏好/空壳/默认 +86/仅网申专用值都不算旧内容。"""
    # 空壳 user_profile（老版本打开资料页就会创建这样一行）。
    _legacy_profile(db_session, id_number="110101199001011234", expected_salary="20k")
    # 旧事实字段偏好：隐藏项与自定义标签都只是偏好，没有实际资料值。
    db_session.add(
        ProfileFactFieldPref(
            kind="publication",
            hidden_fields=["title"],
            custom_fields=[{"key": "cf_0123456789ab", "label": "自定义"}],
        )
    )
    db_session.commit()

    body = _status(client)
    assert body["has_legacy_data"] is False
    assert body["new_profile_has_entries"] is False


def test_new_model_shell_entries_do_not_count_as_content(client, db_session):
    """新模型空壳（有行但值全空）仍算"新模型为空"：升级提示不能因此消失。"""
    profile = _legacy_profile(db_session)
    _legacy_education(db_session, profile)
    db_session.add_all(
        [
            ProfileEntry(entry_id="entryshell0000000000001", section_key="basic_info", values={}),
            ProfileEntry(
                entry_id="entryshell0000000000002",
                section_key="projects",
                values={"projects.name": "", "projects.description": "   "},
            ),
        ]
    )
    db_session.commit()

    body = _status(client)
    assert body["new_profile_has_entries"] is False
    assert body["has_legacy_data"] is True  # 旧内容还在，提示应继续展示


def test_first_valid_save_makes_the_upgrade_notice_disappear(client, db_session):
    """首次有效保存后：new_profile_has_entries=True，upgrade 槽位自然翻面（不清旧表）。"""
    profile = _legacy_profile(db_session)
    _legacy_education(db_session, profile)
    before = _count(db_session, Education)
    assert _status(client) == {
        "has_legacy_data": True,
        "new_profile_has_entries": False,
        "checked": True,
    }

    response = client.post(
        ENTRIES_API.format(section_key="basic_info"),
        json={"values": {"basic_info.name": "新资料李四"}},
    )
    assert response.status_code == 201, response.text

    after = _status(client)
    assert after["new_profile_has_entries"] is True
    assert after["has_legacy_data"] is False  # 新模型已有内容，不再探测旧表
    assert _workspace_upgrade(client) == {
        "has_legacy_data": False,
        "new_profile_has_entries": True,
    }
    # R-46 旁证：保存新资料不删除、不迁移旧表任何一行。
    assert _count(db_session, Education) == before == 1


def test_status_short_circuits_legacy_probe_when_new_model_has_content(client, monkeypatch):
    """新模型已有实际值时不探测旧表（避免每次资料页都多查几轮旧表）。"""
    response = client.post(
        ENTRIES_API.format(section_key="basic_info"),
        json={"values": {"basic_info.name": "已有新资料"}},
    )
    assert response.status_code == 201, response.text

    def _boom(_db):  # pragma: no cover - 被调用即测试失败
        raise AssertionError("新模型有内容时不应探测旧表")

    monkeypatch.setattr(legacy_status, "has_legacy_data", _boom)
    body = _status(client)
    assert body["has_legacy_data"] is False
    assert body["new_profile_has_entries"] is True


def test_missing_legacy_tables_are_skipped_not_errors(client, db_session):
    """部分历史库可能缺旧表（迁移链允许）：缺表按"无旧内容"跳过，不报错。"""
    db_session.execute(text("DROP TABLE education"))
    db_session.commit()
    legacy_status.invalidate_table_cache()

    body = _status(client)
    assert body["has_legacy_data"] is False
    assert body["new_profile_has_entries"] is False


def test_read_error_is_not_reported_as_no_legacy_data(client, db_session, monkeypatch):
    """旧表读取异常必须抛出去（资料页显示错误并可重试），不能伪装成"没有旧资料"。"""
    profile = _legacy_profile(db_session, name="旧资料张三")
    _legacy_education(db_session, profile)

    def _broken(_db, _model):
        raise RuntimeError("模拟旧表读取失败")

    monkeypatch.setattr(legacy_status, "_table_has_content", _broken)
    with pytest.raises(RuntimeError, match="模拟旧表读取失败"):
        profile_reader.load_workspace_upgrade_status(db_session)


def test_upgrade_status_read_does_not_create_or_consume_new_rows(client, db_session):
    """只读接口：连续读取不创建 user_profile、不写 profile_entry（R-46 旁证）。"""
    first = _status(client)
    second = _status(client)
    assert first == second

    db_session.rollback()
    assert db_session.query(UserProfile).count() == 0
    assert db_session.query(ProfileEntry).count() == 0

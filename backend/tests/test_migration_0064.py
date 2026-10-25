# SPDX-License-Identifier: Apache-2.0
"""0064：资料大字段/组模型的 8 张新表（F1，契约 §2 / §6 第一条）。

边界（与迁移 docstring 同一口径）：
- **只加表**：表集合 = 迁移前 + 8 张新表；旧表集合/列/行数与内容一个字节不变
  （迁移里没有 DROP/DELETE/UPDATE 旧表的语句，也不回填）。
- 新表**不建外键**；活动行唯一性是 partial unique index（软删行不占名称/标签/排序位，
  恢复冲突由 services/trash.py 的 RestoreConflict 守卫翻译成 409）。
- 三个表内 CHECK：单例条目 sort_order=0、默认组不可软删、工作区状态只能一行。
- 表已存在时跳过；downgrade 只删 8 张新表；upgrade → downgrade → upgrade 可用。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

PREVIOUS_REVISION = "0063_profile_fact_field_pref"
MIGRATION_REVISION = "0064_profile_groups"
NEW_TABLES = (
    "profile_custom_section",
    "profile_custom_field",
    "profile_entry",
    "profile_group",
    "profile_group_member",
    "profile_workspace_state",
    "profile_field_preference",
    "profile_usage_snapshot",
)
_FTS_PREFIXES = ("knowledge_fts", "search_fts")

# 每张新表的**完整**列集合（多一列/少一列都会发现；列顺序不参与断言）。
NEW_TABLE_COLUMNS = {
    "profile_custom_section": {
        "id",
        "section_id",
        "key",
        "name",
        "name_key",
        "sort_order",
        "primary_field_id",
        "revision",
        "deleted_at",
        "created_at",
        "updated_at",
    },
    "profile_custom_field": {
        "id",
        "field_id",
        "section_key",
        "label",
        "label_key",
        "field_type",
        "sort_order",
        "revision",
        "deleted_at",
        "created_at",
        "updated_at",
    },
    "profile_entry": {
        "id",
        "entry_id",
        "section_key",
        "sort_order",
        "values",
        "field_snapshot",
        "revision",
        "deleted_at",
        "created_at",
        "updated_at",
    },
    "profile_group": {
        "id",
        "group_id",
        "name",
        "name_key",
        "is_default",
        "revision",
        "deleted_at",
        "created_at",
        "updated_at",
    },
    "profile_group_member": {"group_id", "section_key", "created_at"},
    "profile_workspace_state": {
        "id",
        "current_group_id",
        "default_group_id",
        "section_order",
        "pending_notice",
        "notice_id",
        "revision",
        "created_at",
        "updated_at",
    },
    "profile_field_preference": {
        "id",
        "section_key",
        "field_id",
        "hidden",
        "collapsed_override",
        "revision",
        "created_at",
        "updated_at",
    },
    "profile_usage_snapshot": {
        "id",
        "snapshot_id",
        "task_id",
        "resume_id",
        "group_id",
        "group_name",
        "participating",
        "section_order",
        "definition_revision",
        "data_revision",
        "layout",
        "created_at",
    },
}
# 普通索引 / 部分唯一索引（DDL 里的 WHERE 由 test_indexes_and_partial_uniques 钉住）。
NEW_TABLE_INDEXES = {
    "profile_custom_section": {
        "ux_profile_custom_section_active_name",
        "ix_profile_custom_section_sort_order",
    },
    "profile_custom_field": {
        "ux_profile_custom_field_active_label",
        "ix_profile_custom_field_section_key",
    },
    "profile_entry": {"ux_profile_entry_active_section_sort", "ix_profile_entry_section_key"},
    "profile_group": {"ux_profile_group_active_name", "ux_profile_group_single_default"},
}
PARTIAL_UNIQUE_INDEXES = {
    "ux_profile_custom_section_active_name": "deleted_at IS NULL",
    "ux_profile_custom_field_active_label": "deleted_at IS NULL",
    "ux_profile_entry_active_section_sort": "deleted_at IS NULL",
    "ux_profile_group_active_name": "deleted_at IS NULL",
    "ux_profile_group_single_default": "is_default = 1 AND deleted_at IS NULL",
}
CHECK_CONSTRAINTS = {
    "profile_entry": "ck_profile_entry_singleton_sort_order",
    "profile_group": "ck_profile_group_default_not_deleted",
    "profile_workspace_state": "ck_profile_workspace_state_single_row",
}
# 表内 UNIQUE 约束（不含 partial unique index）的列集合。
UNIQUE_COLUMN_SETS = {
    "profile_custom_section": {("section_id",), ("key",)},
    "profile_custom_field": {("field_id",)},
    "profile_entry": {("entry_id",)},
    "profile_group": {("group_id",)},
    "profile_field_preference": {("section_key", "field_id")},
    "profile_usage_snapshot": {("snapshot_id",), ("task_id",), ("resume_id",)},
}


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _indexes(engine, table: str) -> dict[str, dict]:
    return {item["name"]: item for item in inspect(engine).get_indexes(table)}


def _index_sql(engine, name: str) -> str:
    query = text("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = :name")
    with engine.connect() as connection:
        return connection.execute(query, {"name": name}).scalar_one()


def _insert(engine, sql: str, params: dict | None = None) -> None:
    with engine.begin() as connection:
        connection.execute(text(sql), params or {})


def _insert_rejected(engine, sql: str, params: dict | None = None) -> str:
    with pytest.raises(IntegrityError) as excinfo:
        _insert(engine, sql, params)
    return str(excinfo.value)


def _upgraded(tmp_path, name: str):
    engine = create_engine(f"sqlite:///{tmp_path / name}")
    command.upgrade(build_alembic_config(engine), PREVIOUS_REVISION)
    return engine


def _seed_old_rows(engine) -> None:
    _insert(
        engine,
        "INSERT INTO career_scenario (id, name, created_at) "
        "VALUES (1, '旧场景', '2026-01-01 00:00:00')",
    )
    _insert(engine, "INSERT INTO app_setting (key, value) VALUES ('theme', 'dark')")


def _career_rows(engine) -> list[tuple]:
    with engine.connect() as connection:
        return [
            tuple(row)
            for row in connection.execute(
                text("SELECT id, name, config, created_at FROM career_scenario ORDER BY id")
            )
        ]


def test_upgrade_adds_only_the_eight_new_tables(tmp_path):
    engine = _upgraded(tmp_path, "up.db")
    config = build_alembic_config(engine)
    before_tables = _business_tables(engine)
    before_columns = {table: set(_columns(engine, table)) for table in before_tables}

    command.upgrade(config, MIGRATION_REVISION)

    after_tables = _business_tables(engine)
    assert after_tables - before_tables == set(NEW_TABLES)
    assert before_tables - after_tables == set()
    for table in before_tables:
        assert set(_columns(engine, table)) == before_columns[table], table
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )


def test_new_tables_have_expected_columns_and_no_foreign_keys(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'columns.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    inspector = inspect(engine)
    for table, expected in NEW_TABLE_COLUMNS.items():
        columns = _columns(engine, table)
        assert set(columns) == expected, table
        assert columns["created_at"]["nullable"] is False, table
        assert inspector.get_foreign_keys(table) == [], table
    # 只有 4 张用户内容表带 deleted_at（进回收站）；关系/状态/偏好/快照表没有。
    soft = ("profile_custom_section", "profile_custom_field", "profile_entry", "profile_group")
    assert {table for table in NEW_TABLES if "deleted_at" in _columns(engine, table)} == set(soft)
    member_pk = inspector.get_pk_constraint("profile_group_member")["constrained_columns"]
    assert member_pk == ["group_id", "section_key"]
    for table in ("profile_group_member", "profile_usage_snapshot"):
        assert "updated_at" not in _columns(engine, table), table


def test_indexes_and_partial_uniques(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'indexes.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    inspector = inspect(engine)
    for table, expected in NEW_TABLE_INDEXES.items():
        assert set(_indexes(engine, table)) == expected, table
    for table, name in CHECK_CONSTRAINTS.items():
        assert {item.get("name") for item in inspector.get_check_constraints(table)} == {name}
    for table, expected in UNIQUE_COLUMN_SETS.items():
        unique = {tuple(item["column_names"]) for item in inspector.get_unique_constraints(table)}
        assert unique == expected, table
    # partial unique 的 WHERE 必须在 DDL 里真实存在（不是普通 UNIQUE）。
    for name, predicate in PARTIAL_UNIQUE_INDEXES.items():
        sql = _index_sql(engine, name)
        assert "CREATE UNIQUE INDEX" in sql.upper(), name
        assert f"WHERE {predicate}" in sql, name


def test_group_active_name_is_unique_but_soft_deleted_rows_do_not_occupy(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'group-name.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    insert = (
        "INSERT INTO profile_group (group_id, name, name_key, is_default, created_at) "
        "VALUES (:gid, :name, :key, 0, '2026-01-01 00:00:00')"
    )
    _insert(engine, insert, {"gid": "g1", "name": "应届生", "key": "应届生"})
    rejected = _insert_rejected(engine, insert, {"gid": "g2", "name": " 应届生 ", "key": "应届生"})
    assert "UNIQUE" in rejected.upper()
    # 软删之后名字不算被占用：同名新组可以建（回收站里的行不占活动名）。
    _insert(
        engine,
        "UPDATE profile_group SET deleted_at = '2026-01-02 00:00:00' WHERE group_id = 'g1'",
    )
    _insert(engine, insert, {"gid": "g2", "name": "应届生", "key": "应届生"})
    assert (
        "UNIQUE"
        in _insert_rejected(
            engine, insert, {"gid": "g3", "name": "应届生", "key": "应届生"}
        ).upper()
    )


def test_entry_singleton_check_and_active_sort_uniqueness(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'entry.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    insert = (
        "INSERT INTO profile_entry (entry_id, section_key, sort_order, created_at) "
        "VALUES (:eid, :section, :sort, '2026-01-01 00:00:00')"
    )
    _insert(engine, insert, {"eid": "e1", "section": "basic_info", "sort": 0})
    # 单例分区 CHECK：basic_info 的第二条不能换排序位。
    assert (
        "CHECK"
        in _insert_rejected(
            engine, insert, {"eid": "e2", "section": "basic_info", "sort": 1}
        ).upper()
    )
    _insert(engine, insert, {"eid": "e3", "section": "educations", "sort": 5})
    # 活动行 (section_key, sort_order) 唯一。
    assert (
        "UNIQUE"
        in _insert_rejected(
            engine, insert, {"eid": "e4", "section": "educations", "sort": 5}
        ).upper()
    )
    # 软删不占排序位。
    _insert(
        engine,
        "UPDATE profile_entry SET deleted_at = '2026-01-02 00:00:00' WHERE entry_id = 'e3'",
    )
    _insert(engine, insert, {"eid": "e4", "section": "educations", "sort": 5})


def test_group_default_not_deletable_and_single_default(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'group-default.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    insert = (
        "INSERT INTO profile_group (group_id, name, name_key, is_default, created_at) "
        "VALUES (:gid, :name, :key, :is_default, '2026-01-01 00:00:00')"
    )
    _insert(engine, insert, {"gid": "d1", "name": "默认组", "key": "默认组", "is_default": 1})
    # 活动默认组最多一个（partial unique on is_default WHERE is_default = 1 ...）。
    assert (
        "UNIQUE"
        in _insert_rejected(
            engine,
            insert,
            {"gid": "d2", "name": "另一个默认", "key": "另一个默认", "is_default": 1},
        ).upper()
    )
    # 默认组不可软删（CHECK）。
    assert (
        "CHECK"
        in _insert_rejected(
            engine,
            "UPDATE profile_group SET deleted_at = '2026-01-02 00:00:00' WHERE group_id = 'd1'",
        ).upper()
    )


def test_workspace_state_is_single_row(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'state.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    insert = (
        "INSERT INTO profile_workspace_state (id, current_group_id, default_group_id, created_at) "
        "VALUES (:id, 'g1', 'g1', '2026-01-01 00:00:00')"
    )
    _insert(engine, insert, {"id": 1})
    assert "CHECK" in _insert_rejected(engine, insert, {"id": 2}).upper()


def test_upgrade_preserves_old_rows_and_contents(tmp_path):
    engine = _upgraded(tmp_path, "preserve.db")
    config = build_alembic_config(engine)
    _seed_old_rows(engine)
    old_tables = _business_tables(engine)

    def _count_all() -> int:
        with engine.connect() as connection:
            return sum(
                connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one()
                for table in old_tables
            )

    total_before = _count_all()
    rows_before = _career_rows(engine)
    command.upgrade(config, MIGRATION_REVISION)
    assert _career_rows(engine) == rows_before
    assert _count_all() == total_before
    with engine.connect() as connection:
        assert connection.execute(text("SELECT value FROM app_setting")).scalar_one() == "dark"


def test_downgrade_removes_only_the_eight_new_tables_and_is_reapplicable(tmp_path):
    engine = _upgraded(tmp_path, "down.db")
    config = build_alembic_config(engine)
    _seed_old_rows(engine)
    rows_before = _career_rows(engine)
    before_tables = _business_tables(engine)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)
    assert _business_tables(engine) == before_tables
    assert set(NEW_TABLES).isdisjoint(_business_tables(engine))
    assert _career_rows(engine) == rows_before

    # upgrade → downgrade → upgrade 之后结构仍然完整可用。
    command.upgrade(config, MIGRATION_REVISION)
    assert set(NEW_TABLES) <= _business_tables(engine)


def test_upgrade_skips_tables_that_already_exist(tmp_path):
    """部分历史库/幂等：已存在的表跳过而不是重建（行不能丢）。"""
    engine = _upgraded(tmp_path, "existing.db")
    config = build_alembic_config(engine)
    _insert(
        engine,
        "CREATE TABLE profile_group ("
        "id INTEGER PRIMARY KEY, group_id VARCHAR(32) NOT NULL, "
        "name VARCHAR(40) NOT NULL, name_key VARCHAR(40) NOT NULL, "
        "is_default BOOLEAN NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, "
        "deleted_at DATETIME, created_at DATETIME NOT NULL, updated_at DATETIME)",
    )
    _insert(
        engine,
        "INSERT INTO profile_group (group_id, name, name_key, created_at) "
        "VALUES ('manual', '手工建组', '手工建组', '2026-01-01 00:00:00')",
    )

    command.upgrade(config, MIGRATION_REVISION)

    assert set(NEW_TABLES) <= _business_tables(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT name FROM profile_group WHERE group_id = 'manual'")
            ).scalar_one()
            == "手工建组"
        )

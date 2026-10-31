# SPDX-License-Identifier: Apache-2.0
"""0069：自定义字段的"纸面默认位置"与"仅素材"两列（只加列，不加表）。

边界（与迁移 docstring 同一口径）：
- **表集合前后不变**：只给 ``profile_custom_field`` 加两列，其余表一个不少——
  这是"旧备份仍可导入"成立的前提。
- 新列可空/有默认值：历史行升级后 ``default_placement`` 为 NULL（= 按字段类型自动）、
  ``material_only`` 为 0（= 上纸面），行为逐字节不变。
- 表不存在时**跳过而不是报错**（迁移链也会跑在只有部分业务表的历史库上）。
- downgrade 只删本迁移真正引入的两列，之后可再次 upgrade。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0068_ai_tasks"
MIGRATION_REVISION = "0069_profile_field_placement"
_TABLE = "profile_custom_field"
_NEW_COLUMNS = {"default_placement", "material_only"}
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _at_previous(tmp_path, name: str):
    engine = create_engine(f"sqlite:///{tmp_path / name}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    return engine, config


def test_upgrade_adds_only_two_columns_and_keeps_table_set(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "upgrade.db")
    before_tables = _business_tables(engine)
    before_columns = {table: set(_columns(engine, table)) for table in before_tables}
    assert _NEW_COLUMNS.isdisjoint(before_columns[_TABLE])

    command.upgrade(config, MIGRATION_REVISION)

    # 只加列不加表：表集合前后完全一致（旧备份仍可导入）。
    assert _business_tables(engine) == before_tables
    after_columns = _columns(engine, _TABLE)
    assert set(after_columns) >= _NEW_COLUMNS
    # 其他表的列一个不少、一个不多。
    for table in before_tables - {_TABLE}:
        assert set(_columns(engine, table)) == before_columns[table], table
    # 新列口径：位置可空（NULL = 按类型自动）；仅素材非空且默认 0（上纸面）。
    assert after_columns["default_placement"]["nullable"] is True
    assert after_columns["material_only"]["nullable"] is False
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )


def test_legacy_rows_get_null_placement_and_material_only_zero(tmp_path) -> None:
    """旧记录升级后行为不变：自动位置 + 上纸面，内容一个字节不动。"""
    engine, config = _at_previous(tmp_path, "legacy-rows.db")
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {_TABLE} "
                "(field_id, section_key, label, label_key, field_type, sort_order, revision, "
                " created_at) "
                "VALUES ('fld_legacy0000001', 'educations', '导师姓名', '导师姓名', "
                "'single_line', 0, 1, '2026-01-02 03:04:05')"
            )
        )

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text(f"SELECT default_placement, material_only FROM {_TABLE}")
        ).one()
    assert row[0] is None
    assert row[1] in (0, False)


def test_upgrade_skips_missing_table_on_partial_database(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "partial.db")
    with engine.begin() as connection:
        connection.execute(text(f'DROP TABLE "{_TABLE}"'))

    # 缺表不报错：升级/降级都直接返回。
    command.upgrade(config, MIGRATION_REVISION)
    assert _TABLE not in _business_tables(engine)
    command.downgrade(config, PREVIOUS_REVISION)
    assert _TABLE not in _business_tables(engine)


def test_downgrade_removes_only_the_added_columns(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "downgrade.db")
    before_tables = _business_tables(engine)
    before_columns = _columns(engine, _TABLE)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    after_columns = _columns(engine, _TABLE)
    assert _NEW_COLUMNS.isdisjoint(after_columns)
    # SQLite 重建表会重排列序，按名字比较集合即可。
    assert set(after_columns) == set(before_columns)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == PREVIOUS_REVISION
        )


def test_upgrade_is_idempotent_at_head(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "idempotent.db")
    command.upgrade(config, MIGRATION_REVISION)
    command.upgrade(config, MIGRATION_REVISION)
    assert set(_columns(engine, _TABLE)) >= _NEW_COLUMNS

# SPDX-License-Identifier: Apache-2.0
"""0075：自建板块的「参与岗位相关性筛选」开关（只加列，不加表）。

边界（与迁移 docstring 同一口径）：
- **表集合前后不变**：只给 ``profile_custom_section`` 加一列，其余表一个不少——
  这是"旧备份仍可导入"成立的前提。
- 历史行升级后 ``filter_by_job`` 为 0 = 不参与，生成结果与升级前逐字节一致（需求 6 的
  升级契约：用户不主动打开开关，就看不到任何行为变化）。
- 表不存在时**跳过而不是报错**（迁移链也会跑在只有部分业务表的历史库上）。
- downgrade 只删本迁移引入的那一列，之后可再次 upgrade。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0074_usage_audit_fields"
MIGRATION_REVISION = "0075_profile_section_job_filter"
_TABLE = "profile_custom_section"
_COLUMN = "filter_by_job"
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


def test_upgrade_adds_only_one_column_and_keeps_table_set(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "upgrade.db")
    before_tables = _business_tables(engine)
    before_columns = {table: set(_columns(engine, table)) for table in before_tables}
    assert _COLUMN not in before_columns[_TABLE]

    command.upgrade(config, MIGRATION_REVISION)

    # 只加列不加表：表集合前后完全一致（旧备份仍可导入）。
    assert _business_tables(engine) == before_tables
    after_columns = _columns(engine, _TABLE)
    assert _COLUMN in after_columns
    # 其他表的列一个不少、一个不多。
    for table in before_tables - {_TABLE}:
        assert set(_columns(engine, table)) == before_columns[table], table
    # 非空 + 默认 0：旧行读出来是"不参与"，不是 NULL 三态。
    assert after_columns[_COLUMN]["nullable"] is False
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )


def test_legacy_section_rows_default_to_not_filtered(tmp_path) -> None:
    """旧自建板块升级后仍是无条件进简历（行为不变）。"""
    engine, config = _at_previous(tmp_path, "legacy-rows.db")
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {_TABLE} "
                "(section_id, key, name, name_key, sort_order, revision, created_at) "
                "VALUES ('sec_legacy0000000001', 'custom:sec_legacy0000000001', "
                "'证书与作品', '证书与作品', 0, 1, '2026-01-02 03:04:05')"
            )
        )

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        value = connection.execute(text(f"SELECT {_COLUMN} FROM {_TABLE}")).scalar_one()
    assert value in (0, False)


def test_upgrade_skips_missing_table_on_partial_database(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "partial.db")
    with engine.begin() as connection:
        connection.execute(text(f'DROP TABLE "{_TABLE}"'))

    # 缺表不报错：升级/降级都直接返回。
    command.upgrade(config, MIGRATION_REVISION)
    assert _TABLE not in _business_tables(engine)
    command.downgrade(config, PREVIOUS_REVISION)
    assert _TABLE not in _business_tables(engine)


def test_downgrade_removes_only_the_added_column(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "downgrade.db")
    before_tables = _business_tables(engine)
    before_columns = _columns(engine, _TABLE)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    after_columns = _columns(engine, _TABLE)
    assert _COLUMN not in after_columns
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
    assert _COLUMN in _columns(engine, _TABLE)

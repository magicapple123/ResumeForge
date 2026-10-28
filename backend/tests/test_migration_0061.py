# SPDX-License-Identifier: Apache-2.0
"""0061：职业场景表 + 四个 server-owned 上下文快照列（A1）。

边界（与迁移 docstring 同一口径）：
- **加表 + 加可空列**：迁移后表集合 = 迁移前集合 + ``{career_scenario}``；四个目标表各多
  一列 ``context_snapshot``（nullable，旧行 NULL = 未记录/未使用，零回填）。
- 目标表不存在时**跳过而不是报错**（迁移链也会跑在只有部分业务表的历史库上）。
- downgrade 只删本迁移真正引入的东西：``context_snapshot`` 四列 + ``career_scenario`` 表。
- 加表迁移**不能**照抄"表集合不变"的断言——这里显式断言新增的是哪一张表。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0060_variant_layout"
MIGRATION_REVISION = "0061_career_scenarios"
HEAD_REVISION = "0068_ai_tasks"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
_SNAPSHOT_TABLES = ("resume_generate_task", "resume_record", "resume_version", "resume_variant")


def _business_tables(engine) -> set[str]:
    return {
        name
        for name in inspect(engine).get_table_names()
        if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_career_scenario_table_and_snapshot_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'up.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_snapshot_columns = {table: set(_columns(engine, table)) for table in _SNAPSHOT_TABLES}

    command.upgrade(config, MIGRATION_REVISION)

    after_tables = _business_tables(engine)
    # 加表迁移：新增的必须是且只是 career_scenario（计划 §7.5 的类型区分）。
    assert after_tables - before_tables == {"career_scenario"}
    assert before_tables - after_tables == set()
    for table in _SNAPSHOT_TABLES:
        added = set(_columns(engine, table)) - before_snapshot_columns[table]
        assert added == {"context_snapshot"}, table
        assert _columns(engine, table)["context_snapshot"]["nullable"] is True

    scenario_columns = _columns(engine, "career_scenario")
    assert {"name", "schema_version", "revision", "config", "archived"} <= set(scenario_columns)


def test_old_rows_read_context_snapshot_as_null(tmp_path):
    """旧记录升级后：快照列为 NULL（= 未记录/未使用），内容一个字节不变。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-rows.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record "
                "(title, job_title, company, content, warnings, source, model, tone, "
                " enhancement_enabled, enhancement_level, parse_error, created_at, revision, draft, "
                " document_mode) "
                "VALUES ('旧简历', '', '', '{\"name\": \"张示例\"}', '[]', 'manual', '', "
                "'standard', 0, 'balanced', '', '2026-01-02 03:04:05', 0, 0, 'resume')"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT context_snapshot, content, revision FROM resume_record")
        ).one()
    assert row[0] is None
    assert row[1] == '{"name": "张示例"}'
    assert row[2] == 0


def test_upgrade_skips_missing_tables_on_partial_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        for table in _SNAPSHOT_TABLES:
            connection.execute(text(f'DROP TABLE "{table}"'))

    # 缺表不报错：只建职业场景表，四个快照列全部跳过。
    command.upgrade(config, MIGRATION_REVISION)
    tables = _business_tables(engine)
    assert "career_scenario" in tables
    for table in _SNAPSHOT_TABLES:
        assert table not in tables
    # 降级同样不因缺表而失败。
    command.downgrade(config, PREVIOUS_REVISION)
    assert "career_scenario" not in _business_tables(engine)


def test_downgrade_removes_only_what_this_migration_added(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_columns = {table: set(_columns(engine, table)) for table in _SNAPSHOT_TABLES}

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    for table in _SNAPSHOT_TABLES:
        assert set(_columns(engine, table)) == before_columns[table], table


def test_upgrade_is_idempotent_at_head(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idempotent.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)
    assert "context_snapshot" in _columns(engine, "resume_record")
    assert "career_scenario" in _business_tables(engine)

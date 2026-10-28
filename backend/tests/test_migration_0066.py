# SPDX-License-Identifier: Apache-2.0
"""0066：模拟面试关联简历 + 有效时长（只加列，不加表）。

边界（与迁移 docstring 同一口径）：
- **只加三列**：表集合与迁移前完全一致；``resume_id`` / ``resume_title`` /
  ``duration_seconds`` 出现，且历史行升级后立刻可读（可空 / 有默认值）。
- **升级安全**：``interview_session`` 不存在时跳过而不是报错（迁移链也会跑在只有部分
  业务表的历史库上）；重复升级幂等。
- **downgrade 完整可逆**：三列一并消失，表集合仍不变，之后可再次 upgrade。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0065_snapshot_dangling_refs"
MIGRATION_REVISION = "0066_interview_link_resume_duration"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
_TABLE = "interview_session"
_NEW_COLUMNS = {"resume_id", "resume_title", "duration_seconds"}


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def _at_previous(tmp_path, name: str):
    engine = create_engine(f"sqlite:///{tmp_path / name}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    return engine, config


def test_upgrade_adds_columns_without_changing_tables(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "interview.db")
    before_tables = _business_tables(engine)
    before_columns = {table: _columns(engine, table) for table in before_tables}
    assert _NEW_COLUMNS.isdisjoint(before_columns[_TABLE])

    command.upgrade(config, MIGRATION_REVISION)

    # 表集合一个不变：只加列，不加表也不删表（旧备份仍可导入）。
    assert _business_tables(engine) == before_tables
    assert _columns(engine, _TABLE) >= _NEW_COLUMNS
    for table in before_tables - {_TABLE}:
        assert _columns(engine, table) == before_columns[table], table
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )


def test_downgrade_removes_the_three_columns(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "downgrade.db")
    before_tables = _business_tables(engine)
    before_columns = _columns(engine, _TABLE)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    assert _columns(engine, _TABLE) == before_columns
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == PREVIOUS_REVISION
        )
    # 可再次升级（完整可逆）。
    command.upgrade(config, MIGRATION_REVISION)
    assert _columns(engine, _TABLE) >= _NEW_COLUMNS


def test_upgrade_keeps_existing_rows_readable(tmp_path) -> None:
    """历史行升级后立刻可读：新列可空或有默认值，不能要求回填。"""
    engine, config = _at_previous(tmp_path, "rows.db")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO interview_session "
                "(title, job_title, company, interview_type, difficulty, interviewer_style, "
                " rounds, persona, focus, status, report, model, created_at, updated_at) "
                "VALUES ('旧面试', '', '', '技术面', '中级', '严谨专业', 3, '', '', 'active', "
                "'{}', '', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
            )
        )

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT title, resume_id, resume_title, duration_seconds "
                "FROM interview_session ORDER BY id"
            )
        ).one()
    assert row[0] == "旧面试"
    assert row[1] is None
    assert row[2] in (None, "")
    assert row[3] in (None, 0)


def test_upgrade_skips_missing_table_on_partial_database(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.stamp(config, PREVIOUS_REVISION)

    command.upgrade(config, MIGRATION_REVISION)

    assert _TABLE not in _business_tables(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )
    # 降级同样不因缺表而失败。
    command.downgrade(config, PREVIOUS_REVISION)


def test_upgrade_is_idempotent(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "idempotent.db")
    command.upgrade(config, MIGRATION_REVISION)
    columns = _columns(engine, _TABLE)
    command.upgrade(config, MIGRATION_REVISION)
    assert _columns(engine, _TABLE) == columns

# SPDX-License-Identifier: Apache-2.0
"""0055：resume_version / resume_variant —— W13 命名版本与岗位变体。

覆盖硬规则：**只加表**（既有表结构不变）、表不存在时跳过、完整 downgrade、非空列
server_default（旧包/直接 INSERT 成立），以及旧数据零回填。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0054_resume_document_mode"
MIGRATION_REVISION = "0055_resume_versions"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
NEW_TABLES = {"resume_version", "resume_variant"}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _business_tables(engine) -> set[str]:
    return {name for name in _tables(engine) if not name.startswith(_FTS_PREFIXES)}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_only_tables_and_keeps_existing_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'tables.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_columns = _columns(engine, "resume_record")

    command.upgrade(config, MIGRATION_REVISION)

    assert _business_tables(engine) - before_tables == NEW_TABLES
    assert before_tables - _business_tables(engine) == set()
    assert _columns(engine, "resume_record").keys() == before_columns.keys()


def test_not_null_columns_have_server_defaults(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'defaults.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    expected = {
        ("resume_version", "name"): "",
        ("resume_version", "frozen"): "0",
        ("resume_version", "source"): "manual",
        ("resume_version", "source_revision"): "0",
        ("resume_variant", "name"): "",
        ("resume_variant", "content_sha256"): "",
    }
    for (table, column_name), value in expected.items():
        column = _columns(engine, table)[column_name]
        assert column["nullable"] is False, (table, column_name)
        assert column["default"] is not None, (table, column_name)
        assert str(column["default"]).strip("'\"") == value, (table, column_name)


def test_upgrade_skips_tables_that_already_exist(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE resume_version (id INTEGER PRIMARY KEY, legacy TEXT)")
        )
        connection.execute(text("INSERT INTO resume_version (legacy) VALUES ('keep-me')"))

    command.upgrade(config, MIGRATION_REVISION)

    assert _tables(engine) >= NEW_TABLES
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT legacy FROM resume_version")).scalar_one() == "keep-me"
        )


def test_upgrade_does_not_require_resume_record_to_exist(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, MIGRATION_REVISION)

    assert _tables(engine) >= NEW_TABLES


def test_existing_rows_are_not_touched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'rows.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record "
                "(title, job_title, company, content, warnings, source, model, tone, "
                " enhancement_enabled, enhancement_level, parse_error, created_at, "
                " revision, draft, document_mode) "
                "VALUES ('旧简历', '', '', '{\"name\": \"张示例\"}', '[]', 'manual', '', "
                "'standard', 0, 'balanced', '', '2026-01-02 03:04:05', 2, 0, 'resume')"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT title, revision, document_mode FROM resume_record")
        ).one()
    assert tuple(row) == ("旧简历", 2, "resume")


def test_downgrade_removes_every_new_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before
    assert not (NEW_TABLES & _tables(engine))

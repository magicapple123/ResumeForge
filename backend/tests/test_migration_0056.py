# SPDX-License-Identifier: Apache-2.0
"""0056：resume_phrase —— W17 私有表达资产（只加表、软删列、完整 downgrade、缺表跳过）。"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0055_resume_versions"
MIGRATION_REVISION = "0056_resume_phrases"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
_TABLE = "resume_phrase"


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _business_tables(engine) -> set[str]:
    return {name for name in _tables(engine) if not name.startswith(_FTS_PREFIXES)}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_only_the_phrase_table_and_keeps_existing_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'tables.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_columns = _columns(engine, "resume_record")

    command.upgrade(config, MIGRATION_REVISION)

    assert _business_tables(engine) - before_tables == {_TABLE}
    assert before_tables - _business_tables(engine) == set()
    assert _columns(engine, "resume_record").keys() == before_columns.keys()
    columns = _columns(engine, _TABLE)
    # 软删列是"进回收站第 17 类"的前提；非空列必须有服务端默认值。
    assert columns["deleted_at"]["nullable"] is True
    for name, value in (("kind", "custom"), ("language", ""), ("usage_count", "0")):
        assert columns[name]["nullable"] is False
        assert str(columns[name]["default"]).strip("'\"") == value


def test_upgrade_skips_when_table_already_exists(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE resume_phrase (id INTEGER PRIMARY KEY, legacy TEXT)"))
        connection.execute(text("INSERT INTO resume_phrase (legacy) VALUES ('keep-me')"))

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT legacy FROM resume_phrase")).scalar_one() == "keep-me"
        )


def test_downgrade_removes_the_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before
    assert _TABLE not in _tables(engine)


def test_upgrade_does_not_require_claim_or_resume_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))
        connection.execute(text("DROP TABLE claim_record"))

    command.upgrade(config, MIGRATION_REVISION)

    assert _TABLE in _tables(engine)

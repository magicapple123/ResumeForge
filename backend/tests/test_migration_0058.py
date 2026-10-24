# SPDX-License-Identifier: Apache-2.0
"""0058：变体两列 + 数据集级术语表。含"旧变体行/旧备份升级后仍可读"兼容证据。"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0057_review_annotations"
MIGRATION_REVISION = "0058_resume_bilingual"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
_TABLE = "resume_glossary_term"


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _business_tables(engine) -> set[str]:
    return {name for name in _tables(engine) if not name.startswith(_FTS_PREFIXES)}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_two_variant_columns_and_glossary_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'upgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_variant_columns = set(_columns(engine, "resume_variant"))

    command.upgrade(config, MIGRATION_REVISION)

    after_variant = _columns(engine, "resume_variant")
    assert set(after_variant) - before_variant_columns == {"language", "variant_group_id"}
    # 只加列 + 只加表：既有表集合不变，新增表恰好是术语表。
    assert _business_tables(engine) - before_tables == {_TABLE}
    assert before_tables - _business_tables(engine) == set()
    assert after_variant["language"]["nullable"] is False
    assert str(after_variant["language"]["default"]).strip("'\"") == ""
    assert after_variant["variant_group_id"]["nullable"] is True
    glossary = _columns(engine, _TABLE)
    assert glossary["deleted_at"]["nullable"] is True
    assert str(glossary["locked"]["default"]).strip("'\"") == "1"


def test_old_variant_rows_read_as_unlabelled_language(tmp_path):
    """旧备份/旧变体行升级后：language 读空串、group 为 NULL，正文一个字节不变。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-rows.db'}")
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
                "'standard', 0, 'balanced', '', '2026-01-02 03:04:05', 0, 0, 'resume')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO resume_variant "
                "(resume_id, name, job_title, company, content, render_context, "
                " content_sha256, created_at) "
                "VALUES (1, '旧变体', '', '', '{\"name\": \"张示例\"}', '{}', '', "
                "'2026-01-02 03:04:05')"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT language, variant_group_id, content, name "
                "FROM resume_variant WHERE name = '旧变体'"
            )
        ).one()
    assert row[0] == ""
    assert row[1] is None
    assert row[2] == '{"name": "张示例"}'
    assert row[3] == "旧变体"


def test_upgrade_skips_existing_table_and_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE resume_glossary_term (id INTEGER PRIMARY KEY, legacy TEXT)")
        )
        connection.execute(text("INSERT INTO resume_glossary_term (legacy) VALUES ('keep')"))

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT legacy FROM resume_glossary_term")).scalar_one()
            == "keep"
        )


def test_downgrade_removes_glossary_table_and_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_columns = set(_columns(engine, "resume_variant"))
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    assert set(_columns(engine, "resume_variant")) == before_columns

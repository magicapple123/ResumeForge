# SPDX-License-Identifier: Apache-2.0
"""0054：resume_record.document_mode —— 普通简历 / 长 CV 的文档形态（W14 前置）。

覆盖硬规则：**只加列**（表集合前后不变）、NOT NULL + server_default="resume"（旧备份包
的 INSERT 里没有这一列）、旧行一律读作 resume（升级不改变任何既有简历的导出结果）、
完整 downgrade，以及残缺库（没有 resume_record）跳过而不报错。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0053_resume_provenance"
MIGRATION_REVISION = "0054_resume_document_mode"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_not_null_column_with_resume_default_and_keeps_tables_untouched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'document-mode.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    assert "document_mode" not in _columns(engine, "resume_record")

    command.upgrade(config, MIGRATION_REVISION)

    assert _business_tables(engine) == before
    column = _columns(engine, "resume_record")["document_mode"]
    assert column["nullable"] is False
    assert column["default"] is not None
    assert str(column["default"]).strip("'\"") == "resume"


def test_existing_rows_read_as_resume(tmp_path):
    """升级不能改变任何已有简历的形态：旧行一律 resume。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record "
                "(title, job_title, company, content, warnings, source, model, tone, "
                " enhancement_enabled, enhancement_level, parse_error, created_at, "
                " revision, draft) "
                "VALUES ('旧简历', '', '', '{}', '[]', 'ai', '', 'standard', 0, "
                "'balanced', '', '2026-01-02 03:04:05', 0, 0)"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        mode = connection.execute(
            text("SELECT document_mode FROM resume_record WHERE title = '旧简历'")
        ).scalar_one()
    assert mode == "resume"


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert "document_mode" not in _columns(engine, "resume_record")


def test_upgrade_skips_when_resume_record_table_is_missing(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, HEAD_REVISION)

    assert "resume_record" not in inspect(engine).get_table_names()

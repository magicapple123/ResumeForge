# SPDX-License-Identifier: Apache-2.0
"""0051：``resume_record.draft`` —— 制作台草稿与真简历的分界。

覆盖硬规则：**只加列**（表集合前后不变，"旧备份仍可导入"的前提）、旧行默认
``false``（升级不会让任何一份已有简历从列表里消失）、``NOT NULL`` + 服务端默认值、
完整 downgrade，以及残缺库（没有 resume_record 表）跳过而不报错。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0050_candidate_job_soft_delete"
MIGRATION_REVISION = "0051_resume_draft"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_a_not_null_column_with_a_default_and_keeps_tables_untouched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'draft.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    assert "draft" not in _columns(engine, "resume_record")

    # 升到**本迁移**而不是全局 HEAD：HEAD 之后若有"只加表"的迁移（如 0053），
    # 表集合当然会变；本用例要证明的是 0051 自己只加列。
    command.upgrade(config, MIGRATION_REVISION)

    # 只加列：表集合不变（旧备份导入依赖这一点）。
    assert _business_tables(engine) == before
    column = _columns(engine, "resume_record")["draft"]
    assert column["nullable"] is False
    # 服务端默认值必须留着：旧备份导入时 INSERT 里没有这一列，没有默认值就会整表失败。
    assert column["default"] is not None


def test_existing_rows_are_marked_as_saved(tmp_path):
    """升级不能让用户的简历从列表里消失：历史行一律是"不是草稿"。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_record "
                "(title, job_title, company, content, warnings, source, model, tone, "
                " enhancement_enabled, enhancement_level, parse_error, created_at) "
                "VALUES ('旧简历', '', '', '{}', '[]', 'ai', '', 'standard', 0, 'balanced', '', "
                "'2026-01-02 03:04:05')"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        draft = connection.execute(
            text("SELECT draft FROM resume_record WHERE title = '旧简历'")
        ).scalar_one()
    assert draft in (0, False)


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert "draft" not in _columns(engine, "resume_record")


def test_missing_table_is_skipped_instead_of_failing(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：缺表就跳过，不能整条链失败。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, HEAD_REVISION)

    assert "resume_record" not in inspect(engine).get_table_names()

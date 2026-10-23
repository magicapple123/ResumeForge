# SPDX-License-Identifier: Apache-2.0
"""0047：``resume_record.updated_at`` —— 「最近修改」排序的数据基础。

覆盖硬规则：**只加列**（表集合前后不变，"旧备份仍可导入"的前提）、旧行用
``created_at`` 回填（升级前后顺序一致）、可空（历史数据不阻塞）、完整 downgrade、
以及残缺库（没有 resume_record 表）跳过而不报错。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0046_search_fts"
HEAD_REVISION = "0050_candidate_job_soft_delete"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_a_nullable_column_and_keeps_tables_untouched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'updated_at.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    assert "updated_at" not in _columns(engine, "resume_record")

    command.upgrade(config, HEAD_REVISION)

    # 只加列：表集合不变（旧备份导入依赖这一点）。
    assert _business_tables(engine) == before
    column = _columns(engine, "resume_record")["updated_at"]
    assert column["nullable"] is True


def test_existing_rows_are_backfilled_from_created_at(tmp_path):
    """升级不能让用户的列表重排：旧行的 updated_at 等于它的 created_at。"""
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
        updated_at = connection.execute(
            text("SELECT updated_at FROM resume_record WHERE title = '旧简历'")
        ).scalar_one()
    assert str(updated_at).startswith("2026-01-02 03:04:05")


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert "updated_at" not in _columns(engine, "resume_record")


def test_missing_table_is_skipped_instead_of_failing(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：缺表就跳过，不能整条链失败。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, HEAD_REVISION)

    assert "resume_record" not in inspect(engine).get_table_names()

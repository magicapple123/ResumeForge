# SPDX-License-Identifier: Apache-2.0
"""0052：``resume_record.revision`` —— 内容保存的版本号（条件写的前提）。

覆盖硬规则：**只加列**（表集合前后不变，"旧备份仍可导入"的前提）、``NOT NULL`` +
服务端默认值（旧备份包的 INSERT 里没有这一列）、旧行一律 ``0``（不回填、不按
``updated_at`` 造序号——旧行的"第几版"在数据里无从得知）、完整 downgrade，
以及残缺库（没有 resume_record 表）跳过而不报错。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0051_resume_draft"
MIGRATION_REVISION = "0052_resume_revision"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_not_null_column_and_keeps_tables_untouched(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'revision.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    assert "revision" not in _columns(engine, "resume_record")

    # 升到**本迁移**而不是全局 HEAD：HEAD 之后若有"只加表"的迁移（如 0053），
    # 表集合当然会变；本用例要证明的是 0052 自己只加列。
    command.upgrade(config, MIGRATION_REVISION)

    # 只加列：表集合不变（旧备份导入依赖这一点）。
    assert _business_tables(engine) == before
    column = _columns(engine, "resume_record")["revision"]
    assert column["nullable"] is False
    # 服务端默认值必须留着：旧备份包的 INSERT 里没有这一列，没有默认值就会整表失败。
    # 只断言"不是 None"太松——默认值要是 `NULL` 或别的数，旧包照样出问题；这里钉死为 0。
    assert column["default"] is not None
    assert str(column["default"]).strip("'\"") == "0"


def test_existing_rows_get_revision_zero(tmp_path):
    """不回填：旧行的"第几版"无从得知，0 是唯一诚实的值。"""
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
        revision = connection.execute(
            text("SELECT revision FROM resume_record WHERE title = '旧简历'")
        ).scalar_one()
    assert revision == 0


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert "revision" not in _columns(engine, "resume_record")


def test_upgrade_skips_when_resume_record_table_is_missing(tmp_path):
    """迁移链也会跑在"只有部分业务表"的历史库上：缺表就跳过，不能整条链失败。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, HEAD_REVISION)

    assert "resume_record" not in inspect(engine).get_table_names()

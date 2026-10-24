# SPDX-License-Identifier: Apache-2.0
"""0053：W12 持久来源/来源修订/块关联/事实锁 + R04 用量账本。

覆盖 AGENTS.md 的迁移硬规则：**只加表**（既有表结构一个列都不动，旧备份仍可导入）、
新表不存在时跳过而不是报错（迁移链会跑在只有部分业务表的历史库上）、**完整 downgrade**、
非空列带服务端默认值（旧包导入/直接 INSERT 都成立），以及"旧数据一行都不用回填"。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0052_resume_revision"
MIGRATION_REVISION = "0053_resume_provenance"
HEAD_REVISION = "0059_resume_export"

NEW_TABLES = {
    "resume_source",
    "resume_source_revision",
    "resume_block_source",
    "resume_fact_lock",
    "llm_usage_record",
}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_only_tables_and_keeps_existing_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add-tables.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _tables(engine)
    before_columns = _columns(engine, "resume_record")

    # 升到本迁移（全局 HEAD 之后还有 0054 只加列，会让 resume_record 列集合变化）。
    command.upgrade(config, MIGRATION_REVISION)

    assert _tables(engine) - before_tables == NEW_TABLES
    assert before_tables - _tables(engine) == set()
    # 既有表一个列都不变：这是"旧备份仍可导入"的判据。
    assert _columns(engine, "resume_record").keys() == before_columns.keys()


def test_not_null_columns_have_server_defaults(tmp_path):
    """服务端默认值不是可选美化：旧包/直接 INSERT 不带这些列时必须能落库。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'defaults.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    expected = {
        ("resume_source", "kind"): "manual",
        ("resume_source_revision", "revision_no"): "1",
        ("resume_fact_lock", "lock_kind"): "name",
        ("llm_usage_record", "task"): "unknown",
        ("llm_usage_record", "retries"): "0",
    }
    for (table, column_name), value in expected.items():
        column = _columns(engine, table)[column_name]
        assert column["nullable"] is False, (table, column_name)
        assert column["default"] is not None, (table, column_name)
        assert str(column["default"]).strip("'\"") == value, (table, column_name)

    # 默认值真的能落一行（不是只写在 DDL 里）。
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO llm_usage_record DEFAULT VALUES"))
        row = connection.execute(
            text("SELECT task, retries, finish_reason FROM llm_usage_record")
        ).one()
    assert tuple(row) == ("unknown", 0, "")


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
                " revision, draft) "
                "VALUES ('旧简历', '', '', '{\"name\": \"张示例\"}', '[]', 'manual', '', "
                "'standard', 0, 'balanced', '', '2026-01-02 03:04:05', 3, 0)"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        row = connection.execute(text("SELECT title, content, revision FROM resume_record")).one()
    assert row[0] == "旧简历"
    assert row[1] == '{"name": "张示例"}'
    assert row[2] == 3


def test_upgrade_skips_tables_that_already_exist(tmp_path):
    """legacy 库可能先被 create_all/补列建过其中某张表：跳过它，不能整条链失败。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE resume_source (id INTEGER PRIMARY KEY, legacy TEXT)"))
        connection.execute(text("INSERT INTO resume_source (legacy) VALUES ('keep-me')"))

    command.upgrade(config, HEAD_REVISION)

    assert _tables(engine) >= NEW_TABLES
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT legacy FROM resume_source")).scalar_one() == "keep-me"
        )


def test_upgrade_does_not_require_resume_record_to_exist(tmp_path):
    """残缺历史库（只有部分业务表）也能升到 head：新表创建不依赖正文表存在。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, HEAD_REVISION)

    assert _tables(engine) >= NEW_TABLES


def test_downgrade_removes_every_new_table_and_keeps_the_rest(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _tables(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _tables(engine) == before_tables
    assert not (NEW_TABLES & _tables(engine))

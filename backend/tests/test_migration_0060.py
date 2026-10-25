# SPDX-License-Identifier: Apache-2.0
"""0060：W16 变体独立排版列（resume_variant.layout）+ 旧库缺列兜底。

边界（与迁移 docstring 同一口径）：
- **只加列**：既有表集合前后不变，旧备份仍可导入；旧行零回填（layout = NULL 表示继承）。
- **已有列 vs 0060 幂等兜底**（本文件的核心区分）：
  * 0060 真正引入的只有 `resume_variant.layout`（升级加、降级删）；
  * `resume_phrase.job_tags` 与 `llm_usage_record.finish_reason` 的**权威归属**是
    0056_resume_phrases / 0053_resume_provenance，常规迁移链上本来就有这两列；
    0060 只对"部分历史库 / 手工建表库缺列"做兜底（已存在则跳过，不重复建列、
    不改既有列定义），降级**不删**这两列（删了会破坏更早 revision 语义并丢数据）。
    对应用例：test_upgrade_adds_only_variant_layout_column（已有列不被重复建）与
    test_upgrade_backfills_missing_columns_from_legacy_tables（缺列兜底）。
- 表不存在时跳过而不是报错（迁移链会跑在只有部分业务表的历史库上）。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0059_resume_export"
MIGRATION_REVISION = "0060_variant_layout"
HEAD_REVISION = "0060_variant_layout"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _business_tables(engine) -> set[str]:
    return {name for name in _tables(engine) if not name.startswith(_FTS_PREFIXES)}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _insert_legacy_variant(engine, table: str = "resume_variant") -> None:
    """在 0059 形态的库里插一行旧变体（没有 layout 列，也没有显式 set 它）。"""
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
                f"INSERT INTO {table} "
                "(resume_id, name, job_title, company, content, render_context, "
                " content_sha256, created_at) "
                "VALUES (1, '旧变体', '', '', '{\"name\": \"张示例\"}', '{}', '', "
                "'2026-01-02 03:04:05')"
            )
        )


def test_upgrade_adds_only_variant_layout_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'up.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_variant_columns = set(_columns(engine, "resume_variant"))
    # 权威归属在 0056/0053 的两列在常规链上就已存在。
    assert "job_tags" in _columns(engine, "resume_phrase")
    assert "finish_reason" in _columns(engine, "llm_usage_record")

    command.upgrade(config, MIGRATION_REVISION)

    after_variant = _columns(engine, "resume_variant")
    # 只加一列：既有表集合前后不变（旧备份仍可导入的前提）。
    assert _business_tables(engine) == before_tables
    assert set(after_variant) - before_variant_columns == {"layout"}
    assert after_variant["layout"]["nullable"] is True
    assert after_variant["layout"]["default"] is None
    # 兜底列在常规链上不应被重复建（列定义也不该被改写）。
    assert before_variant_columns == set(after_variant) - {"layout"}


def test_old_variant_rows_read_layout_as_null(tmp_path):
    """旧备份/旧变体行升级后：layout 读 NULL、正文一个字节不变。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'old-rows.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    _insert_legacy_variant(engine)

    command.upgrade(config, HEAD_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT layout, content, name FROM resume_variant WHERE name = '旧变体'")
        ).one()
    assert row[0] is None
    assert row[1] == '{"name": "张示例"}'
    assert row[2] == "旧变体"


def test_upgrade_skips_missing_tables_on_partial_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        for table in ("resume_variant", "resume_phrase", "llm_usage_record"):
            connection.execute(text(f'DROP TABLE "{table}"'))

    # 缺表不报错：迁移链会跑在只有部分业务表的历史库上。
    command.upgrade(config, MIGRATION_REVISION)
    assert "resume_variant" not in _tables(engine)
    assert "resume_record" in _tables(engine)
    # 降级同样不因缺表而失败。
    command.downgrade(config, PREVIOUS_REVISION)


def test_upgrade_backfills_missing_columns_from_legacy_tables(tmp_path):
    """部分历史库/手工库缺列时兜底补上；已有行取 server_default，不丢数据。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE "resume_phrase"'))
        connection.execute(text("CREATE TABLE resume_phrase (id INTEGER PRIMARY KEY, text TEXT)"))
        connection.execute(text("INSERT INTO resume_phrase (id, text) VALUES (1, '旧表达')"))
        connection.execute(text('DROP TABLE "llm_usage_record"'))
        connection.execute(
            text("CREATE TABLE llm_usage_record (id INTEGER PRIMARY KEY, task VARCHAR(32))")
        )
        connection.execute(text("INSERT INTO llm_usage_record (id, task) VALUES (1, 'assistant')"))

    command.upgrade(config, MIGRATION_REVISION)

    phrase = _columns(engine, "resume_phrase")
    usage = _columns(engine, "llm_usage_record")
    assert phrase["job_tags"]["nullable"] is False
    assert str(phrase["job_tags"]["default"]).strip("'\"") == "[]"
    assert usage["finish_reason"]["nullable"] is False
    with engine.connect() as connection:
        assert connection.execute(text("SELECT job_tags FROM resume_phrase")).scalar_one() == "[]"
        assert (
            connection.execute(text("SELECT finish_reason FROM llm_usage_record")).scalar_one()
            == ""
        )


def test_downgrade_removes_only_the_new_layout_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_columns = set(_columns(engine, "resume_variant"))
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    assert set(_columns(engine, "resume_variant")) == before_columns
    # 0056/0053 的列不因 0060 降级而消失（它们的 canonical 归属不在本迁移）。
    assert "job_tags" in _columns(engine, "resume_phrase")
    assert "finish_reason" in _columns(engine, "llm_usage_record")


def test_upgrade_is_idempotent_at_head(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idempotent.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)
    assert "layout" in _columns(engine, "resume_variant")

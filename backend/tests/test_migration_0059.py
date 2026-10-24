# SPDX-License-Identifier: Apache-2.0
"""0059：导出配置 + 交付原件归档（只加表、默认值/外键、完整 downgrade、缺表跳过）。"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0058_resume_bilingual"
MIGRATION_REVISION = "0059_resume_export"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
NEW_TABLES = {"resume_export_preset", "resume_export_artifact"}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _business_tables(engine) -> set[str]:
    return {name for name in _tables(engine) if not name.startswith(_FTS_PREFIXES)}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_only_two_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'up.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)

    command.upgrade(config, MIGRATION_REVISION)

    after = _business_tables(engine)
    assert after - before == NEW_TABLES
    assert before - after == set()
    preset = _columns(engine, "resume_export_preset")
    assert preset["config"]["nullable"] is False
    assert str(preset["config"]["default"]).strip("'\"") == "{}"
    assert preset["is_default"]["nullable"] is False
    assert str(preset["is_default"]["default"]).strip("'\"") in {"0", "false"}
    artifact = _columns(engine, "resume_export_artifact")
    assert artifact["kind"]["nullable"] is False
    assert artifact["disk_name"]["nullable"] is False
    assert artifact["delivery_id"]["nullable"] is True
    # FK 都是 SET NULL：删交付/简历不连坐原件行（文件由显式删除管理）。
    foreign_keys = inspect(engine).get_foreign_keys("resume_export_artifact")
    assert {item["referred_table"] for item in foreign_keys} >= {
        "resume_delivery_record",
        "resume_record",
    }
    assert all(item["options"].get("ondelete") == "SET NULL" for item in foreign_keys)


def test_upgrade_skips_when_tables_exist(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE resume_export_preset (id INTEGER PRIMARY KEY, legacy TEXT)")
        )
        connection.execute(text("INSERT INTO resume_export_preset (legacy) VALUES ('keep')"))

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT legacy FROM resume_export_preset")).scalar_one()
            == "keep"
        )


def test_downgrade_removes_both_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before
    assert not (NEW_TABLES & _tables(engine))

# SPDX-License-Identifier: Apache-2.0
"""0057：resume_review_annotation —— W18 离线对象批注（只加表、唯一约束、完整 downgrade）。"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0056_resume_phrases"
MIGRATION_REVISION = "0057_review_annotations"
HEAD_REVISION = "0059_resume_export"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
_TABLE = "resume_review_annotation"


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _business_tables(engine) -> set[str]:
    return {name for name in _tables(engine) if not name.startswith(_FTS_PREFIXES)}


def test_upgrade_adds_only_the_annotation_table_and_keeps_existing_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'tables.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)
    before_columns = {column["name"] for column in inspect(engine).get_columns("resume_record")}

    command.upgrade(config, MIGRATION_REVISION)

    assert _business_tables(engine) - before_tables == {_TABLE}
    assert before_tables - _business_tables(engine) == set()
    assert {column["name"] for column in inspect(engine).get_columns("resume_record")} == (
        before_columns
    )
    # 契约 §4.3：唯一约束与状态索引是去重/列表查询的前提。
    unique_constraints = inspect(engine).get_unique_constraints(_TABLE)
    assert any(
        set(item["column_names"]) == {"share_package_id", "external_id"}
        for item in unique_constraints
    )
    assert any(
        set(item["column_names"]) == {"resume_id", "status"}
        for item in inspect(engine).get_indexes(_TABLE)
    )
    # 不加 deleted_at：批注用 dismissed 表达"不要了"，回收站仍 17 类。
    assert "deleted_at" not in {column["name"] for column in inspect(engine).get_columns(_TABLE)}


def test_upgrade_skips_when_table_already_exists(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE resume_review_annotation (id INTEGER PRIMARY KEY, legacy TEXT)")
        )
        connection.execute(text("INSERT INTO resume_review_annotation (legacy) VALUES ('keep')"))

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT legacy FROM resume_review_annotation")).scalar_one()
            == "keep"
        )


def test_upgrade_does_not_require_package_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE share_package"))
        connection.execute(text("DROP TABLE resume_record"))

    command.upgrade(config, MIGRATION_REVISION)

    assert _TABLE in _tables(engine)


def test_downgrade_removes_the_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'downgrade.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = _business_tables(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before
    assert _TABLE not in _tables(engine)

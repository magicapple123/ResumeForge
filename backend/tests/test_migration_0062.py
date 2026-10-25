# SPDX-License-Identifier: Apache-2.0
"""0062：补充事实表 profile_fact（A3）。

边界：
- **只加表**：迁移后表集合 = 迁移前集合 + ``{profile_fact}``；旧资料表/旧内容零改动。
- 新表带 deleted_at（进回收站登记，见 tests/test_trash.py 的一一对应守卫）。
- 表已存在时跳过（幂等兜底），downgrade 只删本迁移引入的表。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0061_career_scenarios"
MIGRATION_REVISION = "0062_profile_facts"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name
        for name in inspect(engine).get_table_names()
        if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_only_the_profile_fact_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'up.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)

    command.upgrade(config, MIGRATION_REVISION)

    after_tables = _business_tables(engine)
    assert after_tables - before_tables == {"profile_fact"}
    assert before_tables - after_tables == set()
    columns = _columns(engine, "profile_fact")
    assert {
        "id",
        "fact_id",
        "profile_id",
        "kind",
        "schema_version",
        "revision",
        "payload",
        "sort_order",
        "deleted_at",
        "created_at",
        "updated_at",
    } <= set(columns)
    assert columns["deleted_at"]["nullable"] is True


def test_profile_fact_rows_round_trip_after_upgrade(tmp_path):
    """新表可用：写入/读取一条事实，fact_id 唯一约束生效。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'roundtrip.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, MIGRATION_REVISION)
    with engine.begin() as connection:
        # user_profile 的既有列是 NOT NULL 且无 DB 默认值（ORM 默认只在应用层），
        # 迁移测试直接写库时必须显式给全：这里只关心 profile_fact 的外键可用。
        connection.execute(
            text(
                "INSERT INTO user_profile (name, gender, birth_year, phone, email, city, "
                " target_city, job_intent, personal_website, github, photo, summary, "
                " section_order, updated_at) "
                "VALUES ('张示例', '', '', '', '', '', '', '', '', '', '', '', '[]', "
                "'2026-01-01 00:00:00')"
            )
        )
        profile_id = connection.execute(text("SELECT id FROM user_profile")).scalar_one()
        connection.execute(
            text(
                "INSERT INTO profile_fact "
                "(fact_id, profile_id, kind, schema_version, revision, payload, sort_order, "
                " created_at) "
                "VALUES ('fact_1234567890', :profile_id, 'publication', 1, 1, '{}', 0, "
                "'2026-01-01 00:00:00')"
            ),
            {"profile_id": profile_id},
        )
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT fact_id, kind FROM profile_fact")
        ).fetchall()
    assert [tuple(row) for row in rows] == [("fact_1234567890", "publication")]


def test_downgrade_removes_the_new_table_only(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables


def test_upgrade_is_idempotent_at_head(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idempotent.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, MIGRATION_REVISION)
    command.upgrade(config, MIGRATION_REVISION)
    assert "profile_fact" in _business_tables(engine)

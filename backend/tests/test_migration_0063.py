# SPDX-License-Identifier: Apache-2.0
"""0063：补充事实字段偏好表 profile_fact_field_pref（灵活化契约 §3）。

边界：
- **只加表**：迁移后表集合 = 迁移前集合 + {profile_fact_field_pref}；事实表/旧资料
  表零改动（profile_fact 本身来自 0062）。
- 无 deleted_at：它是行为偏好，不进回收站（与 tests/test_trash.py 的一一对应守卫无关）。
- 表已存在时跳过（幂等兜底）；downgrade 只删本迁移引入的表。
- 旧库跳过：模拟"库里已经有这张表"的历史状态，upgrade 不得报错、不得重建。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0062_profile_facts"
MIGRATION_REVISION = "0063_profile_fact_field_pref"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def test_upgrade_adds_only_the_field_pref_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'up.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)

    command.upgrade(config, MIGRATION_REVISION)

    after_tables = _business_tables(engine)
    assert after_tables - before_tables == {"profile_fact_field_pref"}
    assert before_tables - after_tables == set()
    columns = _columns(engine, "profile_fact_field_pref")
    assert {
        "id",
        "kind",
        "hidden_fields",
        "custom_fields",
        "revision",
        "created_at",
        "updated_at",
    } <= set(columns)
    assert "deleted_at" not in columns
    # hidden/custom 都是 JSON 列表默认空：缺失行语义 = 全部默认字段可见、无自定义字段。
    assert columns["hidden_fields"]["nullable"] is False
    assert columns["custom_fields"]["nullable"] is False


def test_kind_is_unique_per_type(tmp_path):
    """同一类型只能有一行 prefs：唯一约束在迁移层真的生效。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'unique.db'}")
    command.upgrade(build_alembic_config(engine), MIGRATION_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO profile_fact_field_pref (kind, hidden_fields, custom_fields, "
                "revision, created_at) VALUES ('publication', '[]', '[]', 1, "
                "'2026-01-01 00:00:00')"
            )
        )
    with engine.begin() as connection:
        try:
            connection.execute(
                text(
                    "INSERT INTO profile_fact_field_pref (kind, hidden_fields, custom_fields, "
                    "revision, created_at) VALUES ('publication', '[]', '[]', 1, "
                    "'2026-01-01 00:00:00')"
                )
            )
        except Exception as exc:  # noqa: BLE001 - 直接写库的约束错误类型由驱动给出
            assert "UNIQUE" in str(exc).upper()
        else:  # pragma: no cover - 约束失效时给出清晰失败
            raise AssertionError("profile_fact_field_pref.kind 的唯一约束没有生效")


def test_downgrade_removes_the_new_table_only(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before_tables = _business_tables(engine)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    assert "profile_fact_field_pref" not in _business_tables(engine)


def test_upgrade_is_idempotent_at_head(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'idempotent.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, MIGRATION_REVISION)
    command.upgrade(config, MIGRATION_REVISION)
    assert "profile_fact_field_pref" in _business_tables(engine)


def test_upgrade_skips_when_table_already_exists(tmp_path):
    """旧库/幂等场景：表已存在时 upgrade 直接跳过，不重建也不清空行。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE profile_fact_field_pref ("
                "id INTEGER PRIMARY KEY, kind VARCHAR(24) NOT NULL UNIQUE, "
                "hidden_fields JSON NOT NULL DEFAULT '[]', "
                "custom_fields JSON NOT NULL DEFAULT '[]', "
                "revision INTEGER NOT NULL DEFAULT 1, created_at DATETIME NOT NULL, "
                "updated_at DATETIME)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO profile_fact_field_pref (kind, hidden_fields, custom_fields, "
                "revision, created_at) VALUES (:kind, :hidden, :custom, 7, "
                "'2026-01-01 00:00:00')"
            ),
            {"kind": "award", "hidden": '["issuer"]', "custom": "[]"},
        )

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT kind, revision FROM profile_fact_field_pref WHERE kind = 'award'")
        ).fetchone()
    assert tuple(row) == ("award", 7)

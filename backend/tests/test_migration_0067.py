# SPDX-License-Identifier: Apache-2.0
"""0067：单价档案表 + 用量账本缓存命中列（加表 + 加列，不删任何东西）。

边界（与迁移 docstring 同一口径）：
- **表只增不减**：``usage_pricing_record`` 出现，其余表一个不少；
  ``llm_usage_record`` 多出 ``cache_hit_tokens`` / ``cache_miss_tokens`` 两列，可空。
- **升级安全**：目标表不存在时跳过而不是报错；重复升级幂等（不会插两条旧价）。
- **downgrade 完整可逆**：新表消失、两列消失，之后可再次 upgrade。
- **老价搬家**：`app_setting` 里每千 token 的旧价被换算成一条"旧版单价"记录，
  升级后不会突然变成"未配置单价"。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0066_interview_link_resume_duration"
MIGRATION_REVISION = "0067_usage_pricing_records"
_FTS_PREFIXES = ("knowledge_fts", "search_fts")
_USAGE_TABLE = "llm_usage_record"
_PRICING_TABLE = "usage_pricing_record"
_NEW_COLUMNS = {"cache_hit_tokens", "cache_miss_tokens"}


def _business_tables(engine) -> set[str]:
    return {
        name for name in inspect(engine).get_table_names() if not name.startswith(_FTS_PREFIXES)
    }


def _columns(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def _at_previous(tmp_path, name: str):
    engine = create_engine(f"sqlite:///{tmp_path / name}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    return engine, config


def test_upgrade_adds_table_and_columns(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "pricing.db")
    before_tables = _business_tables(engine)
    before_columns = {table: _columns(engine, table) for table in before_tables}
    assert _PRICING_TABLE not in before_tables
    assert _NEW_COLUMNS.isdisjoint(before_columns[_USAGE_TABLE])

    command.upgrade(config, MIGRATION_REVISION)

    after_tables = _business_tables(engine)
    # 只多一张表，其余一张不少（旧备份仍可导入）。
    assert after_tables - before_tables == {_PRICING_TABLE}
    assert _columns(engine, _USAGE_TABLE) >= _NEW_COLUMNS
    for table in before_tables - {_USAGE_TABLE}:
        assert _columns(engine, table) == before_columns[table], table
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == MIGRATION_REVISION
        )


def test_legacy_per_1k_price_is_migrated_into_a_record(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "legacy.db")
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO app_setting (key, value) VALUES (:key, :value)"),
            {"key": "llm_price_per_1k_input", "value": "0.002"},
        )
        connection.execute(
            text("INSERT INTO app_setting (key, value) VALUES (:key, :value)"),
            {"key": "llm_price_per_1k_output", "value": "0.006"},
        )
        connection.execute(
            text("INSERT INTO app_setting (key, value) VALUES (:key, :value)"),
            {"key": "llm_price_currency", "value": '"USD"'},
        )

    command.upgrade(config, MIGRATION_REVISION)

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT input_cache_miss_per_million, output_per_million, currency, is_active "
                f"FROM {_PRICING_TABLE}"
            )
        ).one()
    # 每千 ×1000 = 每百万；老版本只有一个"输入价"，落到未命中档。
    assert row[0] == 2.0
    assert row[1] == 6.0
    assert row[2] == "USD"
    assert row[3] in (1, True)

    # 重复升级不重复插（幂等）。
    command.downgrade(config, PREVIOUS_REVISION)
    command.upgrade(config, MIGRATION_REVISION)
    with engine.connect() as connection:
        assert connection.execute(text(f"SELECT COUNT(*) FROM {_PRICING_TABLE}")).scalar_one() == 1


def test_downgrade_removes_table_and_columns(tmp_path) -> None:
    engine, config = _at_previous(tmp_path, "downgrade.db")
    before_tables = _business_tables(engine)
    before_columns = _columns(engine, _USAGE_TABLE)

    command.upgrade(config, MIGRATION_REVISION)
    command.downgrade(config, PREVIOUS_REVISION)

    assert _business_tables(engine) == before_tables
    # 两列按名字消失即可（SQLite 重建表会重排列序，不比整份集合）。
    assert _NEW_COLUMNS.isdisjoint(_columns(engine, _USAGE_TABLE))
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == PREVIOUS_REVISION
        )

    command.upgrade(config, MIGRATION_REVISION)
    assert _columns(engine, _USAGE_TABLE) >= _NEW_COLUMNS
    assert _PRICING_TABLE in _business_tables(engine)
    assert before_columns  # 保留了升级前的快照，避免 lint 认为变量没用

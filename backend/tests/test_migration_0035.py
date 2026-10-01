"""``0035_llm_thinking`` 迁移：大模型配置记录加「思考模式」三列。

这三列服务于 2026-10-01 的设置页功能：像选模型一样**开启思考**、并选一个强度档位
（各家的档位划分不同，所以档位是自由字符串，形态另有 ``thinking_style`` 一列）。

要点：

- **只加列、不加表**，旧备份迁到 head 时自动补齐；
- 三列都有 ``server_default``，存量记录一律落成"关 / 空档位 / auto"——**这正是加这个
  功能之前的行为**（不发送任何思考参数），所以不需要数据迁移；
- 幂等、可降级，并能跑在"列已存在但版本号还停在上一版"或"表不存在"的历史库上。
"""
from alembic import command
from sqlalchemy import create_engine, inspect, text

from app.database_migrations import build_alembic_config

PREVIOUS_REVISION = "0034_job_match_batches"
HEAD_REVISION = "0036_chat_conversation_surface"

TABLE = "llm_config_record"

# 新列 → 期望的 server_default。空串/``0``/``auto`` 就是"这个功能没开"。
NEW_COLUMNS: dict[str, str] = {
    "thinking_enabled": "0",
    "thinking_effort": "",
    "thinking_style": "auto",
}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（``''`` 回报成 ``''``）。"""
    raw = column.get("default")
    if raw is None:
        return None
    value = str(raw).strip()
    if value.startswith("'") and value.endswith("'"):
        value = value[1:-1]
    return value


def test_upgrade_adds_the_thinking_columns_with_their_defaults(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    before = _columns(engine, TABLE)
    assert not (set(NEW_COLUMNS) & set(before)), "前置条件：这一版还不该有思考三列"

    command.upgrade(config, HEAD_REVISION)

    after = _columns(engine, TABLE)
    for name, expected in NEW_COLUMNS.items():
        assert name in after, f"{TABLE}.{name} 没有被加出来"
        assert _default_of(after[name]) == expected, f"{TABLE}.{name} 的默认值不对"


def test_existing_rows_fall_back_to_thinking_off(tmp_path):
    """存量记录落成"关"——**那正是加这个功能之前的行为**，默认值不能悄悄改变老用户。

    如果默认值不是关，升级后所有 AI 调用会突然带上服务商可能不认识的参数，
    表现成"升级完什么都用不了"。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"INSERT INTO {TABLE} (name, provider, base_url, api_key, model, temperature,"
            " timeout_seconds, max_tokens, created_at, updated_at) "
            "VALUES ('旧配置', 'custom', 'https://api.example.com/v1', '', 'test', 0.1,"
            " 120, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.begin() as connection:
        row = connection.exec_driver_sql(
            f"SELECT thinking_enabled, thinking_effort, thinking_style FROM {TABLE}"
            " WHERE name = '旧配置'"
        ).first()
    assert row == (0, "", "auto")


def test_upgrade_keeps_the_table_set_unchanged(tmp_path):
    """**只加列**：表集合前后不变，这是"旧备份仍可导入"成立的前提。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'tables.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    before = set(inspect(engine).get_table_names())

    command.upgrade(config, HEAD_REVISION)

    assert set(inspect(engine).get_table_names()) == before


def test_upgrade_is_idempotent_when_already_applied(tmp_path):
    """重复跑不该报错——迁移链会跑在已经到 head 的库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)

    assert set(NEW_COLUMNS) <= set(_columns(engine, TABLE))


def test_upgrade_works_when_the_columns_already_exist(tmp_path):
    """列已存在时也要安然通过（版本号还停在上一版的历史库）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(f"ALTER TABLE {TABLE} ADD COLUMN thinking_enabled BOOLEAN NOT NULL DEFAULT 0")
        )

    command.upgrade(config, HEAD_REVISION)

    assert set(NEW_COLUMNS) <= set(_columns(engine, TABLE))


def test_upgrade_survives_a_missing_table(tmp_path):
    """表不存在时直接返回，不报错。

    迁移链会跑在"只有部分业务表"的历史库上——加列的前置条件是表在，不在就该跳过。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'notable.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    config2 = build_alembic_config(engine)

    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE IF EXISTS {TABLE}"))

    command.upgrade(config2, HEAD_REVISION)  # 不该抛


def test_downgrade_removes_the_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert not (set(NEW_COLUMNS) & set(_columns(engine, TABLE))), "降级后思考三列还在"


def test_downgrade_handles_a_column_that_was_already_dropped(tmp_path):
    """列已经被手工删掉时降级不该报错。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'downpartial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {TABLE} DROP COLUMN thinking_effort"))

    command.downgrade(config, PREVIOUS_REVISION)

    assert not (set(NEW_COLUMNS) & set(_columns(engine, TABLE)))

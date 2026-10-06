"""``0030_extra_profile_source_reuse`` 迁移：给「网申资料」加 source / reuse 两列。

这两列服务于 2026-09-27 的"填表时学到的"功能：

- ``source``：这条是**你自己录的**，还是**填表时学到的**？界面靠它区分"这个值我什么时候
  填过"，不标的话那就是一个没人能回答的问题。
- ``reuse``：**下次还要不要自动填**？学到的值里混着一次性的（内推码、某家的申请编号），
  把它们和生日一样自动预填是错的。``once`` 只记不填。

要点：

- **只加列**，旧备份迁到 head 时自动补齐；
- 两列都有 ``server_default``，所以存量行落成 ``manual`` / ``general``——它们本来就是
  用户手录的，也确实该继续预填。**这就是不加数据迁移的理由**：默认值恰好等于唯一正确的
  历史语义；
- 幂等、可降级，并能跑在"列已存在但版本号还停在上一版"的历史库上。
"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0029_education_cet_scores"
HEAD_REVISION = "0030_extra_profile_source_reuse"

TABLE = "web_form_profile_entry"

# 新列 → 期望的 server_default。
NEW_COLUMNS: dict[str, str] = {
    "source": "manual",
    "reuse": "general",
}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（``manual`` 回报成 ``'manual'``）。"""
    raw = column.get("default")
    if raw is None:
        return None
    text_value = str(raw).strip()
    if text_value.startswith("'") and text_value.endswith("'"):
        text_value = text_value[1:-1]
    return text_value


def test_upgrade_adds_both_columns_with_their_defaults(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    columns = _columns(engine, TABLE)
    for name in NEW_COLUMNS:
        assert name not in columns, f"前置条件：这一版还不该有 {name}"

    command.upgrade(config, HEAD_REVISION)

    columns = _columns(engine, TABLE)
    for name, default in NEW_COLUMNS.items():
        assert name in columns, f"{TABLE}.{name} 没有被加出来"
        assert _default_of(columns[name]) == default, f"{TABLE}.{name} 的默认值不对"


def test_existing_rows_become_manual_and_general(tmp_path):
    """存量行落成 ``manual`` + ``general``——**这是这两列默认值的全部意义**。

    老库里的行都是用户手录的，也确实该继续预填。如果默认值不是这两个，老用户的资料会
    要么突然显示成"学到的"，要么突然不再预填，而两者都没有任何提示。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    # 在**加列之前**插一行——模拟老用户已经录过的资料。
    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"INSERT INTO {TABLE} (field_key, value, created_at, updated_at) "
            "VALUES ('height', '178', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
        )

    command.upgrade(config, HEAD_REVISION)

    with engine.begin() as connection:
        row = connection.exec_driver_sql(
            f"SELECT source, reuse FROM {TABLE} WHERE field_key = 'height'"
        ).first()
    assert row == ("manual", "general")


def test_upgrade_is_idempotent_when_already_applied(tmp_path):
    """重复跑不该报错——迁移链会跑在已经到 head 的库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)

    for name in NEW_COLUMNS:
        assert name in _columns(engine, TABLE)


def test_upgrade_works_when_the_columns_already_exist(tmp_path):
    """列已存在时也要安然通过（版本号还停在上一版的历史库）。

    用 ``CREATE TABLE ... `` 造一个"表结构已经是新的、但版本号是旧的"的场景。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        for name, default in NEW_COLUMNS.items():
            connection.execute(
                text(f"ALTER TABLE {TABLE} ADD COLUMN {name} VARCHAR(16) NOT NULL DEFAULT '{default}'")
            )

    command.upgrade(config, HEAD_REVISION)

    for name in NEW_COLUMNS:
        assert name in _columns(engine, TABLE)


def test_upgrade_survives_a_missing_table(tmp_path):
    """表不存在时直接返回，不报错。

    迁移链会跑在"只有部分业务表"的历史库上，而这里没有 ``test_migration_0028.py`` 那种
    "先建表再跑"的余地——加列的前置条件是表在，不在就该跳过。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'notable.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)
    config2 = build_alembic_config(engine)

    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE IF EXISTS {TABLE}"))

    # 不该抛。
    command.upgrade(config2, HEAD_REVISION)


def test_downgrade_removes_both_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    columns = _columns(engine, TABLE)
    for name in NEW_COLUMNS:
        assert name not in columns, f"降级后 {name} 还在"


def test_downgrade_handles_a_column_that_was_already_dropped(tmp_path):
    """列已经被手工删掉时降级不该报错。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'downpartial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {TABLE} DROP COLUMN source"))

    command.downgrade(config, PREVIOUS_REVISION)

    assert "source" not in _columns(engine, TABLE)

"""``0031_extra_profile_label`` 迁移：给「网申资料」加 ``label`` 列。

这一列服务于 2026-09-27 的**自定义字段**功能：用户可以在「点哪个填按」里把清单外的栏目
（「导师姓名」「实验室」这类）记下来，key 是规范出来的 ``CUSTOM_导师姓名``，而这一列存
**用户当初看到的名字**。没有它，界面上显示的就是一串 ``CUSTOM_导师姓名``——前缀是给库里
看的，不是给用户看的。

要点：

- **只加一列**，旧备份迁到 head 时自动补齐；
- 有 ``server_default=''``，所以存量行落成空串。**空串的语义是"从目录取名"**——存量行
  都是目录字段，正是这个意思。所以不用数据迁移；
- 幂等、可降级，并能跑在"列已存在但版本号还停在上一版"的历史库上。
"""
from alembic import command
from sqlalchemy import create_engine, inspect, text

from app.database_migrations import build_alembic_config

PREVIOUS_REVISION = "0030_extra_profile_source_reuse"
HEAD_REVISION = "0036_chat_conversation_surface"

TABLE = "web_form_profile_entry"

# 新列 → 期望的 server_default。
NEW_COLUMNS: dict[str, str] = {
    "label": "",
}


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（``''`` 回报成 ``''``）。"""
    raw = column.get("default")
    if raw is None:
        return None
    text_value = str(raw).strip()
    if text_value.startswith("'") and text_value.endswith("'"):
        text_value = text_value[1:-1]
    return text_value


def test_upgrade_adds_the_label_column_with_its_default(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    assert "label" not in _columns(engine, TABLE), "前置条件：这一版还不该有 label"

    command.upgrade(config, HEAD_REVISION)

    columns = _columns(engine, TABLE)
    assert "label" in columns, f"{TABLE}.label 没有被加出来"
    assert _default_of(columns["label"]) == "", f"{TABLE}.label 的默认值不对"


def test_existing_rows_get_an_empty_label(tmp_path):
    """存量行落成空串——**空串的语义是"从目录取名"，这正是它们的意思**。

    老库里的行都是目录字段（那时还没有自定义字段这回事），读取端用 ``display_label``
    回落到 ``FIELD_LABELS``。如果默认值不是空串，界面上那些"学校""专业"会突然变成别的
    名字，而没有任何提示。
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
            f"SELECT label FROM {TABLE} WHERE field_key = 'height'"
        ).first()
    assert row == ("",)


def test_a_custom_entry_keeps_its_display_label(tmp_path):
    """自定义字段那一列真的存得住——这是它存在的唯一理由。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'custom.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    with engine.begin() as connection:
        connection.exec_driver_sql(
            f"INSERT INTO {TABLE} (field_key, value, label, created_at, updated_at) "
            "VALUES ('CUSTOM_导师姓名', '王教授', '导师姓名', "
            "'2026-01-01 00:00:00', '2026-01-01 00:00:00')"
        )
        row = connection.exec_driver_sql(
            f"SELECT label FROM {TABLE} WHERE field_key = 'CUSTOM_导师姓名'"
        ).first()

    assert row == ("导师姓名",)


def test_upgrade_is_idempotent_when_already_applied(tmp_path):
    """重复跑不该报错——迁移链会跑在已经到 head 的库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)

    assert "label" in _columns(engine, TABLE)


def test_upgrade_works_when_the_column_already_exists(tmp_path):
    """列已存在时也要安然通过（版本号还停在上一版的历史库）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(f"ALTER TABLE {TABLE} ADD COLUMN label VARCHAR(64) NOT NULL DEFAULT ''")
        )

    command.upgrade(config, HEAD_REVISION)

    assert "label" in _columns(engine, TABLE)


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

    # 不该抛。
    command.upgrade(config2, HEAD_REVISION)


def test_downgrade_removes_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert "label" not in _columns(engine, TABLE), "降级后 label 还在"


def test_downgrade_handles_a_column_that_was_already_dropped(tmp_path):
    """列已经被手工删掉时降级不该报错。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'downpartial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {TABLE} DROP COLUMN label"))

    command.downgrade(config, PREVIOUS_REVISION)

    assert "label" not in _columns(engine, TABLE)

"""``0027_fill_record_and_apply_trash`` 迁移：建填充记录表 + 给投递记录加 ``deleted_at``。

这条迁移做两件事，都跟"用户能不能删"有关：

1. 新建 ``web_form_fill_record``——网申填表此前"填完即忘"，用户事后无处回看；
2. 给 ``apply_task_item`` 加 ``deleted_at``——投递记录原本只追加不能删，现在可删（进退回收站）。

两处都必须**幂等**（迁移链会跑在"只有部分表/列"的历史库上）且**能在降级后还原**。
"""
from alembic import command
from sqlalchemy import create_engine, inspect, text

from app.database_migrations import build_alembic_config

PREVIOUS_REVISION = "0026_form_extra_fields"
HEAD_REVISION = "0027_fill_record_and_apply_trash"

TABLE = "web_form_fill_record"

# 新表的列 → 期望的 server_default（``None`` 表示可空且无默认）。
NEW_TABLE_COLUMNS: dict[str, str | None] = {
    "id": None,
    "url": "",
    "page_title": "",
    "items": "[]",
    "filled": "0",
    "unverified": "0",
    "failed": "0",
    "page_snapshot": "[]",
    "source": "batch",
    "created_at": None,
    "updated_at": None,
    "deleted_at": None,
}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（空串是 ``''``，JSON 是 ``'[]'``）。"""
    raw = column.get("default")
    if raw is None:
        return None
    text_value = str(raw).strip()
    if text_value.startswith("'") and text_value.endswith("'"):
        text_value = text_value[1:-1]
    return text_value


def test_upgrade_creates_the_table_and_the_column(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    assert TABLE not in _tables(engine), "前置条件：这一版还不该有这张表"
    assert "deleted_at" not in _columns(engine, "apply_task_item"), "前置条件：投递记录还不该能删"

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in _tables(engine)
    columns = _columns(engine, TABLE)
    for name, default in NEW_TABLE_COLUMNS.items():
        assert name in columns, f"{TABLE}.{name} 没有被建出来"
        if default is not None:
            assert _default_of(columns[name]) == default, f"{TABLE}.{name} 的默认值不对"
    # 可空列：``deleted_at`` 的 NULL 语义就是"没删"，不能是 NOT NULL。
    assert columns["deleted_at"]["nullable"] is True
    assert "deleted_at" in _columns(engine, "apply_task_item")


def test_the_new_table_carries_its_index(tmp_path):
    """列表按 ``created_at`` 倒序取最近若干条，没有索引会随记录增长变慢。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
    command.upgrade(build_alembic_config(engine), HEAD_REVISION)

    indexes = {index["name"] for index in inspect(engine).get_indexes(TABLE)}
    assert f"ix_{TABLE}_created_at" in indexes


def test_upgrade_is_idempotent_when_already_applied(tmp_path):
    """重复跑不该报错——迁移链会跑在已经到 head 的库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)

    assert TABLE in _tables(engine)
    assert "deleted_at" in _columns(engine, "apply_task_item")


def test_upgrade_works_on_a_partly_applied_database(tmp_path):
    """表已经存在、列已经存在时也必须安然通过。

    真实来历：开发机上手工补过列/表之后，迁移再跑一次撞上"重复列"会直接炸——
    这正是 ``0025`` 那次事故的形态（见 ``test_migration_0026`` 的说明）。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    # 手工造出"表已建、列已加"的中间状态，只是版本号还停在上一版。
    with engine.begin() as connection:
        connection.execute(
            text(
                f"CREATE TABLE {TABLE} (id INTEGER PRIMARY KEY, url VARCHAR(1024) "
                "NOT NULL DEFAULT '', page_title VARCHAR(256) NOT NULL DEFAULT '', "
                "items JSON NOT NULL DEFAULT '[]', filled INTEGER NOT NULL DEFAULT 0, "
                "unverified INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, "
                "page_snapshot JSON NOT NULL DEFAULT '[]', source VARCHAR(16) NOT NULL "
                "DEFAULT 'batch', created_at DATETIME NOT NULL DEFAULT '', "
                "updated_at DATETIME NOT NULL DEFAULT '', deleted_at DATETIME)"
            )
        )
        connection.execute(text("ALTER TABLE apply_task_item ADD COLUMN deleted_at DATETIME"))

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in _tables(engine)
    assert "deleted_at" in _columns(engine, "apply_task_item")


def test_downgrade_removes_both(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert TABLE not in _tables(engine)
    assert "deleted_at" not in _columns(engine, "apply_task_item")


def test_head_table_set_matches_the_models(tmp_path):
    """head 的表集合必须与 ``Base.metadata`` 完全一致。

    **这条是"忘了在 ``models/__init__.py` 注册新模型"的主要报警器**：漏注册则 ORM 不知道
    这张表，而迁移建了它——备份导出的表集合校验会因此失败，而失败点离原因很远。
    """
    from app import models  # noqa: F401 - 确保全部模型注册到 Base.metadata
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'head.db'}")
    command.upgrade(build_alembic_config(engine), "head")

    tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)

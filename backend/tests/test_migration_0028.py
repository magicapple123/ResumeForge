"""``0028_web_form_profile`` 迁移：建「网申资料」表。

这张表装的是**用户专门为网申表单录的补充资料**（四六级分数、档案所在地、紧急联系人、
父母工作单位、身高视力、入党时间…）——简历里没有、校招网申却常问的那些栏目。

要点：

- 键值对形状（``field_key`` + ``value``），**加字段不需要迁移**（清单在 ``fields.py``）；
- **没有 ``deleted_at``**：它是配置性资料，不进退回收站（不要了就把值清空，空值不落库）。
  因此它也**不登记** ``trash.TRASH_SPECS``——与 ``test_trash.py`` 的一一对应守卫不冲突；
- 幂等、可降级，并能跑在"表已存在但版本号还停在上一版"的历史库上。
"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text

PREVIOUS_REVISION = "0027_fill_record_and_apply_trash"
HEAD_REVISION = "0028_web_form_profile"

TABLE = "web_form_profile_entry"

# 新表的列 → 期望的 server_default（``None`` 表示可空且无默认）。
NEW_TABLE_COLUMNS: dict[str, str | None] = {
    "id": None,
    "field_key": "",
    "value": "",
    "created_at": None,
    "updated_at": None,
}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> dict[str, dict]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（空串是 ``''``）。"""
    raw = column.get("default")
    if raw is None:
        return None
    text_value = str(raw).strip()
    if text_value.startswith("'") and text_value.endswith("'"):
        text_value = text_value[1:-1]
    return text_value


def test_upgrade_creates_the_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)

    command.upgrade(config, PREVIOUS_REVISION)
    assert TABLE not in _tables(engine), "前置条件：这一版还不该有这张表"

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in _tables(engine)
    columns = _columns(engine, TABLE)
    for name, default in NEW_TABLE_COLUMNS.items():
        assert name in columns, f"{TABLE}.{name} 没有被建出来"
        if default is not None:
            assert _default_of(columns[name]) == default, f"{TABLE}.{name} 的默认值不对"


def test_the_table_has_no_deleted_at(tmp_path):
    """**刻意没有软删列**：它是配置性资料，不进退回收站。

    加了 ``deleted_at`` 就得登记 ``trash.TRASH_SPECS``（``test_trash.py`` 会红），
    而"回收站里躺着一个空字段"没有意义。这条钉住这个决定，防止有人"顺手"加上。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'nodelete.db'}")
    command.upgrade(build_alembic_config(engine), HEAD_REVISION)

    assert "deleted_at" not in _columns(engine, TABLE)


def test_the_table_carries_its_index(tmp_path):
    """读取按 ``field_key`` 查，写入按它定位——没有索引会随项数增长变慢。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'idx.db'}")
    command.upgrade(build_alembic_config(engine), HEAD_REVISION)

    indexes = {index["name"] for index in inspect(engine).get_indexes(TABLE)}
    assert f"ix_{TABLE}_field_key" in indexes


def test_upgrade_is_idempotent_when_already_applied(tmp_path):
    """重复跑不该报错——迁移链会跑在已经到 head 的库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)
    command.upgrade(config, HEAD_REVISION)

    assert TABLE in _tables(engine)


def test_upgrade_works_on_a_partly_applied_database(tmp_path):
    """表已经存在时也必须安然通过（版本号还停在上一版的历史库）。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(
                f"CREATE TABLE {TABLE} (id INTEGER PRIMARY KEY, field_key VARCHAR(64) "
                "NOT NULL DEFAULT '', value TEXT NOT NULL DEFAULT '', "
                "created_at DATETIME NOT NULL DEFAULT '', updated_at DATETIME NOT NULL DEFAULT '')"
            )
        )

    command.upgrade(config, HEAD_REVISION)

    assert TABLE in _tables(engine)


def test_downgrade_removes_the_table(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert TABLE not in _tables(engine)


def test_downgrade_handles_a_table_without_its_index(tmp_path):
    """老库可能只有表没有索引——``DROP INDEX`` 对不存在的索引会直接报错。

    （同一个坑 ``0027`` 踩过一次：降级时无条件 ``DROP INDEX``，在"有表无索引"的库上
    报 ``no such index``。这里从一开始就判存在。）
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'noidx.db'}")
    config = build_alembic_config(engine)
    command.upgrade(config, PREVIOUS_REVISION)

    with engine.begin() as connection:
        connection.execute(
            text(
                f"CREATE TABLE {TABLE} (id INTEGER PRIMARY KEY, field_key VARCHAR(64) "
                "NOT NULL DEFAULT '', value TEXT NOT NULL DEFAULT '', "
                "created_at DATETIME NOT NULL DEFAULT '', updated_at DATETIME NOT NULL DEFAULT '')"
            )
        )
    command.upgrade(config, HEAD_REVISION)

    command.downgrade(config, PREVIOUS_REVISION)

    assert TABLE not in _tables(engine)


def test_head_table_set_matches_the_models(tmp_path):
    """head 的表集合必须与 ``Base.metadata`` 完全一致。

    **这条是"忘了在 ``models/__init__.py`` 注册新模型"的主要报警器**。
    """
    from app import models  # noqa: F401 - 确保全部模型注册到 Base.metadata
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'head.db'}")
    command.upgrade(build_alembic_config(engine), "head")

    tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)

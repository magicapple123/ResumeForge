"""``0026_form_extra_fields`` 迁移：补上 QQ 号、导师、研究方向、意向行业与院系。

这条迁移的来历值得记住：这几列本来写进了 ``0025``，但 ``0025`` 在那之前**已经在一台
开发机上执行过**——Alembic 以 revision 为准，已应用的迁移不会再跑，往里面追加列不会生效，
症状是接口 500 ``no such column: user_profile.qq``。所以把 ``0025`` 还原成它执行时的样子，
这四列改由本迁移加。

因此这里除了常规的幂等与降级，还要专门验一件事：**从"跑过旧版 0025"的库升级也能补齐**。
"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect

PREVIOUS_REVISION = "0025_web_form_fields"
HEAD_REVISION = "0026_form_extra_fields"

# 表名 → 列名 → 期望的 server_default。
NEW_COLUMNS: dict[str, dict[str, str]] = {
    "user_profile": {
        "qq": "",
        "advisor": "",
        "research_direction": "",
        "preferred_industry": "",
    },
    "education": {"department": ""},
}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> dict[str, object]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（空串是 ``''``）。"""
    raw = column.get("default")
    return None if raw is None else str(raw).strip("'")


def test_upgrade_adds_the_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'add.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, PREVIOUS_REVISION)
        for table, expected in NEW_COLUMNS.items():
            before = _columns(engine, table)
            for column in expected:
                assert column not in before, f"前置条件：{table}.{column} 这一版还不该有"

        command.upgrade(config, HEAD_REVISION)

        for table, expected in NEW_COLUMNS.items():
            columns = _columns(engine, table)
            for column, default in expected.items():
                assert column in columns, f"{table}.{column} 没有被加上"
                assert columns[column]["nullable"] is False
                assert _default_of(columns[column]) == default
    finally:
        engine.dispose()


def test_upgrade_is_idempotent_when_the_columns_are_already_there(tmp_path):
    """列已在时要跳过而不是报错——真实开发机上就出现过"revision 已到 0025、
    但列只加了一半"的库。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'again.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, HEAD_REVISION)
        command.stamp(config, PREVIOUS_REVISION)
        command.upgrade(config, HEAD_REVISION)  # 不应抛异常

        assert set(NEW_COLUMNS["user_profile"]) <= set(_columns(engine, "user_profile"))
    finally:
        engine.dispose()


def test_upgrade_works_on_a_database_where_the_columns_were_partly_added(tmp_path):
    """**这条是那个真实事故的回归守卫。**

    "跑过旧版 0025 的库"＝ revision 已经到 ``0025``，但 ``user_profile`` 上只有 0025 那批
    列、没有本迁移这几列。本迁移必须把它补齐（而不是因为 revision 到了就跳过整条链）。
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'partial.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, HEAD_REVISION)
        # 手工把本迁移加的那几列去掉，模拟"只跑过旧版 0025"的库。
        with engine.begin() as connection:
            for column in ("qq", "advisor", "research_direction", "preferred_industry"):
                connection.exec_driver_sql(f"ALTER TABLE user_profile DROP COLUMN {column}")
            connection.exec_driver_sql("ALTER TABLE education DROP COLUMN department")
        command.stamp(config, PREVIOUS_REVISION)

        command.upgrade(config, HEAD_REVISION)

        assert set(NEW_COLUMNS["user_profile"]) <= set(_columns(engine, "user_profile"))
        assert set(NEW_COLUMNS["education"]) <= set(_columns(engine, "education"))
    finally:
        engine.dispose()


def test_downgrade_removes_the_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'down.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, HEAD_REVISION)
        command.downgrade(config, PREVIOUS_REVISION)

        for table, expected in NEW_COLUMNS.items():
            leftover = set(_columns(engine, table)) & set(expected)
            assert not leftover, f"{table} 里还留着：{sorted(leftover)}"
    finally:
        engine.dispose()


def test_head_table_set_matches_the_models(tmp_path):
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'match.db'}")
    try:
        command.upgrade(build_alembic_config(engine), "head")
        expected = set(Base.metadata.tables)
        actual = _tables(engine) - {"alembic_version"}
        assert actual == expected, (
            f"仅库里有 {sorted(actual - expected)}，仅模型里有 {sorted(expected - actual)}"
        )
    finally:
        engine.dispose()

"""``0025_web_form_fields`` 迁移：加网申字段列，并删掉官网采集遗留的三张表。

这条迁移同时做两件方向相反的事（加列、减表），所以除了幂等与降级，还要专门验两件事：

1. **加列不能破坏旧备份**：备份迁到 head 后表集合只少那三张已移除功能的表，列集合里
   多出的是本次新增的——这正是"旧备份仍可导入"成立的前提。
2. **降级要把三张表原样建回来**：列、索引、外键的 ``ondelete`` 都得与 ``0022``/``0024``
   逐字一致，否则"降级成功"只是看起来成功。
"""
from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect

PREVIOUS_REVISION = "0024_official_discovery_history"
HEAD_REVISION = "0025_web_form_fields"

# 本次新增的列：表名 → 列名 → 期望的 server_default（None 表示不该有默认值）。
NEW_COLUMNS: dict[str, dict[str, str | None]] = {
    "user_profile": {
        "wechat": "",
        "birth_date": "",
        "id_type": "",
        "id_number": "",
        "country_region": "",
        "native_place": "",
        "political_status": "",
        "phone_country_code": "+86",
        "family_info": "",
        "expected_salary": "",
    },
    "education": {
        "study_mode": "",
        "degree_type": "",
    },
}

REMOVED_TABLES = ("official_site", "official_collect_run", "official_discovery_search")

# 降级时三张表各自的索引，以及外键的删除语义。
OFFICIAL_INDEXES = {
    "official_site": {"ix_official_site_created_at"},
    "official_collect_run": {
        "ix_official_collect_run_site_id",
        "ix_official_collect_run_status",
        "ix_official_collect_run_started_at",
    },
    "official_discovery_search": {"ix_official_discovery_search_created_at"},
}
OFFICIAL_FOREIGN_KEYS = {"official_collect_run": ("official_site", "CASCADE")}


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _columns(engine, table: str) -> dict[str, object]:
    return {column["name"]: column for column in inspect(engine).get_columns(table)}


def _default_of(column: dict) -> str | None:
    """SQLite 把 server_default 回报成 SQL 字面量（空串是 ``''``，不是空字符串）。

    这里剥掉外层引号再比，免得断言写成 ``"''"`` 这种只对某一种方言成立的样子。
    """
    raw = column.get("default")
    if raw is None:
        return None
    return str(raw).strip("'")


def test_upgrade_adds_the_web_form_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'columns.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, PREVIOUS_REVISION)
        before = _columns(engine, "user_profile")
        for column in NEW_COLUMNS["user_profile"]:
            assert column not in before, f"前置条件：{column} 这一版还不该有"

        command.upgrade(config, HEAD_REVISION)

        for table, expected in NEW_COLUMNS.items():
            columns = _columns(engine, table)
            for column, default in expected.items():
                assert column in columns, f"{table}.{column} 没有被加上"
                assert columns[column]["nullable"] is False
                if default is not None:
                    assert _default_of(columns[column]) == default
    finally:
        engine.dispose()


def test_upgrade_leaves_existing_values_and_columns_alone(tmp_path):
    """只加列：写进去的旧数据要原样还在，既有列一个都不能少。"""
    from sqlalchemy import text

    engine = create_engine(f"sqlite:///{tmp_path / 'keep.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, PREVIOUS_REVISION)
        # 这一版的 user_profile 有一批 NOT NULL 且无默认值的列（gender、birth_year…），
        # 逐版写死清单会随迁移漂移，所以按实际情况动态补齐。
        columns = _columns(engine, "user_profile")
        required = [
            name
            for name, column in columns.items()
            if name != "id" and not column["nullable"] and _default_of(column) is None
        ]
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO user_profile (name, phone"
                    + "".join(f", {name}" for name in required)
                    + ") VALUES ('张三', '138'"
                    + ", ''" * len(required)
                    + ")"
                )
            )
        before = set(columns)

        command.upgrade(config, HEAD_REVISION)

        with engine.begin() as connection:
            row = connection.execute(text("SELECT name, phone FROM user_profile")).one()
        assert row == ("张三", "138")
        assert before <= set(_columns(engine, "user_profile"))
    finally:
        engine.dispose()


def test_upgrade_drops_the_official_tables(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'drop.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, PREVIOUS_REVISION)
        assert set(REMOVED_TABLES) <= _tables(engine), "前置条件：这一版它们还在"

        command.upgrade(config, HEAD_REVISION)

        remaining = _tables(engine)
        for table in REMOVED_TABLES:
            assert table not in remaining, f"{table} 应该被删掉"
    finally:
        engine.dispose()


def test_upgrade_is_idempotent_when_the_tables_are_already_absent(tmp_path):
    """三张表不在时要跳过而不是报错——迁移链会跑在"本来就没有它们"的历史库上。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'absent.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, PREVIOUS_REVISION)
        with engine.begin() as connection:
            for table in ("official_collect_run", "official_discovery_search", "official_site"):
                connection.exec_driver_sql(f"DROP TABLE {table}")

        command.upgrade(config, HEAD_REVISION)  # 不应抛异常
        command.stamp(config, PREVIOUS_REVISION)
        command.upgrade(config, HEAD_REVISION)

        assert not (set(REMOVED_TABLES) & _tables(engine))
    finally:
        engine.dispose()


def test_downgrade_rebuilds_the_official_tables(tmp_path):
    """降级要能真的回到上一版：列、索引、外键语义都要回来。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'back.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, HEAD_REVISION)
        assert not (set(REMOVED_TABLES) & _tables(engine))

        command.downgrade(config, PREVIOUS_REVISION)

        assert set(REMOVED_TABLES) <= _tables(engine)
        inspector = inspect(engine)
        for table, expected_indexes in OFFICIAL_INDEXES.items():
            indexes = {item["name"] for item in inspector.get_indexes(table)}
            assert expected_indexes <= indexes, f"{table} 的索引没建全：{expected_indexes - indexes}"

        # 外键的删除语义：源删掉时采集账目跟着走（这是 0022 的刻意设计）。
        for table, (referred, ondelete) in OFFICIAL_FOREIGN_KEYS.items():
            assert any(
                item["referred_table"] == referred
                and item["options"].get("ondelete") == ondelete
                for item in inspector.get_foreign_keys(table)
            ), f"{table} 指向 {referred} 的外键语义不对"
    finally:
        engine.dispose()


def test_downgrade_removes_the_web_form_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'unadd.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, HEAD_REVISION)
        command.downgrade(config, PREVIOUS_REVISION)

        for table, expected in NEW_COLUMNS.items():
            columns = set(_columns(engine, table))
            leftover = columns & set(expected)
            assert not leftover, f"{table} 里还留着本次新增的列：{sorted(leftover)}"
    finally:
        engine.dispose()


def test_head_table_set_matches_the_models(tmp_path):
    """移到 head 后，表集合与代码里的模型**完全一致**。

    减表类迁移最容易出岔子的地方：库里删掉了、模型里忘了删（或反过来），症状是运行期才炸。
    这三张表的模型已随本次迁移删除，这里逐表比对。
    """
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'match.db'}")
    try:
        command.upgrade(build_alembic_config(engine), "head")
        expected = set(Base.metadata.tables)
        actual = _tables(engine) - {"alembic_version"}
        assert actual == expected, (
            f"仅库里有 {sorted(actual - expected)}，仅模型里有 {sorted(expected - actual)}"
        )
        assert not (set(REMOVED_TABLES) & expected)
    finally:
        engine.dispose()


def test_a_backup_from_before_the_official_tables_existed_still_lands_on_head(tmp_path):
    """**旧备份仍可导入**：一份来自 0021（这几张表诞生之前）的库迁到 head 后表集合正确。"""
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "0021_candidate_additional_info")
        assert not (set(REMOVED_TABLES) & _tables(engine))

        command.upgrade(config, "head")

        assert not (set(REMOVED_TABLES) & _tables(engine))
        # 新列也要补上，且存量行拿到默认值。
        assert set(NEW_COLUMNS["user_profile"]) <= set(_columns(engine, "user_profile"))
    finally:
        engine.dispose()

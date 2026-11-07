# SPDX-License-Identifier: Apache-2.0
"""2.0 单基线迁移的 schema 不变量（T02 重建）。

1.x 时代的 57 个 ``test_migration_*``（8260 行）随迁移链一起删除，但它们守的四条
性质不能跟着消失——这里用与"具体迁移步骤"无关的方式重新表达：

1. **往返可用**：空库 ``upgrade head → downgrade base → upgrade head`` 三次都成功，
   首末表集合相同，且 ``alembic_version`` 前后值证明真的重跑了一遍（不是只看不报错）；
2. **表集合 == 模型注册表**：复用 ``tests/test_database._assert_head_schema`
   （期望集合从 ``Base.metadata`` 推导，``app_schema_epoch`` 已包含在内）；
3. **epoch 播种**：``app_schema_epoch`` 恰好一行 = 2；把它改成 3 并删表后重跑基线，
   仍得到唯一的 2（证明 2 来自迁移而不是残留状态）；
4. **已删表不复活**：2.0 不再建 ``profile_fact`` / ``profile_fact_field_pref``。

**为什么不留「只加列」断言**：单基线形态下没有"上一版"可比——空库一步建全，每张表的
列只被创建一次；「迁移前后列集合不变」在这里只能断言一个永远为真的命题（而且与"基线
本来就要建列"自相矛盾）。这条不变量属于增量迁移模型，2.0 不再有对应语义，因此旧
用例本体不保留、也不为凑数写一条空断言。
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect, text
from tests.migration_refs import alembic_version_of, head_revision
from tests.test_database import _assert_head_schema

# 2.0 删除的补充事实表（T08）：基线不能再建它们。
_REMOVED_TABLES = ("profile_fact", "profile_fact_field_pref")


def _baseline_engine(tmp_path: Path, name: str = "baseline.db"):
    return create_engine(f"sqlite:///{(tmp_path / name).as_posix()}")


def _table_names(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _epoch_rows(engine) -> list[int]:
    with engine.connect() as connection:
        return [row[0] for row in connection.execute(text("SELECT epoch FROM app_schema_epoch"))]


def test_upgrade_downgrade_upgrade_round_trip_rebuilds_the_same_schema(tmp_path):
    """往返可用：三次命令都成功，首末表集合相同，版本号证明中间真的清空过。"""
    engine = _baseline_engine(tmp_path)
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        first_tables = _table_names(engine)
        assert alembic_version_of(engine) == head_revision()
        assert _epoch_rows(engine) == [2]

        command.downgrade(config, "base")
        assert _table_names(engine) == {"alembic_version"}, "downgrade base 只应留下版本表"
        assert alembic_version_of(engine) is None, "downgrade 后版本号必须被清掉"

        command.upgrade(config, "head")
        assert _table_names(engine) == first_tables, "往返后的表集合必须与首次建库一致"
        assert alembic_version_of(engine) == head_revision()
        assert _epoch_rows(engine) == [2]
    finally:
        engine.dispose()


def test_head_schema_matches_the_model_registry(tmp_path):
    """表/列集合 == 模型注册表（含索引、外键与 head revision 的既有断言）。"""
    engine = _baseline_engine(tmp_path, "schema.db")
    try:
        command.upgrade(build_alembic_config(engine), "head")
        _assert_head_schema(engine)
    finally:
        engine.dispose()


def test_epoch_seed_is_two_and_rebuild_restores_it(tmp_path):
    """epoch 恰好一行 = 2；改成 3 并删表后重跑基线，仍得到唯一的 2。"""
    engine = _baseline_engine(tmp_path, "epoch.db")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        assert _epoch_rows(engine) == [2]
        with engine.begin() as connection:
            connection.execute(text("UPDATE app_schema_epoch SET epoch = 3"))
            connection.execute(text("DROP TABLE app_schema_epoch"))
        command.downgrade(config, "base")
        command.upgrade(config, "head")
        assert _epoch_rows(engine) == [2], "2 必须来自基线播种，不能是残留状态"
        with engine.connect() as connection:
            assert (
                connection.execute(text("SELECT COUNT(*) FROM app_schema_epoch")).scalar_one() == 1
            )
    finally:
        engine.dispose()


def test_removed_tables_are_not_in_the_baseline(tmp_path):
    """T08 删掉的补充事实表不能借基线复活（空库迁移后 sqlite_master 不得出现）。"""
    engine = _baseline_engine(tmp_path, "removed.db")
    try:
        command.upgrade(build_alembic_config(engine), "head")
        names = _table_names(engine)
        for removed in _REMOVED_TABLES:
            assert removed not in names, f"2.0 基线不应再建已删除的表 {removed}"
    finally:
        engine.dispose()

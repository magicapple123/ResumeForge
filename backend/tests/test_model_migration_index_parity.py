# SPDX-License-Identifier: Apache-2.0
"""模型元数据与迁移 head 真库的索引/唯一约束一致性守卫（T3-b）。

为什么需要：模型里的 Column(index=True) / Index(...) 只影响 create_all 建的库，生产库是
alembic upgrade 建的。两边一旦漂移，同一份代码会在两种建库路径下得到不同 schema
（alembic 库缺索引 → 查询退化成全表扫，统计口径也失真）。0020 之前有两类漂移：
- 正向（模型声明了、迁移没建）：assistant_conversation_skill.created_at；
- 反向（迁移建了、模型没声明）：assistant_memory 的 3 个索引（0015 早就在真库建了）。
两类都已在 T3 对齐：前者由 0020 补建，后者给模型补声明（不重复建迁移）。

比对规则（严格双向，零白名单）：
- 模型声明的非唯一索引 → 真库 get_indexes() 必须有同名、同列序索引；真库多出的非唯一
  索引同样算漂移；
- 模型声明的唯一语义（UniqueConstraint 或 unique=True 的 Index）→ 真库的
  get_indexes(unique=True) 或 get_unique_constraints() 里必须有同列集合；反之亦然；
- 失败信息逐条点名表/索引名/列。

SQLite inspector 的表示差异只做**语义归一**（不丢信息）：
- 迁移用 op.create_index(unique=True) 建的约束被 inspect().get_indexes 报成 unique=1，
  而模型侧可能写 UniqueConstraint —— 两侧都归入"唯一"桶，按列集合比较；
- 列级 unique=True 在 SQLite 里是 sqlite_autoindex，只有 get_unique_constraints 看得见
  （名字为 None）—— 同样归入"唯一"桶。
"""

from __future__ import annotations

import importlib
from pathlib import Path

from alembic import command
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app import models  # noqa: F401 - 导入以注册全部模型
from app.database import Base, build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import UniqueConstraint, create_engine, inspect
from tests.migration_refs import alembic_version_of, head_revision

# 条目类型：(表, 索引名, 列序) 与 (表, 列集合)。
_IndexEntry = tuple[str, str, tuple[str, ...]]
_UniqueEntry = tuple[str, tuple[str, ...]]


def _migrated_engine(tmp_path: Path):
    """空库 -> alembic upgrade head（与生产同一条建库路径）。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'parity.db').as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    return engine


def _model_entries() -> tuple[set[_IndexEntry], set[_UniqueEntry]]:
    """模型侧：(非唯一索引, 唯一语义) 两个集合。"""
    indexes: set[_IndexEntry] = set()
    uniques: set[_UniqueEntry] = set()
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            columns = tuple(column.name for column in index.columns)
            if index.unique:
                uniques.add((table.name, columns))
            else:
                indexes.add((table.name, index.name, columns))
        for constraint in table.constraints:
            if isinstance(constraint, UniqueConstraint):
                uniques.add((table.name, tuple(column.name for column in constraint.columns)))
    return indexes, uniques


def _database_entries(inspector) -> tuple[set[_IndexEntry], set[_UniqueEntry]]:
    """真库侧：与模型侧同样的两种表示。"""
    indexes: set[_IndexEntry] = set()
    uniques: set[_UniqueEntry] = set()
    existing_tables = set(inspector.get_table_names())
    for table in Base.metadata.sorted_tables:
        assert table.name in existing_tables, f"迁移 head 缺少模型认识的表 {table.name!r}"
        for index in inspector.get_indexes(table.name):
            columns = tuple(column for column in (index.get("column_names") or []) if column)
            if index.get("unique"):
                uniques.add((table.name, columns))
            else:
                indexes.add((table.name, index["name"], columns))
        for constraint in inspector.get_unique_constraints(table.name):
            columns = tuple(column for column in (constraint.get("column_names") or []) if column)
            uniques.add((table.name, columns))
    return indexes, uniques


def _describe_index(entry: _IndexEntry) -> str:
    table_name, name, columns = entry
    return f"{table_name}: 索引 {name} ({', '.join(columns)})"


def _describe_unique(entry: _UniqueEntry) -> str:
    table_name, columns = entry
    return f"{table_name}: 唯一约束 ({', '.join(columns)})"


def test_model_declared_indexes_and_uniques_match_migration_head(tmp_path):
    """模型声明的索引/唯一约束与 upgrade head 的真库严格双向一致。"""
    engine = _migrated_engine(tmp_path)
    try:
        assert alembic_version_of(engine) == head_revision()
        model_indexes, model_uniques = _model_entries()
        database_indexes, database_uniques = _database_entries(inspect(engine))

        problems = [
            f"仅模型声明、迁移没建: {_describe_index(entry)}"
            for entry in sorted(model_indexes - database_indexes)
        ]
        problems += [
            f"仅真库有、模型没声明: {_describe_index(entry)}"
            for entry in sorted(database_indexes - model_indexes)
        ]
        problems += [
            f"仅模型声明、迁移没建: {_describe_unique(entry)}"
            for entry in sorted(model_uniques - database_uniques)
        ]
        problems += [
            f"仅真库有、模型没声明: {_describe_unique(entry)}"
            for entry in sorted(database_uniques - model_uniques)
        ]
        assert not problems, (
            "模型元数据与迁移 head 的索引/唯一约束不一致（双向守卫）：\n" + "\n".join(problems)
        )
    finally:
        engine.dispose()


def test_migration_0020_skips_tables_absent_from_a_partial_schema(tmp_path):
    """0020 跑在"只有部分业务表"的库上：缺表跳过，只有存在的那张表建索引，降级同样跳过。"""
    migration = importlib.import_module("migrations.versions.0020_fk_indexes")
    engine = create_engine(f"sqlite:///{(tmp_path / 'partial-0020.db').as_posix()}")
    try:
        # 只造一张表（带上它被索引的那一列）；0020 里其余 29 张表都不存在。
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE resume_record (id INTEGER PRIMARY KEY, parent_revision_id INTEGER)"
            )
        with (
            engine.begin() as connection,
            Operations.context(MigrationContext.configure(connection)),
        ):
            migration.upgrade()
        assert {index["name"] for index in inspect(engine).get_indexes("resume_record")} == {
            "ix_resume_record_parent_revision_id"
        }

        with (
            engine.begin() as connection,
            Operations.context(MigrationContext.configure(connection)),
        ):
            migration.downgrade()
        assert inspect(engine).get_indexes("resume_record") == []
    finally:
        engine.dispose()

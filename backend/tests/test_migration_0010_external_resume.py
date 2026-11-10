# SPDX-License-Identifier: Apache-2.0
"""迁移 0010（外部简历只读快照）的往返与结构语义。

问题清单 `21 的数据层三项守卫之一：新表要能**升得上去、退得回来**，且降级真的把表
删干净、再升回来结构一致。测试在**真实 alembic 迁移出来的库**上验，而不是
`create_all`——后者只能证明模型长这样，证明不了迁移链能跑。

**测试里不写 revision 字面量**：head 从 `tests.migration_refs.head_revision()` 取，
降级只数步数（0010 是最新一条，退一步即 0009）。

除往返外还钉住两条容易写错的语义：

1. `file_id` 外键指向 `user_file.id` 且**不带 ondelete**：物理副本行不随外部简历删除
   而消失（同一 sha 可能被资料照片 / 聊天附件等其它入口引用）；
2. `job_id` 外键是 `ON DELETE SET NULL`（与其余引用岗位的表同一口径）——用
   `sqlite_master` 里的原始 SQL 断言，索引名存在证明不了动作。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect
from tests.migration_refs import alembic_version_of, head_revision

_TABLE = "external_resume"


@pytest.fixture
def migrated(tmp_path):
    """空库升到 head 的引擎（`build_engine` 会开 foreign_keys=ON，与生产同一条 PRAGMA）。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    try:
        yield engine
    finally:
        engine.dispose()


def _table_names(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _column_names(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def _index_names(engine, table: str) -> set[str]:
    return {index["name"] for index in inspect(engine).get_indexes(table)}


def _create_table_sql(engine, table: str) -> str:
    with engine.connect() as connection:
        return connection.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).scalar_one()


def test_head_is_external_resume_migration(migrated):
    """本文件只对"0010 是最新一条"这个前提成立；链上再长一条时它会红并提示改这里。"""
    assert alembic_version_of(migrated) == head_revision()
    assert _TABLE in _table_names(migrated)


def test_upgrade_creates_documented_columns_and_indexes(migrated):
    """列与索引逐个点名：与清单 `21.3 的轻量表一致（多一列少一列都要显式改这里）。"""
    assert {
        "id",
        "file_id",
        "name",
        "text",
        "text_chars",
        "job_id",
        "created_at",
        "updated_at",
        "deleted_at",
    } == _column_names(migrated, _TABLE)
    assert {"ix_external_resume_file_id", "ix_external_resume_job_id"} <= _index_names(
        migrated, _TABLE
    )


def test_foreign_keys_carry_the_right_ondelete_actions(migrated):
    """file_id 不级联删除物理副本登记；job_id 在岗位彻底删除时置空。"""
    sql = _create_table_sql(migrated, _TABLE).upper()
    assert "REFERENCES USER_FILE" in sql
    assert "REFERENCES JOB" in sql and "ON DELETE SET NULL" in sql
    # file_id 一行里不能出现 ON DELETE CASCADE：删除外部简历绝不删 user_file 行。
    file_clause = next(line for line in sql.splitlines() if "FILE_ID" in line)
    assert "CASCADE" not in file_clause and "SET NULL" not in file_clause


def test_downgrade_drops_the_table_and_upgrade_brings_it_back(tmp_path):
    """退一步删表（不报错）、再升回来结构一致。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'roundtrip.db').as_posix()}")
    config = build_alembic_config(engine)
    head = head_revision()
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        columns_before = _column_names(engine, _TABLE)

        # 0010 是当前最新一条：退一步就回到 0009，表必须真的消失。
        command.downgrade(config, "-1")
        assert alembic_version_of(engine) != head
        assert _TABLE not in _table_names(engine)

        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        assert _column_names(engine, _TABLE) == columns_before
    finally:
        engine.dispose()

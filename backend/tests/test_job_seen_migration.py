# SPDX-License-Identifier: Apache-2.0
"""迁移 0012（岗位采样流水 ``job_seen`` + ``job.ghost_ignored``）的往返与结构语义。

15A 僵尸岗雷达与 15B JD 变更监控的全部证据都来自这张表，而"取证"这件事一旦错位，症状
极其安静：**没有报错，只是永远不给分**。所以这里不验"跑得通"，只验四条容易写错的事：

1. 列与索引**逐项点名**（多一列少一列都要显式改这里）；
2. ``job_id`` 的外键是 ``ON DELETE SET NULL``——用 ``sqlite_master`` 里的原始 SQL 断言，
   索引名存在证明不了动作（岗位删了采样还在，是这套设计成立的前提）；
3. ``job.ghost_ignored`` 是**非空 + 默认 0**：老库里的历史行必须能拿到 ``false``，否则
   14A 体检会对每条老岗位抛 ``AttributeError``；
4. 升级对"表和列都已经在"的库**幂等**（``create_all`` 建过的库、以及重跑迁移的场景）。

测试在**真实 alembic 迁移出来的库**上验，而不是 ``create_all``——后者只能证明模型长这样，
证明不了迁移链能跑。revision 字面量一律不从测试里写（见 ``tests/migration_refs.py``）。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import Base, build_engine
from app.database_migrations import BACKEND_DIR, build_alembic_config
from sqlalchemy import inspect
from tests.migration_refs import alembic_version_of, head_revision, prior_revision

_TABLE = "job_seen"
_JOB_TABLE = "job"
_FLAG_COLUMN = "ghost_ignored"
_JOB_SEEN_AT_INDEX = "ix_job_seen_job_id_seen_at"
_SOURCE_INDEX = "ix_job_seen_source_url_company"


@pytest.fixture
def migrated(tmp_path):
    """空库升到 head 的引擎（``build_engine`` 会开 ``foreign_keys=ON``，与生产同一 PRAGMA）。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    try:
        yield engine
    finally:
        engine.dispose()


def _previous_revision() -> str:
    """head 的上一版 revision（从 alembic 实际读：链上再加一条时这里自动跟随）。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    script = ScriptDirectory.from_config(config)
    head = str(script.get_current_head())
    return str(script.get_revision(head).down_revision)


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


def test_upgrade_creates_the_documented_columns(migrated):
    """列与 0012 的清单逐项对齐（多一列少一列都要显式改这里）。"""
    assert _TABLE in _table_names(migrated)
    assert {
        "id",
        "job_id",
        "source_url",
        "title",
        "company",
        "run_id",
        "seen_at",
        "salary_text",
        "hr_active",
        "hr_active_time",
        "description_hash",
        "description_text",
    } == _column_names(migrated, _TABLE)


def test_both_read_paths_have_an_index(migrated):
    """按岗位取序列（job_id, seen_at）与按链接反查（source_url, company）各一条组合索引。"""
    columns_by_index = {
        index["name"]: tuple(index["column_names"])
        for index in inspect(migrated).get_indexes(_TABLE)
    }
    assert columns_by_index[_JOB_SEEN_AT_INDEX] == ("job_id", "seen_at")
    assert columns_by_index[_SOURCE_INDEX] == ("source_url", "company")


def test_job_id_foreign_key_is_set_null(migrated):
    """岗位被彻底删除时采样行保留（``ON DELETE SET NULL``），不级联删历史。"""
    sql = _create_table_sql(migrated, _TABLE).upper()
    assert "REFERENCES JOB" in sql
    assert "ON DELETE SET NULL" in sql
    job_clause = next(line for line in sql.splitlines() if "JOB_ID" in line)
    assert "CASCADE" not in job_clause


def test_ghost_ignored_flag_is_not_null_with_zero_default(migrated):
    """老库里的岗位行必须拿到 ``false``：非空列 + 默认 0，缺一个都会让 14A 体检炸掉。"""
    columns = {column["name"]: column for column in inspect(migrated).get_columns(_JOB_TABLE)}
    assert _FLAG_COLUMN in columns
    assert columns[_FLAG_COLUMN]["nullable"] is False
    assert str(columns[_FLAG_COLUMN]["default"]).strip("'") == "0"


def test_upgrade_is_idempotent_on_a_create_all_database(tmp_path):
    """表/列都已存在时，迁移必须跳过而不是抛 ``table already exists``。

    真实场景：``create_all`` 建过库的开发机、以及"模型先行、迁移后到"的半新库。判据是
    "升到 head 不炸 + 版本号推进"，不是"跳过"这个动作本身。
    """
    engine = build_engine(f"sqlite:///{(tmp_path / 'create-all.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        Base.metadata.create_all(bind=engine)
        assert _TABLE in _table_names(engine)
        # 把版本号写成上一版：迁移 0012 会真的被执行一次，而它的对象已经在了。
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS alembic_version ("
                "version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
            connection.exec_driver_sql("DELETE FROM alembic_version")
            connection.exec_driver_sql(
                "INSERT INTO alembic_version (version_num) VALUES (?)", (_previous_revision(),)
            )

        command.upgrade(config, "head")

        assert alembic_version_of(engine) == head_revision()
        assert _TABLE in _table_names(engine)
        assert _FLAG_COLUMN in _column_names(engine, _JOB_TABLE)
    finally:
        engine.dispose()


def test_downgrade_drops_the_table_and_the_flag_then_upgrade_restores(tmp_path):
    """降到本迁移之前删表与忽略开关（不报错）、再升回来结构与索引一致。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'roundtrip.db').as_posix()}")
    config = build_alembic_config(engine)
    head = head_revision()
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        columns_before = _column_names(engine, _TABLE)
        indexes_before = _index_names(engine, _TABLE)

        # 退到本迁移之前：按 revision 名定位父版本，不数步数（链尾再加迁移不会过期）。
        command.downgrade(config, prior_revision("_job_seen"))
        assert alembic_version_of(engine) != head
        assert _TABLE not in _table_names(engine)
        assert _FLAG_COLUMN not in _column_names(engine, _JOB_TABLE)
        # job 表本身不能被降级带走（只删一列）。
        assert "title" in _column_names(engine, _JOB_TABLE)

        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        assert _column_names(engine, _TABLE) == columns_before
        assert _index_names(engine, _TABLE) == indexes_before
    finally:
        engine.dispose()

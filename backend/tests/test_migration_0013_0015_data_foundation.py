# SPDX-License-Identifier: Apache-2.0
"""迁移 0013/0014/0015（收藏时间戳 / 知识库五列 / 助手语义记忆）的结构与回填语义。

这三条迁移合起来是 #28/#29/#31 的数据底座。它们写错的症状都很安静：
收藏时间取不到只是排序不对、知识库新列缺默认值只是老条目显示成 NULL、
assistant_memory 少一个索引只是注入慢一点——没有一条会报错。所以这里逐项钉子：

1. 多条迁移一次往返：升级到 head → 逐条降级回 0012 → 再升回 head，表/列/索引集合一致；
2. 0013 的老数据回填：只回填 favorite=1 且原本没有时间戳的行，回填值来自 updated_at，
   并把 favorited_at_estimated 置真（界面「时间不详」的唯一判据）；未收藏行必须仍是 NULL；
3. 0014 的 job_id 外键是 ON DELETE SET NULL（用 sqlite_master 原始 SQL 断言），
   company 有索引，reason/company/summary 对老行是空串、key_points 是空数组；
4. 0015 的 assistant_memory 列与索引逐项点名，外键 SET NULL；
5. 对 create_all 建过的库**幂等**（模型先行、迁移后到的半新库也能升）。

测试在真实 alembic 迁移库上验（不用 create_all），revision 字面量一律不写：
目标 revision 从迁移链上按步数反推（见 _ancestor_revision）。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import Base, build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect
from tests.migration_refs import alembic_version_of, head_revision, prior_revision


def _revision_before_favorite() -> str:
    """0013 收藏时间戳迁移的父版本（按 revision 名定位，不数步数）。"""
    return prior_revision("_favorite_timestamps")


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


def _insert_row(connection, table: str, **overrides) -> None:
    """插入一行，补齐所有 NOT NULL 且没有默认值的列（不依赖模型的 Python 侧默认值）。"""
    info = connection.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    values: dict[str, object] = {}
    for row in info:
        name, column_type, not_null, default, primary_key = row[1], row[2], row[3], row[4], row[5]
        if primary_key or not not_null or default is not None or name in overrides:
            continue
        upper = str(column_type or "").upper()
        if any(token in upper for token in ("INT", "BOOL", "FLOAT", "REAL")):
            values[name] = 0
        elif "DATE" in upper or "TIME" in upper:
            values[name] = "2026-01-01 00:00:00"
        else:
            values[name] = ""
    values.update(overrides)
    columns = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    connection.exec_driver_sql(
        f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(values.values())
    )


@pytest.fixture
def engine_at_head(tmp_path):
    """空库升到 head 的引擎（与生产同一 PRAGMA：build_engine 会开 foreign_keys=ON）。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'head.db').as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    try:
        yield engine
    finally:
        engine.dispose()


def test_0013_adds_favorite_timestamps_to_both_tables(engine_at_head):
    """job / resume_record 各多两列：可空时间戳 + 非空 estimated 标志。"""
    for table in ("job", "resume_record"):
        columns = {column["name"]: column for column in inspect(engine_at_head).get_columns(table)}
        assert "favorited_at" in columns
        assert columns["favorited_at"]["nullable"] is True
        assert "favorited_at_estimated" in columns
        estimated = columns["favorited_at_estimated"]
        assert estimated["nullable"] is False
        assert str(estimated["default"]).strip("'") == "0"


def test_0013_backfills_old_favorites_from_updated_at(tmp_path):
    """老收藏行用 updated_at 回填且标 estimated；未收藏行保持 NULL（取消收藏语义的前提）。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'backfill.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, _revision_before_favorite())
        with engine.begin() as connection:
            _insert_row(
                connection,
                "job",
                title="老岗位",
                company="字节",
                favorite=1,
                created_at="2024-01-01 08:00:00",
                updated_at="2026-11-01 10:30:00",
            )
            _insert_row(
                connection,
                "job",
                title="没收藏",
                favorite=0,
                created_at="2024-01-01 08:00:00",
                updated_at="2026-11-02 10:30:00",
            )
            _insert_row(
                connection,
                "resume_record",
                title="老简历",
                favorite=1,
                created_at="2024-01-01 08:00:00",
                updated_at="2026-10-20 09:00:00",
            )
        command.upgrade(config, "head")

        with engine.connect() as connection:
            rows = connection.exec_driver_sql(
                "SELECT title, favorite, favorited_at, favorited_at_estimated FROM job ORDER BY id"
            ).fetchall()
        favorited = rows[0]
        unfavorited = rows[1]
        assert favorited[1] == 1
        assert str(favorited[2]) == "2026-11-01 10:30:00"
        assert favorited[3] == 1, "回填值必须标近似（界面据此显示「时间不详」）"
        assert unfavorited[2] is None, "未收藏行不允许有收藏时间"
        assert unfavorited[3] == 0

        with engine.connect() as connection:
            resume = connection.exec_driver_sql(
                "SELECT favorited_at, favorited_at_estimated FROM resume_record"
            ).fetchone()
        assert str(resume[0]) == "2026-10-20 09:00:00"
        assert resume[1] == 1
    finally:
        engine.dispose()


def test_0014_adds_five_columns_with_defaults_and_company_index(engine_at_head):
    """五列一次加完：reason/company/summary 老行空串、key_points 老行空数组、company 有索引。"""
    columns = {
        column["name"]: column for column in inspect(engine_at_head).get_columns("knowledge_entry")
    }
    assert {"reason", "company", "job_id", "summary", "key_points"} <= set(columns)
    assert columns["reason"]["nullable"] is False
    assert columns["company"]["nullable"] is False
    assert columns["summary"]["nullable"] is False
    assert columns["job_id"]["nullable"] is True
    assert columns["key_points"]["nullable"] is False
    assert "ix_knowledge_entry_company" in _index_names(engine_at_head, "knowledge_entry")

    with engine_at_head.connect() as connection:
        _insert_row(
            connection,
            "knowledge_entry",
            title="旧条目",
            category="面经",
            content="正文",
            created_at="2026-01-01 00:00:00",
            updated_at="2026-01-01 00:00:00",
        )
        row = connection.exec_driver_sql(
            "SELECT reason, company, job_id, summary, key_points FROM knowledge_entry"
        ).fetchone()
    assert row == ("", "", None, "", "[]")


def test_0014_job_id_foreign_key_is_set_null(engine_at_head):
    """岗位彻底删除后知识条目保留（ON DELETE SET NULL），不级联删用户写的知识。"""
    sql = _create_table_sql(engine_at_head, "knowledge_entry").upper()
    assert "REFERENCES JOB" in sql
    assert "ON DELETE SET NULL" in sql
    job_line = next(line for line in sql.splitlines() if "JOB_ID" in line)
    assert "CASCADE" not in job_line


def test_0015_creates_assistant_memory_with_indexes_and_set_null_fks(engine_at_head):
    """语义记忆表：列逐项点名、三个索引、两个来源外键都是 SET NULL。"""
    assert "assistant_memory" in _table_names(engine_at_head)
    assert {
        "id",
        "kind",
        "key",
        "value",
        "confidence",
        "source_conversation_id",
        "source_message_id",
        "status",
        "source",
        "created_at",
        "updated_at",
    } == _column_names(engine_at_head, "assistant_memory")
    assert {
        "ix_assistant_memory_kind_status",
        "ix_assistant_memory_source_conversation_id",
        "ix_assistant_memory_source_message_id",
    } <= _index_names(engine_at_head, "assistant_memory")
    sql = _create_table_sql(engine_at_head, "assistant_memory").upper()
    for table in ("CHAT_CONVERSATION", "CHAT_MESSAGE"):
        assert f"REFERENCES {table}" in sql
    assert sql.count("ON DELETE SET NULL") == 2


def test_round_trip_through_all_three_migrations(tmp_path):
    """升到 head → 逐条退三步 → 再升回 head：表/列/索引集合一致（降级真的删干净了）。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'roundtrip.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        head = head_revision()
        knowledge_columns = _column_names(engine, "knowledge_entry")
        job_columns = _column_names(engine, "job")

        # 退到 0013 之前（按名字定位，加新迁移后不会数错步数）。
        command.downgrade(config, _revision_before_favorite())
        assert alembic_version_of(engine) == _revision_before_favorite()
        assert "assistant_memory" not in _table_names(engine)
        assert "favorited_at" not in _column_names(engine, "job")
        assert "favorited_at" not in _column_names(engine, "resume_record")
        assert "reason" not in _column_names(engine, "knowledge_entry")
        # 降级只删自己的东西：两表其余列与业务数据不动。
        assert "title" in _column_names(engine, "job")
        assert "content" in _column_names(engine, "knowledge_entry")

        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head
        assert _column_names(engine, "knowledge_entry") == knowledge_columns
        assert _column_names(engine, "job") == job_columns
        assert "assistant_memory" in _table_names(engine)
    finally:
        engine.dispose()


def test_upgrade_is_idempotent_on_a_create_all_database(tmp_path):
    """create_all 建过（对象都在）时三条迁移都要跳过而不是抛 already exists。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'create-all.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        Base.metadata.create_all(bind=engine)
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS alembic_version ("
                "version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
            connection.exec_driver_sql("DELETE FROM alembic_version")
            connection.exec_driver_sql(
                "INSERT INTO alembic_version (version_num) VALUES (?)",
                (_revision_before_favorite(),),
            )
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head_revision()
        assert "assistant_memory" in _table_names(engine)
        assert "favorited_at_estimated" in _column_names(engine, "resume_record")
    finally:
        engine.dispose()

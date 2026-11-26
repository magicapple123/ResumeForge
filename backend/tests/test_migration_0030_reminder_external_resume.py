# SPDX-License-Identifier: Apache-2.0
"""迁移 0030（``reminder.external_resume_id``，R14）的往返。

钉四件事：

1. 升级后 ``reminder`` 有 ``external_resume_id`` 列 + ``ix_reminder_external_resume_id``
   索引，且外键 ``ON DELETE SET NULL`` 真的写进了表 DDL；
2. batch 重建表**不丢既有索引与外键**（``ix_reminder_remind_at`` / ``ix_reminder_status``
   与另外三条 SET NULL）；
3. 降级把列与索引删干净，提醒行本身不丢，再升级能按原样加回来；
4. 只有部分业务表的库：没有 ``reminder`` 直接跳过；有 ``reminder`` 但没有
   ``external_resume`` 时只加列与索引、不建悬挂外键。

**不写 revision 字面量**：head 从 ``tests.migration_refs.head_revision()`` 取，
"退到本迁移之前"用 ``prior_revision(_SUFFIX)`` 按名字找父版本。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect, text
from tests.migration_refs import alembic_version_of, head_revision, prior_revision

TABLE = "reminder"
COLUMN = "external_resume_id"
INDEX = f"ix_{TABLE}_{COLUMN}"
#: 本迁移的 revision 后缀取自文件名：不在测试里写 revision 字面量（T02 守卫）。
_SUFFIX = Path(__file__).stem.removeprefix("test_migration_")


def _upgrade(engine) -> None:
    command.upgrade(build_alembic_config(engine), "head")


def _downgrade_to_parent(engine) -> None:
    command.downgrade(build_alembic_config(engine), prior_revision(_SUFFIX))


def _table_ddl(engine, table: str) -> str:
    with engine.connect() as connection:
        sql = connection.execute(
            text("select sql from sqlite_master where type = 'table' and name = :name"),
            {"name": table},
        ).scalar()
    return str(sql or "")


def _insert_reminder(database: Path) -> None:
    """用裸 ``sqlite3`` 写一行：外键此刻还没建，也不需要夹具帮忙凑父行。"""
    with sqlite3.connect(database) as connection:
        connection.execute(
            "insert into reminder (title, remind_at, kind, status, note, created_at, updated_at) "
            "values ('跟进那份外部简历', '2026-11-20 09:00:00', 'other', 'active', '', "
            "'2026-11-19 08:00:00', '2026-11-19 08:00:00')"
        )


def test_upgrade_adds_column_index_and_set_null_foreign_key(tmp_path):
    database = tmp_path / "reminder-external.db"
    engine = build_engine(f"sqlite:///{database.as_posix()}")
    try:
        _upgrade(engine)
        assert alembic_version_of(engine) == head_revision()
        inspector = inspect(engine)

        columns = {column["name"] for column in inspector.get_columns(TABLE)}
        assert COLUMN in columns
        nullable = {c["name"]: c["nullable"] for c in inspector.get_columns(TABLE)}[COLUMN]
        assert nullable is True, "没关联就是 NULL，不应是 NOT NULL"

        indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
        assert INDEX in indexes
        # batch 重建表不能把既有索引吃掉。
        assert {f"ix_{TABLE}_remind_at", f"ix_{TABLE}_status"} <= indexes

        foreign_keys = {
            (tuple(fk["constrained_columns"]), fk["referred_table"])
            for fk in inspector.get_foreign_keys(TABLE)
        }
        assert ((COLUMN,), "external_resume") in foreign_keys
        assert (("resume_id",), "resume_record") in foreign_keys
        ddl = _table_ddl(engine, TABLE)
        assert "REFERENCES external_resume " in ddl
        # 三条既有 SET NULL + 新增这一条。
        assert ddl.upper().count("ON DELETE SET NULL") == 4
    finally:
        engine.dispose()


def test_downgrade_drops_column_and_keeps_rows(tmp_path):
    database = tmp_path / "reminder-external-down.db"
    engine = build_engine(f"sqlite:///{database.as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        _insert_reminder(database)
        _upgrade(engine)

        _downgrade_to_parent(engine)

        inspector = inspect(engine)
        assert COLUMN not in {column["name"] for column in inspector.get_columns(TABLE)}
        assert INDEX not in {index["name"] for index in inspector.get_indexes(TABLE)}
        with engine.connect() as connection:
            titles = [row[0] for row in connection.execute(text("select title from reminder"))]
        assert titles == ["跟进那份外部简历"]

        _upgrade(engine)
        assert COLUMN in {column["name"] for column in inspect(engine).get_columns(TABLE)}
    finally:
        engine.dispose()


def test_upgrade_skips_missing_reminder_table(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'no-reminder.db').as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        with engine.begin() as connection:
            connection.execute(text(f"drop table {TABLE}"))
        _upgrade(engine)
        assert TABLE not in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_without_external_resume_table_adds_no_foreign_key(tmp_path):
    """只有部分业务表的库：没有 ``external_resume`` 可指，加列 + 索引但绝不建悬挂外键。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'no-external.db').as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        with engine.begin() as connection:
            connection.execute(text("drop table external_resume_revision"))
            connection.execute(text("drop table external_resume"))
        _upgrade(engine)

        inspector = inspect(engine)
        assert COLUMN in {column["name"] for column in inspector.get_columns(TABLE)}
        assert INDEX in {index["name"] for index in inspector.get_indexes(TABLE)}
        # 只断言"没有指向 external_resume 的外键"：列名 external_resume_id 本身当然在 DDL 里。
        assert "REFERENCES external_resume " not in _table_ddl(engine, TABLE)
    finally:
        engine.dispose()

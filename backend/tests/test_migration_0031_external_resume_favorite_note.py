# SPDX-License-Identifier: Apache-2.0
"""迁移 0031（``external_resume`` 的 ``favorite`` / ``favorited_at`` / ``note``）的往返。

钉四件事：

1. 升级后三列都在，且 ``favorite`` / ``note`` 是 NOT NULL + 有 server_default
   （既有行不需要回填就有值）；
2. **老行拿到的是"未收藏 / 无备注"**：升级前插入的行在升级后 ``favorite=0``、
   ``favorited_at IS NULL``、``note=''``——`ALTER TABLE ADD COLUMN ... NOT NULL` 在有数据的
   表上不给默认值会直接失败，这条用例就是那个风险的哨兵；
3. 降级把三列一起删干净，行本身不丢，再升级能按原样加回来；
4. 只有部分业务表的库（没有 ``external_resume``）升级/降级都跳过，不报错。

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

TABLE = "external_resume"
COLUMNS = ("favorite", "favorited_at", "note")
#: 本迁移的 revision 后缀取自文件名：不在测试里写 revision 字面量（T02 守卫）。
_SUFFIX = Path(__file__).stem.removeprefix("test_migration_")


def _upgrade(engine) -> None:
    command.upgrade(build_alembic_config(engine), "head")


def _downgrade_to_parent(engine) -> None:
    command.downgrade(build_alembic_config(engine), prior_revision(_SUFFIX))


def _insert_external_resume(database: Path) -> None:
    """裸 ``sqlite3`` 插一行：``user_file`` 父行不必造（默认不启用外键）。"""
    with sqlite3.connect(database) as connection:
        connection.execute(
            "insert into external_resume (file_id, name, text, text_chars, created_at, updated_at) "
            "values (1, '别处生成的那版.pdf', '正文', 2, "
            "'2026-11-19 08:00:00', '2026-11-19 08:00:00')"
        )


def test_upgrade_adds_three_columns_with_defaults(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'fav.db').as_posix()}")
    try:
        _upgrade(engine)
        assert alembic_version_of(engine) == head_revision()
        columns = {column["name"]: column for column in inspect(engine).get_columns(TABLE)}

        assert set(COLUMNS) <= set(columns)
        assert columns["favorite"]["nullable"] is False
        assert columns["note"]["nullable"] is False
        assert columns["favorited_at"]["nullable"] is True
    finally:
        engine.dispose()


def test_existing_rows_get_unfavorited_defaults(tmp_path):
    database = tmp_path / "fav-data.db"
    engine = build_engine(f"sqlite:///{database.as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        _insert_external_resume(database)

        _upgrade(engine)

        with engine.connect() as connection:
            row = connection.execute(
                text("select name, favorite, favorited_at, note from external_resume")
            ).one()
        assert row[0] == "别处生成的那版.pdf"
        assert row[1] in (0, False), "既有行升级后必须是未收藏"
        assert row[2] is None, "没收藏过就没有收藏时刻"
        assert row[3] == "", "备注默认空串（与内部简历同口径）"
    finally:
        engine.dispose()


def test_downgrade_drops_columns_and_keeps_rows(tmp_path):
    database = tmp_path / "fav-down.db"
    engine = build_engine(f"sqlite:///{database.as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        _insert_external_resume(database)
        _upgrade(engine)

        _downgrade_to_parent(engine)

        present = {column["name"] for column in inspect(engine).get_columns(TABLE)}
        assert not set(COLUMNS) & present
        with engine.connect() as connection:
            names = [row[0] for row in connection.execute(text("select name from external_resume"))]
        assert names == ["别处生成的那版.pdf"]

        _upgrade(engine)
        assert set(COLUMNS) <= {c["name"] for c in inspect(engine).get_columns(TABLE)}
    finally:
        engine.dispose()


def test_upgrade_and_downgrade_skip_missing_table(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'fav-partial.db').as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        with engine.begin() as connection:
            connection.execute(text("drop table external_resume_revision"))
            connection.execute(text(f"drop table {TABLE}"))
        _upgrade(engine)
        assert TABLE not in set(inspect(engine).get_table_names())
        _downgrade_to_parent(engine)
        assert TABLE not in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

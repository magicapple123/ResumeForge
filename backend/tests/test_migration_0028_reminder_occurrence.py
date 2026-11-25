# SPDX-License-Identifier: Apache-2.0
"""迁移 0028（CR-28：reminder_occurrence 表 + 重复规则两列 + status 收窄）的往返。

钉四件事：

1. 升级后 occurrence 表、三个索引、``reminder.recurrence`` / ``recurrence_until`` 都在；
2. **数据迁移**：每条既有 reminder 生成一条 occurrence（``due_at = remind_at``），
   旧三态按 done→done / dismissed→skipped 落到 occurrence，计划本身收窄为 active/archived；
3. 降级把 status 按 occurrence 还原成旧取值、删两列、删表，再升回来不报错；
4. 只有部分业务表的库（没有 ``reminder``）升级直接跳过，不建悬挂外键。

**不写 revision 字面量**：head 从 ``tests.migration_refs.head_revision()`` 取，
"退到本迁移之前"用 ``prior_revision(_SUFFIX)`` 按名字找父版本。
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect, text
from tests.migration_refs import prior_revision

TABLE = "reminder_occurrence"
#: 本迁移的 revision 后缀取自文件名：不在测试里写 revision 字面量（T02 守卫）。
_SUFFIX = Path(__file__).stem.removeprefix("test_migration_")


def _upgrade(engine) -> None:
    command.upgrade(build_alembic_config(engine), "head")


def _downgrade_to_parent(engine) -> None:
    command.downgrade(build_alembic_config(engine), prior_revision(_SUFFIX))


def _insert_legacy_reminder(engine, *, status: str, title: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "insert into reminder (title, remind_at, kind, status, note, created_at, updated_at) "
                "values (:title, '2026-11-20 09:00:00.000000', 'other', :status, '', "
                "'2026-11-19 08:00:00.000000', '2026-11-19 08:00:00.000000')"
            ),
            {"title": title, "status": status},
        )


def test_upgrade_creates_table_indexes_and_columns(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'occ.db').as_posix()}")
    try:
        _upgrade(engine)
        inspector = inspect(engine)
        assert TABLE in set(inspector.get_table_names())

        columns = {column["name"] for column in inspector.get_columns(TABLE)}
        assert {
            "id",
            "reminder_id",
            "due_at",
            "status",
            "notified_at",
            "snoozed_from",
            "created_at",
            "updated_at",
        } <= columns
        indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
        assert {f"ix_{TABLE}_reminder_id", f"ix_{TABLE}_due_at", f"ix_{TABLE}_status"} <= indexes

        reminder_columns = {column["name"] for column in inspector.get_columns("reminder")}
        assert {"recurrence", "recurrence_until"} <= reminder_columns
    finally:
        engine.dispose()


def test_existing_rows_get_one_occurrence_and_narrowed_status(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'occ-data.db').as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        _insert_legacy_reminder(engine, status="pending", title="待办的那条")
        _insert_legacy_reminder(engine, status="done", title="做完的那条")
        _insert_legacy_reminder(engine, status="dismissed", title="忽略的那条")

        _upgrade(engine)

        with engine.connect() as connection:
            plans = {
                title: status
                for title, status in connection.execute(text("select title, status from reminder"))
            }
            occurrences = connection.execute(
                text(
                    "select r.title, o.due_at, o.status from reminder_occurrence o "
                    "join reminder r on r.id = o.reminder_id order by r.title"
                )
            ).fetchall()

        assert plans == {
            "待办的那条": "active",
            "做完的那条": "archived",
            "忽略的那条": "archived",
        }
        assert len(occurrences) == 3
        by_title = {row[0]: (row[1], row[2]) for row in occurrences}
        assert by_title["待办的那条"] == ("2026-11-20 09:00:00.000000", "pending")
        assert by_title["做完的那条"] == ("2026-11-20 09:00:00.000000", "done")
        assert by_title["忽略的那条"] == ("2026-11-20 09:00:00.000000", "skipped")
    finally:
        engine.dispose()


def test_downgrade_restores_legacy_status_and_drops_table(tmp_path):
    engine = build_engine(f"sqlite:///{(tmp_path / 'occ-down.db').as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        _insert_legacy_reminder(engine, status="pending", title="待办的那条")
        _insert_legacy_reminder(engine, status="done", title="做完的那条")
        _upgrade(engine)

        _downgrade_to_parent(engine)

        inspector = inspect(engine)
        assert TABLE not in set(inspector.get_table_names())
        reminder_columns = {column["name"] for column in inspector.get_columns("reminder")}
        assert "recurrence" not in reminder_columns
        assert "recurrence_until" not in reminder_columns
        with engine.connect() as connection:
            plans = {
                title: status
                for title, status in connection.execute(text("select title, status from reminder"))
            }
        # active → pending；归档的计划按它最后一次 occurrence 的结果还原。
        assert plans == {"待办的那条": "pending", "做完的那条": "done"}

        _upgrade(engine)
        assert TABLE in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_skips_when_reminder_table_missing(tmp_path):
    """只有部分业务表的库：没有 reminder 时不建悬挂外键，也不报错。"""
    engine = build_engine(f"sqlite:///{(tmp_path / 'occ-partial.db').as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), prior_revision(_SUFFIX))
        with engine.begin() as connection:
            connection.execute(text("drop table reminder"))
        _upgrade(engine)
        assert TABLE not in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

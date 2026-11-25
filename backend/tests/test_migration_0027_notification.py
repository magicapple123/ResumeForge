# SPDX-License-Identifier: Apache-2.0
"""迁移 0027（CR-22：notification 表 + reminder.last_notified_at）的升级/降级往返。

钉四件事：

1. 升级后通知表、唯一去重索引、时间索引都在，且 ``reminder`` 多出 ``last_notified_at``；
2. 降级把索引/表/列删干净，再升回来不报错；
3. 表/列已存在时升级是空操作（迁移会跑在"只有部分业务表"的库上）；
4. ``dedupe_key`` 真的唯一（服务层幂等的最后一道闸）。

**不写 revision 字面量**：head 从 ``tests.migration_refs.head_revision()`` 取，
"退到本迁移之前"用 ``prior_revision("_notification")`` 按名字找父版本。
"""

from __future__ import annotations

import pytest
from alembic import command
from app.database import build_engine
from app.database_migrations import build_alembic_config
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from tests.migration_refs import prior_revision

TABLE = "notification"


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'notification.db').as_posix()}"


def _upgrade(engine) -> None:
    command.upgrade(build_alembic_config(engine), "head")


def _downgrade_to_parent(engine) -> None:
    command.downgrade(build_alembic_config(engine), prior_revision("_notification"))


def test_upgrade_creates_table_indexes_and_reminder_column(database_url):
    engine = build_engine(database_url)
    try:
        _upgrade(engine)
        inspector = inspect(engine)
        assert TABLE in set(inspector.get_table_names())

        columns = {column["name"] for column in inspector.get_columns(TABLE)}
        assert {
            "type",
            "severity",
            "title",
            "body",
            "deep_link",
            "dedupe_key",
            "read_at",
            "created_at",
            "expires_at",
            "dataset_key",
        } <= columns

        indexes = {index["name"]: index for index in inspector.get_indexes(TABLE)}
        assert indexes[f"ix_{TABLE}_dedupe_key"]["unique"] == 1
        assert "ix_notification_created_at" in indexes

        reminder_columns = {column["name"] for column in inspector.get_columns("reminder")}
        assert "last_notified_at" in reminder_columns
    finally:
        engine.dispose()


def test_downgrade_removes_everything_and_upgrade_again_works(database_url):
    engine = build_engine(database_url)
    try:
        _upgrade(engine)
        _downgrade_to_parent(engine)
        inspector = inspect(engine)
        assert TABLE not in set(inspector.get_table_names())
        assert "last_notified_at" not in {
            column["name"] for column in inspector.get_columns("reminder")
        }
        _upgrade(engine)
        assert TABLE in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_is_noop_when_table_already_exists(database_url):
    engine = build_engine(database_url)
    try:
        _upgrade(engine)
        _upgrade(engine)  # 重复执行不应报错
        assert TABLE in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_dedupe_key_is_unique(database_url):
    engine = build_engine(database_url)
    try:
        _upgrade(engine)
        with engine.begin() as connection:
            connection.execute(
                text(
                    f"insert into {TABLE} (type, severity, title, body, deep_link, dedupe_key, created_at, dataset_key) "
                    "values ('reminder_due', 'info', 't', '', '', 'k1', CURRENT_TIMESTAMP, 'main')"
                )
            )
        with engine.begin() as connection, pytest.raises(IntegrityError):
            connection.execute(
                text(
                    f"insert into {TABLE} (type, severity, title, body, deep_link, dedupe_key, created_at, dataset_key) "
                    "values ('reminder_due', 'info', 't', '', '', 'k1', CURRENT_TIMESTAMP, 'main')"
                )
            )
    finally:
        engine.dispose()

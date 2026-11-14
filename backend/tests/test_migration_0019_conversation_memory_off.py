# SPDX-License-Identifier: Apache-2.0
"""0019_conversation_memory_off：升级/降级往返与"没有会话表"时的无操作。

revision 字面量不写在测试里：head 用 head_revision()，降级用
prior_revision("_conversation_memory_off") 按名字找父版本。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect
from tests.migration_refs import alembic_version_of, head_revision, prior_revision

TABLE = "chat_conversation"
COLUMN = "memory_off"


def _columns(engine) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(TABLE)}


def test_migration_0019_round_trip(tmp_path):
    """三段：upgrade(head) 加列 → downgrade 后列消失 → 再 upgrade 复原。"""
    engine = create_engine(f"sqlite:///{(tmp_path / 'memory-off.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head_revision()
        assert COLUMN in _columns(engine)

        command.downgrade(config, prior_revision("_conversation_memory_off"))
        assert alembic_version_of(engine) != head_revision()
        assert COLUMN not in _columns(engine)

        command.upgrade(config, "head")
        assert COLUMN in _columns(engine)
    finally:
        engine.dispose()


def test_migration_0019_is_noop_without_conversation_table(tmp_path):
    """会话表不存在的库：迁移必须直接跳过而不是报错。"""
    import importlib

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration = importlib.import_module("migrations.versions.0019_conversation_memory_off")
    engine = create_engine(f"sqlite:///{(tmp_path / 'partial-0019.db').as_posix()}")
    try:
        with engine.begin() as connection:
            context = MigrationContext.configure(connection)
            with Operations.context(context):
                migration.upgrade()
                migration.downgrade()
        assert TABLE not in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

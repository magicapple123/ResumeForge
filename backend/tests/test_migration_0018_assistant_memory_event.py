# SPDX-License-Identifier: Apache-2.0
"""0018_assistant_memory_event：升级/降级往返与"部分业务表"上的无操作。

revision 字面量不写在测试里：head 用 head_revision()，降级用
prior_revision("_assistant_memory_event") 按名字找父版本。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect
from tests.migration_refs import alembic_version_of, head_revision, prior_revision

TABLE = "assistant_memory_event"


def _tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_migration_0018_round_trip(tmp_path):
    """三段：upgrade(head) 建表 → downgrade 后表消失 → 再 upgrade 复原。"""
    engine = create_engine(f"sqlite:///{(tmp_path / 'memory-event.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head_revision()
        assert TABLE in _tables(engine)

        command.downgrade(config, prior_revision("_assistant_memory_event"))
        assert alembic_version_of(engine) != head_revision()
        assert TABLE not in _tables(engine)

        command.upgrade(config, "head")
        assert TABLE in _tables(engine)
    finally:
        engine.dispose()


def test_migration_0018_is_noop_without_memory_table(tmp_path):
    """记忆表不存在的库：建外键会失败，所以迁移必须直接跳过而不是报错。"""
    import importlib

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration = importlib.import_module("migrations.versions.0018_assistant_memory_event")
    engine = create_engine(f"sqlite:///{(tmp_path / 'partial-0018.db').as_posix()}")
    try:
        with engine.begin() as connection:
            context = MigrationContext.configure(connection)
            with Operations.context(context):
                migration.upgrade()
                migration.downgrade()
        assert TABLE not in _tables(engine)
    finally:
        engine.dispose()

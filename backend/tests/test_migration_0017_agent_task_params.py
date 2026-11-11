# SPDX-License-Identifier: Apache-2.0
"""0017_agent_task_params：升级/降级往返（三段）与列存在性。

revision 字面量不写在测试里（守卫只允许 tests/migration_refs.py 出现）；
head 用 head_revision()，降级用 prior_revision("_agent_task_params") 按名字找父版本。
"""

from __future__ import annotations

from alembic import command
from app.database_migrations import build_alembic_config
from sqlalchemy import create_engine, inspect
from tests.migration_refs import alembic_version_of, head_revision, prior_revision


def _agent_task_columns(engine) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns("agent_task")}


def test_migration_0017_round_trip(tmp_path):
    """三段：upgrade(head) 加列 → downgrade 到 0016 后列消失 → 再 upgrade 复原。"""
    engine = create_engine(f"sqlite:///{(tmp_path / 'agent-task-params.db').as_posix()}")
    config = build_alembic_config(engine)
    try:
        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head_revision()
        assert "params" in _agent_task_columns(engine)

        command.downgrade(config, prior_revision("_agent_task_params"))
        assert alembic_version_of(engine) != head_revision()
        assert "params" not in _agent_task_columns(engine)

        command.upgrade(config, "head")
        assert alembic_version_of(engine) == head_revision()
        assert "params" in _agent_task_columns(engine)
    finally:
        engine.dispose()


def test_migration_0017_is_noop_on_database_without_agent_task(tmp_path):
    """只有部分业务表的库（迁移自己会跑在这种库上）：表不存在时直接跳过，不报错。"""
    import importlib

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect

    migration = importlib.import_module("migrations.versions.0017_agent_task_params")

    engine = create_engine(f"sqlite:///{(tmp_path / 'partial.db').as_posix()}")
    try:
        with engine.begin() as connection:
            context = MigrationContext.configure(connection)
            with Operations.context(context):
                migration.upgrade()
                migration.downgrade()
        assert "agent_task" not in set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

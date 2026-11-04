# SPDX-License-Identifier: Apache-2.0
"""数据库迁移执行器（2.0 收缩后）测试：只做快照 + upgrade，不判定/不归档/不建空库。

2.0 起 pre-2.0 库由启动闸门先整包归档再建空库，执行器只面对"空库或合法 2.0 库"。
这里钉住三条边界：空库一次建全；有用户数据才快照（app_schema_epoch 播种行不算用户
数据）；无版本号但有业务表时大声失败，而不是像 1.x 那样兼容建表后 stamp 基线。
"""

import pytest
from app.database_migrations import run_database_migrations
from app.models import Job
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from tests.test_database import _assert_head_schema


class _FakeScripts:
    """把 head 报成"未来版本"的 ScriptDirectory 替身（只替换执行器自己的查询）。

    不 monkeypatch 真实的 ScriptDirectory：command.upgrade 内部也要用真实 head，
    两边一起被换掉会去解析一个不存在的 revision。"head 比当前库新"是迁移前快照
    分支的唯一触发条件，而单基线形态下真实链里没有更早的 2.0 revision，只能这样构造。
    """

    def __init__(self, head: str) -> None:
        self._head = head

    @classmethod
    def from_config(cls, _config):
        return cls("9999_fake_future")

    def get_current_head(self) -> str:
        return self._head


def _empty_engine(tmp_path, name: str):
    return create_engine(f"sqlite:///{(tmp_path / name).as_posix()}")


def test_migration_runner_builds_schema_from_empty_database(tmp_path):
    engine = _empty_engine(tmp_path, "runner-empty.db")
    try:
        assert run_database_migrations(engine) is None
        _assert_head_schema(engine)
    finally:
        engine.dispose()


def test_migration_runner_supports_in_memory_database():
    engine = create_engine("sqlite:///:memory:")
    try:
        assert run_database_migrations(engine) is None
        _assert_head_schema(engine)
    finally:
        engine.dispose()


def test_migration_runner_creates_no_snapshot_for_empty_database(tmp_path, monkeypatch):
    from app import database_migrations as runner

    engine = _empty_engine(tmp_path, "runner-no-snapshot.db")
    try:
        assert run_database_migrations(engine) is None
        assert not (tmp_path / "backups").exists()
        monkeypatch.setattr(runner, "ScriptDirectory", _FakeScripts)
        assert run_database_migrations(engine) is None, "已到 head 时没有可执行的升级"
        assert not (tmp_path / "backups").exists(), "空库（含 epoch 播种行）不应产生迁移前快照"
    finally:
        engine.dispose()


def test_migration_runner_snapshots_user_data_before_upgrade(tmp_path, monkeypatch):
    from app import database_migrations as runner

    engine = _empty_engine(tmp_path, "runner-snapshot.db")
    try:
        assert run_database_migrations(engine) is None
        with Session(engine) as session:
            session.add(Job(title="门店店长"))
            session.commit()
        monkeypatch.setattr(runner, "ScriptDirectory", _FakeScripts)
        backup = run_database_migrations(engine)
        assert backup is not None and backup.exists()
        assert backup.parent.name == "backups"
        backup_engine = create_engine(f"sqlite:///{backup.as_posix()}")
        try:
            with backup_engine.connect() as connection:
                titles = [row[0] for row in connection.execute(text("SELECT title FROM job"))]
        finally:
            backup_engine.dispose()
        assert titles == ["门店店长"]
    finally:
        engine.dispose()


def test_migration_runner_refuses_unversioned_database_with_tables(tmp_path):
    engine = _empty_engine(tmp_path, "runner-unversioned.db")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE education (id INTEGER PRIMARY KEY)")
        with pytest.raises(RuntimeError, match="启动闸门"):
            run_database_migrations(engine)
    finally:
        engine.dispose()

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
        return cls("future_head")

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


_TRACK_ROW_SQL = (
    "INSERT INTO application_track ("
    "id, company, title, company_key, title_key, status, stage_note, applied_at, status_date,"
    " next_action, next_action_date, note, evidence, resume_title, channel, source,"
    " created_at, updated_at"
    ") VALUES (?, '验收公司', ?, '验收公司', ?, 'applied', '',"
    " '2026-11-24', '2026-11-24', '', '', '', '', '', 'unknown', 'manual',"
    " '2026-11-24 10:00:00', '2026-11-24 10:00:00'"
    ")"
)
# 行数不是随意的：pysqlite 的 ``INSERT … SELECT`` 在行数少时会把语句走完、游标随之收尾，
# 只有够多行才会停在中途，那条读锁才留到紧随其后的 ``DROP TABLE`` 上。实测真库 12 行必红、
# 1 行必绿；这里取 20 行留余量，别为了"跑得快"往下调。
_REBUILD_ROWS = 20


def test_migration_runner_rebuilds_table_with_foreign_keys_enabled(tmp_path):
    """batch 重建 ``application_track``（0025）必须走通应用启动路径。

    2026-11-24 的真实故障：应用引擎在 connect 事件里打开 ``PRAGMA foreign_keys=ON``，
    而 ``batch_alter_table`` 的「建临时表 → INSERT … SELECT → DROP 原表」在这套 PRAGMA
    下会抛 ``database table is locked``——从 0024 升上来的用户启动即失败，新装用户
    （空表）毫无症状。

    **这条用例守的是修复后的三条不变量，不是那条锁本身**：合成库怎么造都复现不出锁
    （1 / 12 / 20 / 200 行、长文本、ANALYZE 都试过，全绿），只有真库副本会红。所以
    「改坏也红不了」在这里等于没有守卫价值，别把它当成锁的回归证明；锁的反证用真库副本
    做过，见 ``deliverables/.../evidence/T6/migration-lock-counter-proof.txt``
    （改前红 / 改后绿）。

    它仍能抓住的真回归：升级后**数据是否还在**、迁移期间临时关掉的外键是否**还原**、
    batch 失败时是否**留下临时表**——这三条都是本次改动直接带来的风险。
    """
    from alembic import command
    from app.database import build_engine
    from app.database_migrations import build_alembic_config

    database = tmp_path / "runner-rebuild.db"
    engine = build_engine(f"sqlite:///{database.as_posix()}")
    config = build_alembic_config(engine)
    try:
        # 先只升到 0024：0023 是 add_column，没有表重建，可以在 FK 打开时通过。
        with engine.connect() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "0024_remove_tracker_probe_settings")
        with engine.begin() as connection:
            for row_id in range(1, _REBUILD_ROWS + 1):
                title = f"验收岗位{row_id}"
                connection.exec_driver_sql(_TRACK_ROW_SQL, (row_id, title, title))

        run_database_migrations(engine)

        _assert_head_schema(engine)
        with engine.connect() as connection:
            companies = connection.exec_driver_sql("SELECT company FROM application_track").scalars()
            assert list(companies) == ["验收公司"] * _REBUILD_ROWS, "表重建必须保留全部数据"
            # 迁移期间临时关掉的外键检查必须还原：这条连接会回池里继续服务。
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
            leftovers = connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE name LIKE '%_alembic_tmp_%'"
            ).scalars()
            assert list(leftovers) == [], "失败的批量重建会留下临时表"
    finally:
        engine.dispose()

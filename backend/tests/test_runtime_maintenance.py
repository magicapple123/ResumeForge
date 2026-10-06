"""运行时加固的守卫：文件日志轮转与 SQLite 例行维护。"""

import logging
from pathlib import Path

import pytest
from sqlalchemy import text

from app import application
from app.application import _log_level, attach_file_log_handler
from app.database import build_engine, run_sqlite_maintenance


@pytest.fixture()
def file_logging(tmp_path: Path):
    handler = attach_file_log_handler(tmp_path)
    assert handler is not None
    yield tmp_path
    logging.getLogger().removeHandler(handler)
    handler.close()
    application._file_log_handler = None


def test_attach_file_log_handler_writes_records(file_logging: Path):
    logging.getLogger("resumeforge.test").info("维护日志写入 %s", "ok")
    for handler in logging.getLogger().handlers:
        handler.flush()
    log_file = file_logging / "backend.log"
    assert log_file.exists()
    content = log_file.read_text(encoding="utf-8")
    assert "维护日志写入 ok" in content
    # 根 handler 必须带 RequestIdFilter：脱离请求上下文时是占位符 "-"。
    assert "request_id=-" in content


def test_attach_file_log_handler_is_idempotent(tmp_path: Path):
    first = attach_file_log_handler(tmp_path)
    try:
        assert first is not None
        # 已挂过之后重复调用不再追加，避免测试里多次装配应用挂出一把 handlers。
        assert attach_file_log_handler(tmp_path) is None
    finally:
        if first is not None:
            logging.getLogger().removeHandler(first)
            first.close()
        application._file_log_handler = None


def test_log_level_falls_back_to_info():
    assert _log_level("debug") == logging.DEBUG
    assert _log_level("warning") == logging.WARNING
    assert _log_level("not-a-level") == logging.INFO


def test_run_sqlite_maintenance_truncates_wal(tmp_path: Path):
    db = tmp_path / "maintenance.db"
    engine = build_engine(f"sqlite:///{db.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("INSERT INTO probe (id) VALUES (1)")
        run_sqlite_maintenance(engine)
        wal = Path(str(db) + "-wal")
        assert not wal.exists() or wal.stat().st_size == 0
        # 维护只收缩日志文件，绝不能动业务数据。
        with engine.connect() as connection:
            assert connection.execute(text("SELECT COUNT(*) FROM probe")).scalar() == 1
    finally:
        engine.dispose()


def test_run_sqlite_maintenance_ignores_non_sqlite():
    # 非 SQLite 引擎直接返回：用鸭子类型替身避免为它引入额外驱动依赖。

    class _FakeEngine:
        class dialect:
            name = "postgresql"

        def connect(self):  # pragma: no cover - 不应被调用
            raise AssertionError("非 SQLite 引擎不应建立连接")

    run_sqlite_maintenance(_FakeEngine())  # 不抛即通过


def test_backup_snapshot_strips_optimizer_stat_tables(tmp_path: Path):
    """optimize/ANALYZE 落下的 sqlite_stat1 不能跟着备份走：旧版导入白名单会拒收。"""
    import sqlite3

    from app.database_migrations import backup_sqlite_database

    db = tmp_path / "with_stats.db"
    raw = sqlite3.connect(db)
    try:
        raw.execute("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        raw.execute("INSERT INTO probe (id) VALUES (1)")
        raw.execute("ANALYZE")
        raw.commit()
        assert raw.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='sqlite_stat1'"
        ).fetchone()[0] == 1
    finally:
        raw.close()

    engine = build_engine(f"sqlite:///{db.as_posix()}")
    try:
        snapshot = backup_sqlite_database(engine, output_dir=tmp_path / "snapshots")
        assert snapshot is not None
        check = sqlite3.connect(snapshot)
        try:
            tables = {
                row[0]
                for row in check.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            assert "sqlite_stat1" not in tables
            assert check.execute("SELECT COUNT(*) FROM probe").fetchone()[0] == 1
        finally:
            check.close()
    finally:
        engine.dispose()

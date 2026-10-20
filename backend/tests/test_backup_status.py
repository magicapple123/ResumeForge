# SPDX-License-Identifier: Apache-2.0
"""备份保护状态摘要（RF-05）：protected 判定、快照清单、失败原因透出。"""

from types import SimpleNamespace

from app.services.data_backup.status import backup_status


def _engine(tmp_path, name="resume_forge.db"):
    from app.database import build_engine

    db = tmp_path / name
    engine = build_engine(f"sqlite:///{db.as_posix()}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
    return engine


def _write_marker(engine, payload: dict) -> None:
    import json

    from app.services.data_backup.auto_backup import dataset_scope_directory

    directory = dataset_scope_directory(engine)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / ".last-run.json").write_text(json.dumps(payload), encoding="utf-8")


def test_unprotected_when_never_backed_up(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        status = backup_status(engine, now=1_000_000)
        assert status["protected"] is False
        assert status["last_success"] is None
        assert status["snapshot_count"] == 0
    finally:
        engine.dispose()


def test_protected_after_success_and_overdue_after_interval(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        _write_marker(
            engine,
            {
                "last_attempt": 1_000,
                "last_success": 1_000,
                "consecutive_failures": 0,
                "last_error": "",
            },
        )
        status = backup_status(engine, now=1_000 + 3600)
        assert status["protected"] is True
        assert status["overdue"] is False
        # 超过 7 天未成功：受保护但已到期。
        status = backup_status(engine, now=1_000 + 86400 * 8)
        assert status["protected"] is True
        assert status["overdue"] is True
    finally:
        engine.dispose()


def test_not_protected_while_failures_are_pending(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        _write_marker(
            engine,
            {
                "last_attempt": 5_000,
                "last_success": 1_000,
                "consecutive_failures": 2,
                "last_error": "备份失败",
            },
        )
        status = backup_status(engine, now=5_100)
        assert status["protected"] is False
        assert status["consecutive_failures"] == 2
        assert status["last_error"] == "备份失败"
    finally:
        engine.dispose()


def test_snapshot_listing_is_recency_ordered_and_capped(tmp_path, monkeypatch):
    import os

    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        from app.services.data_backup.auto_backup import dataset_scope_directory

        directory = dataset_scope_directory(engine)
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(13):
            item = directory / f"resume_forge-{index:02d}.db"
            item.write_bytes(b"x")
            os.utime(item, (1_000 + index, 1_000 + index))
        _write_marker(
            engine,
            {
                "last_attempt": 1_012,
                "last_success": 1_012,
                "consecutive_failures": 0,
                "last_error": "",
            },
        )
        status = backup_status(engine, now=2_000)
        assert status["snapshot_count"] == 13
        assert len(status["snapshots"]) == 10
        assert status["snapshots"][0]["name"] == "resume_forge-12.db"
        assert status["snapshots"][-1]["name"] == "resume_forge-03.db"
    finally:
        engine.dispose()


def test_interval_days_reads_the_runtime_setting(tmp_path):
    """状态卡的间隔展示与调度判定同一来源：KV 运行时值优先于环境配置。"""
    engine = _engine(tmp_path)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE app_setting (key VARCHAR(64) PRIMARY KEY, value TEXT)"
            )
            connection.exec_driver_sql(
                "INSERT INTO app_setting (key, value) VALUES ('auto_backup_interval_days', '30')"
            )
        status = backup_status(engine, now=1_000_000)
        assert status["interval_days"] == 30
    finally:
        engine.dispose()

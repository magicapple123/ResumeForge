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


def _write_snapshot(engine, name="resume_forge-20260101.db", mtime=None):
    """在当前数据集的备份目录里造一份快照文件（自动备份的产物形态）。"""
    import os

    from app.services.data_backup.auto_backup import dataset_scope_directory

    directory = dataset_scope_directory(engine)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(b"snapshot-bytes")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


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
        # 目录可读但没有快照 → empty（"确认没有"），不是 unreadable。
        assert status["snapshot_state"] == "empty"
    finally:
        engine.dispose()


def test_protected_after_success_and_overdue_after_interval(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        _write_snapshot(engine, mtime=1_000)
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
        assert status["snapshot_state"] == "ok"
        assert status["protected"] is True
        assert status["overdue"] is False
        # 超过 7 天未成功：受保护但已到期。
        status = backup_status(engine, now=1_000 + 86400 * 8)
        assert status["protected"] is True
        assert status["overdue"] is True
    finally:
        engine.dispose()


def test_path_replaced_by_a_regular_file_is_unreadable(tmp_path, monkeypatch):
    """快照目录被同名文件占住：必须报 unreadable，不能当成"确认没有快照"。

    `Path.glob` 在非目录上通常只是返回空（尤其 Windows），若只靠异常判定，
    这个形态会静默变成 `empty`，用户就会以为"从来没有备份过"。
    """
    from app.services.data_backup.auto_backup import dataset_scope_directory

    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        scope = dataset_scope_directory(engine)
        scope.parent.mkdir(parents=True, exist_ok=True)
        # 用同名文件占住"数据集备份目录"这个路径。
        scope.write_bytes(b"not-a-directory")
        status = backup_status(engine, now=1_000)
        assert status["snapshot_state"] == "unreadable"
        assert status["snapshot_count"] == 0
        assert status["protected"] is False
    finally:
        engine.dispose()


def test_moved_snapshot_loses_protection(tmp_path, monkeypatch):
    """成功 marker 还在但快照被移走：不能继续显示受保护（审计 F2/A02）。"""
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        snapshot = _write_snapshot(engine, mtime=1_000)
        _write_marker(
            engine,
            {
                "last_attempt": 1_000,
                "last_success": 1_000,
                "consecutive_failures": 0,
                "last_error": "",
            },
        )
        assert backup_status(engine, now=1_100)["protected"] is True

        # 用户/清理脚本把快照搬走（不是我们删的）：marker 不变，快照没了。
        snapshot.rename(tmp_path / "moved-away.db")
        status = backup_status(engine, now=1_100)
        assert status["last_success"] == 1_000  # 历史事实仍然保留
        assert status["snapshot_state"] == "empty"
        assert status["snapshot_count"] == 0
        assert status["protected"] is False
    finally:
        engine.dispose()


def test_unreadable_directory_is_not_reported_as_empty(tmp_path, monkeypatch):
    """目录读不了必须报 unreadable，不能静默当成"没有快照"（审计 F2/A02）。"""
    import pathlib

    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = _engine(tmp_path)
    try:
        _write_snapshot(engine, mtime=1_000)
        _write_marker(
            engine,
            {
                "last_attempt": 1_000,
                "last_success": 1_000,
                "consecutive_failures": 0,
                "last_error": "",
            },
        )

        def _denied(self, pattern):
            raise PermissionError(13, "Permission denied")

        monkeypatch.setattr(pathlib.Path, "glob", _denied)
        status = backup_status(engine, now=1_100)
        assert status["snapshot_state"] == "unreadable"
        assert status["snapshot_count"] == 0
        assert status["snapshots"] == []
        assert status["protected"] is False
    finally:
        engine.dispose()


def test_interval_zero_is_never_overdue(tmp_path, monkeypatch):
    """interval 读不到时回退 0——0 表示未启用/未配置，不能把任意历史成功判成到期。"""
    monkeypatch.setattr("app.services.data_backup.status.runtime_interval_days", lambda bind: 0)
    engine = _engine(tmp_path)
    try:
        _write_snapshot(engine, mtime=1_000)
        _write_marker(
            engine,
            {
                "last_attempt": 1_000,
                "last_success": 1_000,
                "consecutive_failures": 0,
                "last_error": "",
            },
        )
        status = backup_status(engine, now=1_000 + 86400 * 3650)
        assert status["interval_days"] == 0
        assert status["overdue"] is False
        assert status["protected"] is True
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

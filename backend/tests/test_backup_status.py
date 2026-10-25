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
    """interval 读不到时回退 0——0 表示未启用/未配置，不能把任意历史成功判成到期。

    A02 之后「受保护」还要求自动备份处于启用状态：本用例用 monkeypatch 明确部署配置为
    启用，避免依赖 conftest 的 AUTO_BACKUP_ENABLED=false（那是测试隔离，不是这个语义）。
    """
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7, auto_backup_enabled=True),
    )
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


# ===== A02：禁用自动备份与显式状态枚举 =====


def _enabled_settings(enabled: bool):
    return lambda: SimpleNamespace(auto_backup_interval_days=7, auto_backup_enabled=enabled)


def _healthy_marker() -> dict:
    return {
        "last_attempt": 1_000,
        "last_success": 1_000,
        "consecutive_failures": 0,
        "last_error": "",
    }


def test_auto_backup_disabled_is_explicit_and_clears_protected(tmp_path, monkeypatch):
    """部署配置关掉自动备份时：state=disabled、protected=false，历史 marker/快照保留。

    审计 A02 的核心：不能因为"以前成功过"就在自动备份已关闭时继续显示绿色"受保护"——
    那会让用户以为后台还在保护他。历史事实（last_success/快照清单）仍要如实给出，
    用户还得靠它们恢复。
    """
    monkeypatch.setattr("app.config.get_settings", _enabled_settings(False))
    engine = _engine(tmp_path)
    try:
        _write_snapshot(engine, mtime=1_000)
        _write_marker(engine, _healthy_marker())
        status = backup_status(engine, now=1_000 + 3600)
        assert status["auto_backup_enabled"] is False
        assert status["disabled"] is True
        assert status["state"] == "disabled"
        assert status["protected"] is False
        # 历史事实不被抹掉：marker 与快照仍然原样返回，恢复入口还靠它们。
        assert status["last_success"] == 1_000
        assert status["snapshot_state"] == "ok"
        assert status["snapshot_count"] == 1
    finally:
        engine.dispose()


def test_auto_backup_enabled_by_default_keeps_protected(tmp_path, monkeypatch):
    """既有环境（没有显式开关的旧配置对象）仍按启用处理，行为逐字不变。"""
    monkeypatch.setattr("app.config.get_settings", _enabled_settings(True))
    engine = _engine(tmp_path)
    try:
        _write_snapshot(engine, mtime=1_000)
        _write_marker(engine, _healthy_marker())
        status = backup_status(engine, now=1_000 + 3600)
        assert status["auto_backup_enabled"] is True
        assert status["disabled"] is False
        assert status["state"] == "protected"
        assert status["protected"] is True
    finally:
        engine.dispose()


def test_state_enum_covers_the_protection_situations(tmp_path, monkeypatch):
    """state 枚举覆盖 A02 要求的六种情形（从未/受保护/快照丢失/不可读/到期/失败）。"""
    monkeypatch.setattr("app.config.get_settings", _enabled_settings(True))
    engine = _engine(tmp_path)
    try:
        # 从未备份。
        assert backup_status(engine, now=1_000)["state"] == "never"

        # 有 marker 有快照 + 未到期 → protected。
        _write_snapshot(engine, mtime=1_000)
        _write_marker(engine, _healthy_marker())
        assert backup_status(engine, now=1_000 + 3600)["state"] == "protected"

        # 有 marker 有快照 + 超过间隔 → overdue。
        assert backup_status(engine, now=1_000 + 86400 * 8)["state"] == "overdue"
    finally:
        engine.dispose()


def test_state_reports_empty_when_snapshot_is_gone(tmp_path, monkeypatch):
    """marker 说成功过、但快照已经不在 → empty（不是 never，也不是 protected）。"""
    monkeypatch.setattr("app.config.get_settings", _enabled_settings(True))
    engine = _engine(tmp_path)
    try:
        _write_marker(engine, _healthy_marker())
        status = backup_status(engine, now=1_100)
        assert status["state"] == "empty"
        assert status["protected"] is False
    finally:
        engine.dispose()


def test_state_reports_failing_while_failures_are_pending(tmp_path, monkeypatch):
    """连续失败时 state=failing：失败原因要能被界面看见，不能显示成受保护。"""
    monkeypatch.setattr("app.config.get_settings", _enabled_settings(True))
    engine = _engine(tmp_path)
    try:
        marker = _healthy_marker()
        marker.update({"last_attempt": 5_000, "consecutive_failures": 2, "last_error": "备份失败"})
        _write_marker(engine, marker)
        status = backup_status(engine, now=5_100)
        assert status["state"] == "failing"
        assert status["protected"] is False
    finally:
        engine.dispose()


def test_state_reports_unreadable_directory(tmp_path, monkeypatch):
    """目录读不了时 state=unreadable：无法确认不等于"没有备份"。"""
    import pathlib

    monkeypatch.setattr("app.config.get_settings", _enabled_settings(True))
    engine = _engine(tmp_path)
    try:
        _write_snapshot(engine, mtime=1_000)
        _write_marker(engine, _healthy_marker())

        def _denied(self, pattern):
            raise PermissionError(13, "Permission denied")

        monkeypatch.setattr(pathlib.Path, "glob", _denied)
        status = backup_status(engine, now=1_100)
        assert status["state"] == "unreadable"
        assert status["protected"] is False
    finally:
        engine.dispose()


def test_protection_state_constants_match_the_response_schema():
    """state 常量与响应 schema 的 Literal 枚举逐项一致（防两处漂移）。"""
    from typing import get_args

    from app.schemas.backup_status import ProtectionState
    from app.services.data_backup.status import PROTECTION_STATES

    assert set(PROTECTION_STATES) == set(get_args(ProtectionState))


def test_api_backup_status_serializes_the_new_fields(client, monkeypatch):
    """HTTP 契约：GET /api/settings/backup-status 带上 A02 新字段（旧字段仍在）。"""
    monkeypatch.setattr("app.config.get_settings", _enabled_settings(False))
    response = client.get("/api/settings/backup-status")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["auto_backup_enabled"] is False
    assert payload["disabled"] is True
    assert payload["state"] == "disabled"
    assert payload["protected"] is False
    for legacy in ("last_success", "last_attempt", "snapshot_state", "snapshots", "coverage"):
        assert legacy in payload

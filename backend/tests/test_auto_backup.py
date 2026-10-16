"""自动备份的守卫（RF-05 新语义）：到期触发、失败短档退避、按数据集隔离、快照验证。"""

import json
import os
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.database import build_engine
from app.services.data_backup import auto_backup as auto_backup_module
from app.services.data_backup.auto_backup import (
    AUTO_BACKUP_DIRNAME,
    auto_backup_directory,
    dataset_scope_directory,
    failure_backoff_seconds,
    run_auto_backup_if_due,
)


def _settings(**overrides):
    base = {
        "auto_backup_enabled": True,
        "auto_backup_interval_days": 7,
        "auto_backup_keep": 3,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _engine_with_data(tmp_path: Path, name: str = "resume_forge.db"):
    db = tmp_path / name
    engine = build_engine(f"sqlite:///{db.as_posix()}")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO probe (id) VALUES (1)")
    return engine


def _marker(engine) -> dict:
    return json.loads(
        (dataset_scope_directory(engine) / ".last-run.json").read_text(encoding="utf-8")
    )


def test_first_run_creates_snapshot_and_marker(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        snapshot = run_auto_backup_if_due(engine, now=1_000_000, settings=_settings())
        assert snapshot is not None
        assert snapshot.parent == dataset_scope_directory(engine)
        assert snapshot.parent.parent.name == AUTO_BACKUP_DIRNAME
        check = sqlite3.connect(snapshot)
        try:
            assert check.execute("SELECT COUNT(*) FROM probe").fetchone()[0] == 1
        finally:
            check.close()
        marker = _marker(engine)
        assert marker["last_attempt"] == 1_000_000
        assert marker["last_success"] == 1_000_000
        assert marker["consecutive_failures"] == 0
    finally:
        engine.dispose()


def test_second_run_within_interval_is_skipped(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        assert run_auto_backup_if_due(engine, now=1_000_000, settings=_settings()) is not None
        directory = dataset_scope_directory(engine)
        before = sorted(p.name for p in directory.glob("*.db"))
        # 间隔（7 天）内再跑：不再产出快照。
        assert run_auto_backup_if_due(engine, now=1_000_000 + 3600, settings=_settings()) is None
        assert sorted(p.name for p in directory.glob("*.db")) == before
    finally:
        engine.dispose()


def test_due_run_rotates_to_keep_limit(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        directory = dataset_scope_directory(engine)
        directory.mkdir(parents=True, exist_ok=True)
        # 手工铺 5 份历史快照，修改时间从旧到新。
        for index in range(5):
            stale = directory / f"resume_forge-2026010{index}-000000.db"
            stale.write_bytes(b"old")
            os.utime(stale, (1_000 + index, 1_000 + index))
        assert run_auto_backup_if_due(engine, now=2_000_000, settings=_settings()) is not None
        remaining = sorted(p.name for p in directory.glob("*.db"))
        assert len(remaining) == 3
        # 最旧的两份被轮转删除，最新手工快照保留。
        assert not any("20260100" in name or "20260101" in name for name in remaining)
    finally:
        engine.dispose()


def test_rotation_never_touches_the_legacy_shared_directory(tmp_path: Path):
    """旧布局（auto-backups 根目录）里的历史快照只读不删（迁移期兼容）。"""
    engine = _engine_with_data(tmp_path)
    try:
        legacy = auto_backup_directory(engine)
        legacy.mkdir(parents=True, exist_ok=True)
        heritage = legacy / "resume_forge-legacy-000000.db"
        heritage.write_bytes(b"heritage")
        os.utime(heritage, (1, 1))
        first = run_auto_backup_if_due(engine, now=1_000_000, settings=_settings())
        assert first is not None
        # 旧布局快照不受新轮转影响。
        assert heritage.exists()
        # 连续备份多次触发轮转（keep=3），旧布局快照依然保留。
        for index in range(1, 4):
            os.utime(
                dataset_scope_directory(engine) / first.name,
                (1_000_000 + index, 1_000_000 + index),
            )
            marker = _marker(engine)
            marker["last_success"] = 1_000_000 + index * 86400 * 7
            (dataset_scope_directory(engine) / ".last-run.json").write_text(json.dumps(marker))
            assert (
                run_auto_backup_if_due(
                    engine, now=1_000_000 + (index + 1) * 86400 * 7, settings=_settings()
                )
                is not None
            )
        assert heritage.exists()
    finally:
        engine.dispose()


def test_disabled_setting_returns_none(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        assert (
            run_auto_backup_if_due(
                engine, now=1_000_000, settings=_settings(auto_backup_enabled=False)
            )
            is None
        )
        assert not auto_backup_directory(engine).exists()
    finally:
        engine.dispose()


def test_failure_retries_after_short_backoff_then_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """RF-05 核心语义：失败 1 小时后重试（不再等满一周），成功后节奏归位。"""

    state = {"ok": False}
    real_backup = auto_backup_module.backup_sqlite_database

    def _flaky(_bind, *, output_dir=None):
        if not state["ok"]:
            raise RuntimeError("boom")
        return real_backup(_bind, output_dir=output_dir)

    monkeypatch.setattr(auto_backup_module, "backup_sqlite_database", _flaky)
    engine = _engine_with_data(tmp_path)
    try:
        assert run_auto_backup_if_due(engine, now=1_000_000, settings=_settings()) is None
        marker = _marker(engine)
        assert marker["last_attempt"] == 1_000_000
        assert marker["last_success"] is None
        assert marker["consecutive_failures"] == 1
        assert marker["last_error"]
        # 1 小时内不重试（退避第 1 档 3600s）。
        assert run_auto_backup_if_due(engine, now=1_000_000 + 60, settings=_settings()) is None
        # 退避到期后重试；这次成功，节奏与计数归位。
        state["ok"] = True
        snapshot = run_auto_backup_if_due(engine, now=1_000_000 + 3600, settings=_settings())
        assert snapshot is not None
        marker = _marker(engine)
        assert marker["last_success"] == 1_000_000 + 3600
        assert marker["consecutive_failures"] == 0
        assert marker["last_error"] == ""
    finally:
        engine.dispose()


def test_failure_backoff_ladder_is_bounded():
    assert failure_backoff_seconds(1) == 3600
    assert failure_backoff_seconds(2) == 21600
    assert failure_backoff_seconds(3) == 86400
    assert failure_backoff_seconds(99) == 86400


def test_corrupt_snapshot_is_not_counted_and_keeps_old_snapshots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """损坏快照不计成功、不触发轮转、不淘汰有效旧快照。"""
    engine = _engine_with_data(tmp_path)
    try:
        good = run_auto_backup_if_due(engine, now=1_000_000, settings=_settings())
        assert good is not None

        def _garbage(_bind, *, output_dir=None):
            target = output_dir / "resume_forge-corrupt.db"
            target.write_bytes(b"this is not a database")
            return target

        monkeypatch.setattr(auto_backup_module, "backup_sqlite_database", _garbage)
        # 推到成功间隔之后，这次运行才会真的走到备份与校验。
        assert (
            run_auto_backup_if_due(engine, now=1_000_000 + 86400 * 7, settings=_settings()) is None
        )
        marker = _marker(engine)
        assert marker["consecutive_failures"] == 1
        # 有效旧快照还在，损坏文件已被清理。
        assert good.exists()
        assert not (dataset_scope_directory(engine) / "resume_forge-corrupt.db").exists()
    finally:
        engine.dispose()


def test_same_directory_datasets_keep_separate_markers_and_rotation(tmp_path: Path):
    """同目录 A/B 两个数据集：各保各的标记与份数（RF-05 隔离语义）。"""
    engine_a = _engine_with_data(tmp_path, "resume_forge.db")
    engine_b = _engine_with_data(tmp_path, "0123456789abcdef.db")
    try:
        assert run_auto_backup_if_due(engine_a, now=1_000_000, settings=_settings()) is not None
        # B 第一次跑：与 A 完全独立（没有共享标记把它挡住）。
        assert run_auto_backup_if_due(engine_b, now=1_000_000, settings=_settings()) is not None
        assert _marker(engine_a)["last_success"] == 1_000_000
        assert _marker(engine_b)["last_success"] == 1_000_000
        # A 到期再跑一次也不影响 B 的份数。
        assert run_auto_backup_if_due(engine_a, now=2_000_000, settings=_settings()) is not None
        assert len(list(dataset_scope_directory(engine_b).glob("*.db"))) == 1
    finally:
        engine_a.dispose()
        engine_b.dispose()


def test_snapshot_content_is_queryable_after_rotation(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        snapshot = run_auto_backup_if_due(engine, now=1_000_000, settings=_settings())
        assert snapshot is not None
        check = sqlite3.connect(snapshot)
        try:
            assert check.execute("SELECT MAX(id) FROM probe").fetchone()[0] == 1
        finally:
            check.close()
    finally:
        engine.dispose()


def test_runtime_interval_setting_overrides_env_default(tmp_path: Path):
    """设置页保存的间隔优先于环境配置：改成 1 天后第 2 天就应再次备份。

    读取失败（表缺失等）回退注入的 settings 默认——其余用例的引擎没有
    app_setting 表，本身就隐式钉住了这条回退路径。
    """
    engine = _engine_with_data(tmp_path)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE app_setting (key VARCHAR(64) PRIMARY KEY, value TEXT)"
            )
            connection.exec_driver_sql(
                "INSERT INTO app_setting (key, value) VALUES ('auto_backup_interval_days', '1')"
            )
        assert run_auto_backup_if_due(engine, now=1_000_000, settings=_settings()) is not None
        # 2 天 < 环境默认 7 天：按旧语义这里会跳过；动态值 1 天 → 到期再备份。
        assert (
            run_auto_backup_if_due(engine, now=1_000_000 + 2 * 86400, settings=_settings())
            is not None
        )
    finally:
        engine.dispose()

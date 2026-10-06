"""自动备份的守卫：到期触发、间隔节流、份数轮转、开关行为。"""

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


def test_first_run_creates_snapshot_and_marker(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        snapshot = run_auto_backup_if_due(engine, now=1_000_000, settings=_settings())
        assert snapshot is not None
        assert snapshot.parent.name == AUTO_BACKUP_DIRNAME
        check = sqlite3.connect(snapshot)
        try:
            assert check.execute("SELECT COUNT(*) FROM probe").fetchone()[0] == 1
        finally:
            check.close()
        marker = json.loads(
            (auto_backup_directory(engine) / ".last-run.json").read_text(encoding="utf-8")
        )
        assert marker["last_attempt"] == 1_000_000
        assert marker["last_success"] == 1_000_000
    finally:
        engine.dispose()


def test_second_run_within_interval_is_skipped(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        assert run_auto_backup_if_due(engine, now=1_000_000, settings=_settings()) is not None
        directory = auto_backup_directory(engine)
        before = sorted(p.name for p in directory.glob("*.db"))
        # 间隔（7 天）内再跑：不再产出快照。
        assert (
            run_auto_backup_if_due(engine, now=1_000_000 + 3600, settings=_settings()) is None
        )
        assert sorted(p.name for p in directory.glob("*.db")) == before
    finally:
        engine.dispose()


def test_due_run_rotates_to_keep_limit(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        directory = auto_backup_directory(engine)
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


def test_disabled_setting_returns_none(tmp_path: Path):
    engine = _engine_with_data(tmp_path)
    try:
        assert (
            run_auto_backup_if_due(engine, now=1_000_000, settings=_settings(auto_backup_enabled=False))
            is None
        )
        assert not auto_backup_directory(engine).exists()
    finally:
        engine.dispose()


def test_failed_marker_only_throttles_not_blocks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """备份失败也要写标记：连续失败时按间隔节流，而不是每次启动都撞同一个错。"""

    def _boom(_bind, *, output_dir=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(auto_backup_module, "backup_sqlite_database", _boom)
    engine = _engine_with_data(tmp_path)
    try:
        assert run_auto_backup_if_due(engine, now=1_000_000, settings=_settings()) is None
        marker = json.loads(
            (auto_backup_directory(engine) / ".last-run.json").read_text(encoding="utf-8")
        )
        assert marker["last_attempt"] == 1_000_000
        assert marker["last_success"] is None
        # 间隔内不再尝试。
        assert run_auto_backup_if_due(engine, now=1_000_000 + 60, settings=_settings()) is None
    finally:
        engine.dispose()


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

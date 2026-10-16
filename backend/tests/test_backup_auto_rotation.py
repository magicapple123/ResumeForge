"""备份的自动轮转、调度租约与恢复验证原语（自 PR-15/PR-18 的测试拆分）。

红→绿矩阵钉住的行为：

- 自动备份轮转淘汰的旧快照进可恢复的 ``.trash``，且只保留最近几份；
- 备份调度持真正的租约，与数据集切换互斥；
- 逐块 hash 与按清单复核 DB 行数的原语行为正确。
"""

import hashlib
from types import SimpleNamespace

from app.database import build_engine, database_url_for

# ---------------------------------------------------------------------------
# 自动备份：轮转走可恢复 .trash
# ---------------------------------------------------------------------------


def _auto_settings(**overrides):
    base = {
        "auto_backup_enabled": True,
        "auto_backup_interval_days": 7,
        "auto_backup_keep": 3,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_rotated_snapshots_move_to_recoverable_trash(tmp_path):
    """轮转淘汰的旧快照进 ``.trash``（可恢复），不再直接 unlink。"""
    import os

    from app.services.data_backup.auto_backup import dataset_scope_directory, run_auto_backup_if_due

    db = tmp_path / "resume_forge.db"
    engine = build_engine(f"sqlite:///{db.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        directory = dataset_scope_directory(engine)
        directory.mkdir(parents=True, exist_ok=True)
        stale = directory / "resume_forge-20260101-000000.db"
        stale.write_bytes(b"old")
        os.utime(stale, (1_000, 1_000))

        run_auto_backup_if_due(engine, now=2_000_000, settings=_auto_settings(auto_backup_keep=1))

        assert not stale.exists()
        trashed = directory / ".trash" / stale.name
        assert trashed.exists(), "被轮转的快照应出现在 .trash 里而不是被永久删除"
    finally:
        engine.dispose()


def test_trash_does_not_grow_without_bound(tmp_path):
    """``.trash`` 只保留最近几份，避免"可恢复"变成无限膨胀。"""
    from app.services.data_backup.auto_backup import (
        dataset_scope_directory,
        run_auto_backup_if_due,
    )

    db = tmp_path / "resume_forge.db"
    engine = build_engine(f"sqlite:///{db.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        directory = dataset_scope_directory(engine)
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(6):
            stale = directory / f"resume_forge-2026010{index}-000000.db"
            stale.write_bytes(b"old")
        run_auto_backup_if_due(engine, now=2_000_000, settings=_auto_settings(auto_backup_keep=1))

        trash_dir = directory / ".trash"
        remaining = list(trash_dir.glob("*.db")) if trash_dir.is_dir() else []
        assert len(remaining) <= 5
    finally:
        engine.dispose()


# ---------------------------------------------------------------------------
# 调度：与数据集切换互斥（真正的租约）
# ---------------------------------------------------------------------------


def test_backup_scheduling_is_excluded_during_dataset_switch(monkeypatch):
    """切换进行中（switch_lock 被持有 → acquire_lease 失败）：本轮备份直接跳过。"""
    from app.runtime.dataset_scope import DatasetScopeError
    from app.services.data_backup import scheduler as scheduler_module

    calls: list = []
    monkeypatch.setattr(scheduler_module, "get_settings", _auto_settings)
    monkeypatch.setattr(scheduler_module, "run_auto_backup_if_due", lambda bind: calls.append(bind))

    def _raise(owner):
        raise DatasetScopeError("数据集正在切换中，请稍后再启动该任务")

    monkeypatch.setattr("app.runtime.dataset_scope.acquire_lease", _raise)
    scheduler_module.run_for_current_dataset()
    assert calls == [], "切换期间不得执行自动备份"


def test_backup_run_holds_and_releases_the_lease(monkeypatch):
    """备份期间持租约（切换会等它），结束后归还。"""
    from app.services.data_backup import scheduler as scheduler_module

    released: list[bool] = []
    lease = SimpleNamespace(
        identity=SimpleNamespace(dataset_id="main", engine=object()),
        release=lambda: released.append(True),
    )
    monkeypatch.setattr(scheduler_module, "get_settings", _auto_settings)
    monkeypatch.setattr("app.runtime.dataset_scope.acquire_lease", lambda owner: lease)
    monkeypatch.setattr(scheduler_module, "run_auto_backup_if_due", lambda bind: None)

    scheduler_module.run_for_current_dataset()

    assert released == [True]


# ---------------------------------------------------------------------------
# 恢复验证原语
# ---------------------------------------------------------------------------


def test_file_digest_streams_and_matches_hashlib(tmp_path):
    """逐块 hash 与一次性 hashlib 结果一致（大文件不整读进内存）。"""
    from app.services.data_backup.asset_manifest import file_digest

    payload = b"x" * (1024 * 1024 + 123)
    path = tmp_path / "big.bin"
    path.write_bytes(payload)
    size, digest = file_digest(path)
    assert size == len(payload)
    assert digest == hashlib.sha256(payload).hexdigest()


def test_verify_database_rows_reports_mismatch(tmp_path):
    from app.services.data_backup.asset_manifest import verify_database_rows

    db = tmp_path / "probe.db"
    engine = build_engine(database_url_for(db))
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("INSERT INTO probe (id) VALUES (1)")
    finally:
        engine.dispose()

    assert verify_database_rows(db, {"probe": 1}) == []
    issues = verify_database_rows(db, {"probe": 2, "missing_table": 0})
    assert any("probe" in issue for issue in issues)
    assert any("missing_table" in issue for issue in issues)

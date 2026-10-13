"""自动备份调度线程（RF-05）：启动即查、周期唤醒、切换唤醒、干净退出。"""

import threading
from types import SimpleNamespace

from app.services.data_backup import scheduler as scheduler_module
from app.services.data_backup.scheduler import AutoBackupScheduler


def test_scheduler_runs_an_immediate_check_when_triggered(monkeypatch):
    calls: list[int] = []
    done = threading.Event()

    def _fake_check():
        calls.append(1)
        done.set()

    monkeypatch.setattr(scheduler_module, "run_for_current_dataset", _fake_check)
    sched = AutoBackupScheduler(check_seconds=60)
    sched.start()
    try:
        sched.trigger_check()
        assert done.wait(timeout=5), "trigger_check 后应立即执行一次到期检查"
        assert calls == [1]
    finally:
        sched.stop()
    assert not sched._thread.is_alive()


def test_scheduler_wakes_periodically(monkeypatch):
    calls: list[int] = []
    twice = threading.Event()

    def _fake_check():
        calls.append(1)
        if len(calls) >= 2:
            twice.set()

    monkeypatch.setattr(scheduler_module, "run_for_current_dataset", _fake_check)
    sched = AutoBackupScheduler(check_seconds=1)
    sched.start()
    try:
        sched.trigger_check()
        assert twice.wait(timeout=10), "check_seconds=1 时两轮检查应很快发生"
    finally:
        sched.stop()


def test_scheduler_check_binds_the_current_dataset_identity(monkeypatch):
    """每轮检查取的是"当前"身份的引擎，不是启动时的旧引用；租约是真正的逻辑租约。"""
    from types import SimpleNamespace as NS

    seen: list[object] = []
    engine = object()
    identity = SimpleNamespace(dataset_id="main", engine=engine)
    released: list[bool] = []
    lease = NS(identity=identity, release=lambda: released.append(True))

    monkeypatch.setattr("app.runtime.dataset_scope.current_identity", lambda: identity)
    monkeypatch.setattr("app.runtime.dataset_scope.acquire_lease", lambda owner: lease)
    monkeypatch.setattr(scheduler_module, "run_auto_backup_if_due", lambda bind: seen.append(bind))
    scheduler_module.run_for_current_dataset()
    assert seen == [engine]
    assert released == [True], "检查结束后必须归还租约"


def test_scheduler_skips_the_round_when_a_switch_is_in_progress(monkeypatch):
    """切换进行中（acquire_lease 失败）：本轮备份跳过，绝不在换库窗口里拍快照。"""
    from app.runtime.dataset_scope import DatasetScopeError

    seen: list[object] = []

    def _raise(owner):
        raise DatasetScopeError("数据集正在切换中，请稍后再启动该任务")

    monkeypatch.setattr("app.runtime.dataset_scope.acquire_lease", _raise)
    monkeypatch.setattr(scheduler_module, "run_auto_backup_if_due", lambda bind: seen.append(bind))
    scheduler_module.run_for_current_dataset()
    assert seen == []


def test_scheduler_stop_is_idempotent(monkeypatch):
    monkeypatch.setattr(scheduler_module, "run_for_current_dataset", lambda: None)
    sched = AutoBackupScheduler(check_seconds=60)
    sched.start()
    sched.stop()
    sched.stop()
    assert sched._thread is not None

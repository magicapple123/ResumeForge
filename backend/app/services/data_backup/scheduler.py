"""自动备份的低频后台调度（RF-05）。

旧实现只在启动时跑一次备份检查：应用长期不重启就永远不会再查"是否到期"，
失败后也没有重试机会。这里补一个常驻守护线程：每 ``check_seconds`` 醒一次，
对**当前**数据集做一次到期检查；数据集切换后由 ``datasets.activate_dataset``
调 ``trigger_check`` 立即唤醒一次（新数据集的备份节奏独立计算）。

线程不绑定启动时的引擎——每轮通过 ``dataset_scope.acquire_lease("auto-backup")``
取**真正的逻辑租约**再按租约身份跑（PR-15 审计项：此前只抓 identity、没取租约，
切换/删除/恢复的并发全靠巧合）。切换持锁期间 ``acquire_lease`` 直接失败，本轮
备份跳过；备份进行中持租约，切换的排空阶段会等到它归还——两个方向都互斥。
"""

from __future__ import annotations

import logging
import threading

from ...config import get_settings
from .auto_backup import run_auto_backup_if_due

logger = logging.getLogger(__name__)


def run_for_current_dataset() -> None:
    """对当前活动数据集做一次到期检查（异常只记日志）。

    先取租约再干活：取不到（数据集正在切换/恢复）就整轮跳过；取到了就用**租约
    发布时刻**的引擎快照，配合 ``bound_context`` 让这轮日志带上 dataset_id。
    """
    from ...runtime import dataset_scope  # 函数级导入避免模块加载期依赖 runtime 初始化
    from ...runtime.log_context import bound_context

    try:
        # Disabled scheduling must not briefly hold a dataset lease: even a no-op
        # snapshot check can race with a caller that is switching datasets.
        if not get_settings().auto_backup_enabled:
            return
        try:
            lease = dataset_scope.acquire_lease("auto-backup")
        except dataset_scope.DatasetScopeError:
            logger.info("数据集正在切换中，本轮自动备份跳过")
            return
        try:
            identity = lease.identity
            # RF-20：调度线程常驻、不绑死单个数据集，每轮按租约身份绑定日志关联值
            # （task_id 对备份无意义，保持 "-"）。
            with bound_context(dataset_id=getattr(identity, "dataset_id", "-")):
                run_auto_backup_if_due(identity.engine)
        finally:
            lease.release()
    except Exception:  # noqa: BLE001 - 调度线程绝不能把服务拖垮
        logger.warning("自动备份调度检查失败", exc_info=True)


class AutoBackupScheduler:
    """低频到期检查线程：``wait`` 可被 trigger_check 提前唤醒。"""

    def __init__(self, check_seconds: float) -> None:
        self._check_seconds = max(1.0, check_seconds)
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="resumeforge-auto-backup-scheduler", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def trigger_check(self) -> None:
        """数据集切换后立即触发一次到期检查（非阻塞）。"""
        self._wake.set()

    def _loop(self) -> None:
        logger.info("自动备份调度启动（间隔 %.0fs）", self._check_seconds)
        while not self._stop.is_set():
            self._wake.wait(timeout=self._check_seconds)
            if self._stop.is_set():
                break
            self._wake.clear()
            run_for_current_dataset()
        logger.info("自动备份调度退出")


_scheduler: AutoBackupScheduler | None = None
_scheduler_lock = threading.Lock()


def start_scheduler(check_seconds: float) -> AutoBackupScheduler:
    """启动（或复用）全局调度线程；重复调用安全。"""
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            _scheduler = AutoBackupScheduler(check_seconds)
        _scheduler.start()
        return _scheduler


def get_scheduler() -> AutoBackupScheduler | None:
    return _scheduler


def trigger_check() -> None:
    """切换数据集后的唤醒入口；调度未启动时静默跳过。"""
    scheduler = get_scheduler()
    if scheduler is not None:
        scheduler.trigger_check()


def shutdown_scheduler() -> None:
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None:
            _scheduler.stop()
            _scheduler = None


__all__ = [
    "AutoBackupScheduler",
    "get_scheduler",
    "run_for_current_dataset",
    "shutdown_scheduler",
    "start_scheduler",
    "trigger_check",
]

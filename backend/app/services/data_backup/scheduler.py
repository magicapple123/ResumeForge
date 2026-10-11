"""自动备份的低频后台调度（RF-05）。

旧实现只在启动时跑一次备份检查：应用长期不重启就永远不会再查"是否到期"，
失败后也没有重试机会。这里补一个常驻守护线程：每 ``check_seconds`` 醒一次，
对**当前**数据集做一次到期检查；数据集切换后由 ``datasets.activate_dataset``
调 ``trigger_check`` 立即唤醒一次（新数据集的备份节奏独立计算）。

线程不绑定启动时的引擎——每轮通过 ``dataset_scope.current_identity()`` 取当前
身份，切换数据集后自动跟着新库走；切换窗口内由 dataset_scope 的租约/互斥兜底。
"""
from __future__ import annotations

import logging
import threading

from .auto_backup import run_auto_backup_if_due

logger = logging.getLogger(__name__)


def run_for_current_dataset() -> None:
    """对当前活动数据集做一次到期检查（异常只记日志）。"""
    from ...runtime import dataset_scope  # 函数级导入避免模块加载期依赖 runtime 初始化
    from ...runtime.log_context import bound_context

    try:
        identity = dataset_scope.current_identity()
        # RF-20：调度线程常驻、不绑死单个数据集，每轮按当前身份绑定日志关联值，
        # 让这一轮备份的日志行带上 dataset_id（task_id 对备份无意义，保持 "-"）。
        # getattr 兜底：日志绑定是辅助，身份对象缺字段时也不能影响备份本身。
        with bound_context(dataset_id=getattr(identity, "dataset_id", "-")):
            run_auto_backup_if_due(identity.engine)
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

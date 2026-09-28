"""表单快照的进程内暂存。

## 为什么要暂存

用户看到的是"预览 → 核对 → 填充"三步。**填充必须严格用他确认过的那份快照**——
中间若重新读一次页面，用户确认的映射就可能与落地的不一致（页面在联动、别的标签页
改了状态、或者干脆是另一个标签页），而这种不一致**用户看不见**。

## 为什么不落库

``ApplyTask`` 那套状态机（表 + 后台线程 + 轮询 + 熔断）存在的理由是"几十分钟的无人值守
批处理，要能在后端重启后仍然解释得清"。网申填充是**用户盯着浏览器窗口的十秒级动作**，
引入任务表要连带 ``TASK_KINDS``、助手覆盖表、回收站登记与轮询界面一整套成本，收益为零。

所以放内存：进程重启就失效，这正是"重来一次"该有的语义。
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

from ._base import WebFormNotFound
from .engine import Control

# 快照存活时间：够用户核对完一张长表单，又不至于把过期页面留在内存里。
SNAPSHOT_TTL_SECONDS = 900.0
# 同时保留的快照上限（多个标签页 / 反复读取时不会无限增长）。
MAX_SNAPSHOTS = 20


@dataclass
class Snapshot:
    """一次"读取表单"的产物。"""

    id: str
    controls: list[Control]
    url: str = ""
    title: str = ""
    created_at: float = field(default_factory=time.monotonic)

    def is_expired(self, *, now: float | None = None) -> bool:
        return (now if now is not None else time.monotonic()) - self.created_at > SNAPSHOT_TTL_SECONDS


class SnapshotStore:
    """带 TTL 与上限的快照仓（线程安全）。"""

    def __init__(self) -> None:
        self._items: dict[str, Snapshot] = {}
        self._lock = threading.Lock()

    def save(self, controls: list[Control], *, url: str = "", title: str = "") -> Snapshot:
        snapshot = Snapshot(id=uuid.uuid4().hex, controls=list(controls), url=url, title=title)
        with self._lock:
            self._evict_locked()
            self._items[snapshot.id] = snapshot
            while len(self._items) > MAX_SNAPSHOTS:
                oldest = min(self._items.values(), key=lambda item: item.created_at)
                self._items.pop(oldest.id, None)
        return snapshot

    def get(self, snapshot_id: str) -> Snapshot:
        with self._lock:
            self._evict_locked()
            snapshot = self._items.get(snapshot_id)
        if snapshot is None:
            raise WebFormNotFound("这次读取的表单已经过期，请重新点「读取当前表单」")
        return snapshot

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def _evict_locked(self) -> None:
        now = time.monotonic()
        expired = [key for key, item in self._items.items() if item.is_expired(now=now)]
        for key in expired:
            self._items.pop(key, None)


_store = SnapshotStore()


def get_snapshot_store() -> SnapshotStore:
    return _store


__all__ = [
    "MAX_SNAPSHOTS",
    "SNAPSHOT_TTL_SECONDS",
    "Snapshot",
    "SnapshotStore",
    "get_snapshot_store",
]

# SPDX-License-Identifier: Apache-2.0
"""失败的出站请求（T04）：诊断包里"最近 50 条失败"的来源。

为什么只记失败、且只记 host + 分类 + 耗时：

- 成功请求没有排障价值，记了只会把诊断包撑大、把真正的失败挤出去；
- **不记路径与正文**：路径里常带查询参数（`?token=`、`?email=`），正文可能含简历内容。
  诊断包会被用户直接转发给陌生支持者，这两类都不能出现。

环形缓冲在进程内，导出诊断时快照一次；不落盘、不跨重启——重启后的失败另有后端日志。
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

#: 保留条数。50 条足够覆盖"最近一次失败尝试"的上下文，又不会让诊断包变重。
MAX_FAILURES = 50

_lock = threading.Lock()
_failures: deque[dict[str, Any]] = deque(maxlen=MAX_FAILURES)


def record_failure(host: str, kind: str, *, elapsed_ms: float | None = None) -> None:
    """记一条失败（``host`` 只留主机名，不带路径/查询串）。"""
    entry: dict[str, Any] = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "host": (host or "").split("/", 1)[0][:120],
        "kind": kind,
    }
    if elapsed_ms is not None:
        entry["elapsed_ms"] = int(elapsed_ms)
    with _lock:
        _failures.append(entry)


def recent_failures() -> list[dict[str, Any]]:
    """最近的失败（旧 → 新）。"""
    with _lock:
        return [dict(item) for item in _failures]


def clear() -> None:
    """清空（测试用）。"""
    with _lock:
        _failures.clear()


__all__ = ["MAX_FAILURES", "clear", "recent_failures", "record_failure"]

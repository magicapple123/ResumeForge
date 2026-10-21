# SPDX-License-Identifier: Apache-2.0
"""备份保护状态的 UI 摘要（RF-05）：让用户看到"是否被保护"，而不只是"试过"。

只读聚合：当前数据集备份目录里的标记 + 快照清单。不含任何恢复/删除动作；
诊断口径只带安全摘要（文件名、大小、时间、失败原因文本），不打包快照内容。
"""

from __future__ import annotations

import logging
import time
from typing import Any

from sqlalchemy import Engine

from .auto_backup import (
    _marker_path,
    _read_marker,
    dataset_scope_directory,
    runtime_interval_days,
)

logger = logging.getLogger(__name__)


def backup_status(bind: Engine, *, now: float | None = None) -> dict[str, Any]:
    """当前数据集的备份保护摘要（给设置页"数据与备份"卡片）。"""
    current = time.time() if now is None else now
    directory = dataset_scope_directory(bind)
    snapshots: list[dict[str, Any]] = []
    try:
        for item in sorted(directory.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
            stat = item.stat()
            snapshots.append(
                {
                    "name": item.name,
                    "size_bytes": stat.st_size,
                    "modified_at": stat.st_mtime,
                }
            )
    except OSError:
        logger.warning("备份状态读取失败 dir=%s", directory, exc_info=True)

    marker = _read_marker(_marker_path(bind))
    last_success = marker.get("last_success")
    failures = int(marker.get("consecutive_failures", 0) or 0)
    try:
        # 与调度判定同一来源：用户保存的运行时值优先，读不到回退环境配置。
        interval_days = runtime_interval_days(bind)
    except Exception:  # noqa: BLE001 - 状态展示不应因配置读取失败而抛
        interval_days = 0
    protected = bool(last_success) and failures == 0
    return {
        "dataset_id": getattr(bind, "dataset_id", "") or "",
        "protected": protected,
        # 边界要写在数据里，不能只靠文案：自动备份是**仅数据库**的快照，附件与字体
        # 不在其中。界面读到这个值才敢说"需要完整备份请手动导出"。
        "coverage": "database_only",
        "last_success": last_success,
        "last_attempt": marker.get("last_attempt"),
        "consecutive_failures": failures,
        "last_error": str(marker.get("last_error") or ""),
        "interval_days": interval_days,
        "overdue": bool(last_success) and (current - float(last_success)) > interval_days * 86400,
        "snapshot_count": len(snapshots),
        "snapshots": snapshots[:10],
    }


__all__ = ["backup_status"]

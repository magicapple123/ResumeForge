# SPDX-License-Identifier: Apache-2.0
"""备份保护状态的 UI 摘要（RF-05）：让用户看到"是否被保护"，而不只是"试过"。

只读聚合：当前数据集备份目录里的标记 + 快照清单。不含任何恢复/删除动作；
诊断口径只带安全摘要（文件名、大小、时间、失败原因文本），不打包快照内容。
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .auto_backup import (
    _marker_path,
    _read_marker,
    dataset_scope_directory,
    runtime_interval_days,
)

logger = logging.getLogger(__name__)

# 快照目录的三种可判定状态（审计 F2/A02）。旧字段全部保留，这里只新增判定维度：
# `snapshot_count == 0` 过去既表示"没备份过"，也表示"目录读不了"，两者被 UI 混成
# 一片"暂无快照"，于是"历史成功过但快照已被移走"也会显示成受保护。
SNAPSHOT_STATE_OK = "ok"
SNAPSHOT_STATE_EMPTY = "empty"
SNAPSHOT_STATE_UNREADABLE = "unreadable"


def _collect_snapshots(directory: Path) -> tuple[list[dict[str, Any]], str]:
    """读取快照清单，并给出目录状态（``ok`` / ``empty`` / ``unreadable``）。

    ``unreadable`` 与 ``empty`` 必须分开：前者是"无法确认"，后者是"确认没有"。
    读取失败时只记日志并返回空清单——不删除、不移动任何快照，也不改 marker。
    """
    snapshots: list[dict[str, Any]] = []
    try:
        # 路径被一个同名文件占住时，`glob` 在许多平台上只是"没匹配到"（Windows 的
        # Path.glob 对非目录返回空），会被误读成"确认没有快照"。这不是空目录，是
        # **无法确认**——先判类型，再 glob。
        if directory.exists() and not directory.is_dir():
            logger.warning("备份快照路径不是目录（无法确认）path=%s", directory)
            return [], SNAPSHOT_STATE_UNREADABLE
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
        logger.warning(
            "备份快照目录读取失败（无法确认快照是否存在）dir=%s", directory, exc_info=True
        )
        return [], SNAPSHOT_STATE_UNREADABLE
    return snapshots, (SNAPSHOT_STATE_OK if snapshots else SNAPSHOT_STATE_EMPTY)


def _is_overdue(last_success: Any, interval_days: int, current: float) -> bool:
    """超过间隔未再成功。``interval_days <= 0`` 表示未启用/未配置，一律不算到期。

    0 是"读不到运行时设置"的回退值，若照旧参与判定，任何一次历史成功都会立刻变成
    overdue——那不是"到期"，那是配置缺失。
    """
    if not last_success or interval_days <= 0:
        return False
    try:
        succeeded_at = float(last_success)
    except (TypeError, ValueError):
        return False
    return current - succeeded_at > interval_days * 86400


def backup_status(bind: Engine, *, now: float | None = None) -> dict[str, Any]:
    """当前数据集的备份保护摘要（给设置页"数据与备份"卡片）。"""
    current = time.time() if now is None else now
    directory = dataset_scope_directory(bind)
    snapshots, snapshot_state = _collect_snapshots(directory)

    marker = _read_marker(_marker_path(bind))
    last_success = marker.get("last_success")
    failures = int(marker.get("consecutive_failures", 0) or 0)
    try:
        # 与调度判定同一来源：用户保存的运行时值优先，读不到回退环境配置。
        interval_days = runtime_interval_days(bind)
    except Exception:  # noqa: BLE001 - 状态展示不应因配置读取失败而抛
        interval_days = 0
    # 收紧后的「受保护」：有成功记录 + 当前没有连续失败 + **当前目录里确实有快照**。
    # 只有 last_success 而没有快照（被移走/被清理/目录读不了）不得算受保护。
    protected = bool(last_success) and failures == 0 and snapshot_state == SNAPSHOT_STATE_OK
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
        "overdue": _is_overdue(last_success, interval_days, current),
        # 供 UI 区分"没备份过"(empty)、"确有一份可用快照"(ok) 与"读不了目录"(unreadable)。
        "snapshot_state": snapshot_state,
        "snapshot_count": len(snapshots),
        "snapshots": snapshots[:10],
    }


__all__ = ["backup_status"]

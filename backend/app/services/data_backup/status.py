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

# 保护状态的单一枚举（A02 审计要求"显式禁用态"）：界面按 state 读主文案，不再自己
# 从 protected/overdue/snapshot_state 三个布尔值反推。旧字段全部保留——旧客户端读旧布尔，
# 新客户端读 state，两者不冲突，也不改变任何既有语义。
PROTECTION_STATE_PROTECTED = "protected"
PROTECTION_STATE_OVERDUE = "overdue"
PROTECTION_STATE_NEVER = "never"
PROTECTION_STATE_EMPTY = "empty"
PROTECTION_STATE_UNREADABLE = "unreadable"
PROTECTION_STATE_FAILING = "failing"
PROTECTION_STATE_DISABLED = "disabled"

PROTECTION_STATES: tuple[str, ...] = (
    PROTECTION_STATE_PROTECTED,
    PROTECTION_STATE_OVERDUE,
    PROTECTION_STATE_NEVER,
    PROTECTION_STATE_EMPTY,
    PROTECTION_STATE_UNREADABLE,
    PROTECTION_STATE_FAILING,
    PROTECTION_STATE_DISABLED,
)


def _auto_backup_enabled() -> bool:
    """自动备份的真实开关：来自部署配置 Settings.auto_backup_enabled。

    **没有 UI 开关**（设置页只能调间隔）：这个值由部署配置决定，界面必须如实标注
    "由部署配置控制"，不能给一个改了不生效的开关。配置读取失败时按"启用"处理——
    与 auto_backup.run_auto_backup_if_due 的缺省一致，不让状态接口因为一次读配置
    失败，把"受保护"误报成"已禁用"。
    """
    try:
        # 调用期从 app.config 取（而不是模块级具名导入）：这是可注入的边界，
        # 测试用 monkeypatch 替换 app.config.get_settings 即可模拟部署配置。
        from ...config import get_settings

        return bool(getattr(get_settings(), "auto_backup_enabled", True))
    except Exception:  # noqa: BLE001 - 状态展示不应因配置读取失败而抛
        logger.warning("读取自动备份开关失败，按启用处理", exc_info=True)
        return True


def _protection_state(
    *,
    enabled: bool,
    protected: bool,
    overdue: bool,
    last_success: Any,
    failures: int,
    snapshot_state: str,
) -> str:
    """把若干事实收敛成一个可展示的状态（优先级：禁用 > 无法确认 > 失败 > 到期 > ...）。

    "disabled" 必须压过一切：用户先要知道"自动备份根本没开"，再去关心历史快照
    还在不在；把历史快照的"受保护"顶在最前面会让人以为后台还在继续备份。
    """
    if not enabled:
        return PROTECTION_STATE_DISABLED
    if snapshot_state == SNAPSHOT_STATE_UNREADABLE:
        return PROTECTION_STATE_UNREADABLE
    if failures > 0:
        return PROTECTION_STATE_FAILING
    if protected and overdue:
        return PROTECTION_STATE_OVERDUE
    if protected:
        return PROTECTION_STATE_PROTECTED
    if last_success:
        # marker 说成功过，但当前目录里没有可用快照（被移走/清理/替换）。
        return PROTECTION_STATE_EMPTY
    return PROTECTION_STATE_NEVER


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
    enabled = _auto_backup_enabled()
    overdue = _is_overdue(last_success, interval_days, current)
    # 收紧后的「受保护」：**自动备份处于启用状态** + 有成功记录 + 当前没有连续失败 +
    # 当前目录里确实有快照。只有 last_success 而没有快照（被移走/被清理/目录读不了）
    # 不得算受保护；自动备份被部署配置关掉时同样不算"当前受保护"——历史快照仍能用来
    # 恢复，但"后台还会继续保护你"这句话已经不成立（A02 审计要求显式禁用态）。
    protected = (
        enabled
        and bool(last_success)
        and failures == 0
        and snapshot_state == SNAPSHOT_STATE_OK
    )
    state = _protection_state(
        enabled=enabled,
        protected=protected,
        overdue=overdue,
        last_success=last_success,
        failures=failures,
        snapshot_state=snapshot_state,
    )
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
        "overdue": overdue,
        # 供 UI 区分"没备份过"(empty)、"确有一份可用快照"(ok) 与"读不了目录"(unreadable)。
        "snapshot_state": snapshot_state,
        "snapshot_count": len(snapshots),
        "snapshots": snapshots[:10],
        # A02：自动备份的真实开关来自部署配置（无 UI 开关）。disabled 是 enabled 的反面，
        # 单独给一个布尔是为了旧客户端不必自己取反；state 是给新 UI 的单一枚举
        # （disabled 时优先于其它一切状态）。
        "auto_backup_enabled": enabled,
        "disabled": not enabled,
        "state": state,
    }


__all__ = ["backup_status"]

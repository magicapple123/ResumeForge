"""自动备份：按间隔滚动保留最近 N 份数据库快照。

用户数据只有 SQLite 一处（见包 docstring），而"记得手动备份"是最不可靠的一环：
这里在应用启动后于后台线程检查"距上次自动备份是否已到间隔"，到期就用与手动
导出一致的 ``backup_sqlite_database`` 快照一份，并按份数轮转删除最旧的。

设计要点：

- **绝不抛异常**：自动备份是保险，失败只记日志，下次启动按标记重试；
- 标记文件记录的是"上次尝试"而不是"上次成功"：连续失败时同样按间隔节流，
  避免每次启动都撞同一个错误；
- 与手动导出互不影响：快照落在数据库同级的 ``auto-backups/`` 目录，不进
  ``exports/`` 与 ``restore/``，启动清理（``cleanup_temp_directories``）不会碰它。
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from ...config import Settings, get_settings
from ...database_migrations import backup_sqlite_database
from .paths import database_path

logger = logging.getLogger(__name__)

AUTO_BACKUP_DIRNAME = "auto-backups"
_MARKER_FILENAME = ".last-run.json"


def auto_backup_directory(bind: Engine) -> Path:
    """自动备份快照的根目录：与手动导出、恢复暂存目录互不重叠。"""
    return database_path(bind).parent / AUTO_BACKUP_DIRNAME


def _marker_path(bind: Engine) -> Path:
    return auto_backup_directory(bind) / _MARKER_FILENAME


def _read_marker(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_marker(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        # 标记写不进去只意味着下次启动会再做一次备份，不值得为它打断谁。
        logger.warning("自动备份标记写入失败 path=%s", path, exc_info=True)


def _rotate(directory: Path, keep: int) -> None:
    """按修改时间只保留最新 ``keep`` 份快照；失败不抛（下次启动还会再轮转）。"""
    try:
        snapshots = sorted(
            (item for item in directory.glob("*.db") if item.is_file()),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        logger.warning("自动备份轮转失败：目录不可读 dir=%s", directory, exc_info=True)
        return
    for stale in snapshots[max(0, keep):]:
        try:
            stale.unlink()
            logger.info("自动备份轮转删除最旧快照 path=%s", stale)
        except OSError:
            logger.warning("自动备份轮转删除失败 path=%s", stale, exc_info=True)


def run_auto_backup_if_due(
    bind: Engine,
    *,
    now: float | None = None,
    settings: Settings | None = None,
) -> Path | None:
    """距上次自动备份已到间隔时快照一份并轮转；否则返回 None。

    ``settings`` 仅供测试注入；生产路径一律读全局配置。任何失败都只记日志——
    调用方（启动后台线程）不指望它有返回值，更不该让它把启动拖垮。
    """
    config = settings or get_settings()
    if not config.auto_backup_enabled:
        return None
    current = time.time() if now is None else now
    try:
        directory = auto_backup_directory(bind)
        directory.mkdir(parents=True, exist_ok=True)
    except Exception:  # noqa: BLE001 - 内存库/不可写目录都只是"备份不了"，不是故障
        logger.warning("自动备份目录不可用，本轮跳过", exc_info=True)
        return None

    marker = _read_marker(_marker_path(bind))
    interval_seconds = max(1, config.auto_backup_interval_days) * 86400
    if current - float(marker.get("last_attempt", 0)) < interval_seconds:
        return None

    try:
        snapshot = backup_sqlite_database(bind, output_dir=directory)
    except Exception:  # noqa: BLE001 - 自动备份绝不打断启动
        logger.warning("自动备份失败", exc_info=True)
        snapshot = None

    _write_marker(
        _marker_path(bind),
        {
            "last_attempt": current,
            "last_success": current if snapshot is not None else marker.get("last_success"),
        },
    )
    if snapshot is None:
        return None
    _rotate(directory, max(1, config.auto_backup_keep))
    logger.info("自动备份完成 path=%s", snapshot)
    return snapshot


__all__ = ["AUTO_BACKUP_DIRNAME", "auto_backup_directory", "run_auto_backup_if_due"]

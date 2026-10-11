"""手动备份（``backups/`` 目录）的可见与可恢复清理（RF-25）。

``backups/`` 是迁移前自动快照与手工备份的去处（``database_migrations.
backup_sqlite_database`` 的默认目录），此前没有任何界面也没有清理——几十份快照
会无声地吃掉几个 GB。这里提供两件事：

- **列表**：文件名 / 体积 / 修改时间，只 stat 不读内容；
- **可恢复删除**：移动到 ``backups/.trash/``，**绝不直接 unlink**。没有自动清理、
  没有"全部删除"——每一份都要用户逐份确认；``.trash`` 里的文件由用户自己在文件
  管理器里决定去留（与业务数据回收站同一个"先可恢复，再谈永久"的取舍）。
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from pathlib import Path

from sqlalchemy import Engine

from ..storage_stats import BACKUP_TRASH_DIRNAME, BACKUPS_DIRNAME
from .paths import database_path

logger = logging.getLogger(__name__)

# 只认 SQLite 快照文件：目录里可能有别的东西，但不在这里暴露删除入口。
_BACKUP_SUFFIXES = {".db"}


def manual_backups_directory(bind: Engine) -> Path:
    """手动备份目录：与自动备份同一套"数据库同目录"的规则。"""
    return database_path(bind).parent / BACKUPS_DIRNAME


def _safe_name(name: str) -> str | None:
    """只接受单段文件名，挡掉路径穿越；合法但不存在时由调用方判 404。"""
    if not name or "/" in name or "\\" in name or name in {".", ".."}:
        return None
    return name


def list_manual_backups(bind: Engine) -> dict:
    """列出 ``backups/`` 下的快照（不含 ``.trash``），按时间倒序。"""
    directory = manual_backups_directory(bind)
    items: list[dict] = []
    if directory.is_dir():
        for entry in directory.iterdir():
            if not entry.is_file() or entry.suffix.lower() not in _BACKUP_SUFFIXES:
                continue
            stat = entry.stat()
            items.append(
                {
                    "name": entry.name,
                    "size_bytes": stat.st_size,
                    "modified_at": stat.st_mtime,
                }
            )
    items.sort(key=lambda item: item["modified_at"], reverse=True)
    trash_dir = directory / BACKUP_TRASH_DIRNAME
    return {
        "directory": str(directory),
        "items": items,
        "trashed_count": (
            sum(1 for item in trash_dir.iterdir() if item.is_file()) if trash_dir.is_dir() else 0
        ),
    }


def trash_manual_backup(bind: Engine, name: str) -> dict:
    """把一份手动备份移进 ``backups/.trash/``：可恢复，不永久删除。"""
    safe = _safe_name(name)
    directory = manual_backups_directory(bind)
    source = directory / safe if safe else None
    if source is None or not source.is_file():
        raise FileNotFoundError(name)
    trash_dir = directory / BACKUP_TRASH_DIRNAME
    trash_dir.mkdir(parents=True, exist_ok=True)
    destination = trash_dir / source.name
    if destination.exists():
        # 同名说明用户删过又生成过同名快照：加时间戳错开，覆盖会丢用户刚放进去的文件。
        destination = trash_dir / f"{source.stem}-{datetime.now():%Y%m%d-%H%M%S}{source.suffix}"
    size = source.stat().st_size
    source.replace(destination)
    logger.info("手动备份已移入可恢复 trash name=%s -> %s", name, destination)
    return {
        "name": name,
        "size_bytes": size,
        "trash_path": str(destination),
        "trashed_at": time.time(),
    }


__all__ = [
    "BACKUPS_DIRNAME",
    "manual_backups_directory",
    "list_manual_backups",
    "trash_manual_backup",
]

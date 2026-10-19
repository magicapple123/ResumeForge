"""存储清理（R19）：把"旧到没用了"的文件列出来，经用户确认后移入回收目录。

**永不硬删**：清理 = 移动到 ``<数据目录>/.cleanup-trash/<时间戳>/<原相对路径>``。
删掉的备份可能正是用户明天要找的那一份，而磁盘空间通常还能再撑一阵——用"能不能撤销"
换"省下几百 MB"是值得的。真正释放空间由用户自己在文件管理器里完成。

清理对象（只碰这三类，且只按**修改时间**判断；不扫数据库、不扫附件）：

- ``backups/``：迁移前的自动备份与手动备份，超过保留天数即候选；
- ``backups/.trash``：备份自己的回收目录，同样按天数老化；
- ``runtime/logs`` / ``logs``：滚动日志（当前那一个按"最近写入"天然不会入选）。

"当前在用的文件"必须排除：数据库文件、附件目录、``datasets/`` 一律不在扫描范围内。
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ..config import DATA_DIR
from .data_backup.paths import BACKUP_TRASH_DIRNAME
from .storage_stats import BACKUPS_DIRNAME

# 清理目标目录（相对数据目录）。顺序即展示顺序。
_CLEANUP_DIRS: tuple[tuple[str, str], ...] = (
    ("backups", BACKUPS_DIRNAME),
    ("backup-trash", f"{BACKUPS_DIRNAME}/{BACKUP_TRASH_DIRNAME}"),
    ("logs", "runtime/logs"),
    ("old-logs", "logs"),
)

TRASH_DIRNAME = ".cleanup-trash"
DEFAULT_RETENTION_DAYS = 30


@dataclass(frozen=True)
class CleanupCandidate:
    label: str
    path: Path
    size: int
    modified: datetime

    def to_dict(self, root: Path) -> dict[str, Any]:
        return {
            "label": self.label,
            # 只回传**相对**路径：绝对路径会暴露用户目录结构，而这个值只用于展示。
            # 统一用 POSIX 分隔符：这是给界面展示的标识，不该随操作系统变形。
            "path": self.path.relative_to(root).as_posix(),
            "size": self.size,
            "modified": self.modified.astimezone().isoformat(timespec="seconds"),
        }


def _data_root() -> Path:
    return Path(DATA_DIR)


def _iter_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    files: list[Path] = []
    for item in directory.iterdir():
        if item.is_symlink():
            # 不跟随链接：清理一个链接指到数据目录之外的东西不是"清理"。
            continue
        if item.is_file():
            files.append(item)
        elif item.is_dir():
            files.extend(
                child for child in item.rglob("*") if child.is_file() and not child.is_symlink()
            )
    return files


def plan_cleanup(
    *, older_than_days: int = DEFAULT_RETENTION_DAYS, now: datetime | None = None
) -> dict[str, Any]:
    """列出超过保留期的文件。只 stat，不读内容。"""
    root = _data_root()
    cutoff = (now or datetime.now()) - timedelta(days=max(1, older_than_days))
    candidates: list[CleanupCandidate] = []
    for label, relative in _CLEANUP_DIRS:
        for path in _iter_files(root / relative):
            try:
                stat = path.stat()
            except OSError:
                continue
            modified = datetime.fromtimestamp(stat.st_mtime)
            if modified >= cutoff:
                continue
            candidates.append(CleanupCandidate(label, path, stat.st_size, modified))
    candidates.sort(key=lambda item: item.modified)
    return {
        "older_than_days": max(1, older_than_days),
        "totals": {
            "files": len(candidates),
            "bytes": sum(item.size for item in candidates),
        },
        "candidates": [item.to_dict(root) for item in candidates],
    }


def run_cleanup(
    *, older_than_days: int = DEFAULT_RETENTION_DAYS, now: datetime | None = None
) -> dict[str, Any]:
    """把候选文件移入 ``.cleanup-trash/<时间戳>/``，返回移动结果。

    移动失败（占用、权限）逐个记录并继续：清掉 9 个、留下 1 个，比整体失败更接近用户的
    预期，也不会让"点了一次清理"变成什么都没发生。
    """
    root = _data_root()
    plan = plan_cleanup(older_than_days=older_than_days, now=now)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    trash_dir = root / TRASH_DIRNAME / stamp
    moved = 0
    freed = 0
    failed: list[str] = []
    for entry in plan["candidates"]:
        source = root / entry["path"]
        target = trash_dir / entry["path"]
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
        except OSError:
            failed.append(entry["path"])
            continue
        moved += 1
        freed += int(entry["size"])
    return {
        "moved": moved,
        "freed_bytes": freed,
        "failed": failed,
        # 回收目录本身也要让用户知道，否则"清理了但磁盘没变"会显得像骗人。
        "trash_dir": trash_dir.relative_to(root).as_posix() if moved else "",
    }


__all__ = [
    "DEFAULT_RETENTION_DAYS",
    "TRASH_DIRNAME",
    "plan_cleanup",
    "run_cleanup",
]

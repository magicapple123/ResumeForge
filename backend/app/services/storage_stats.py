"""存储体积统计（RF-25）：聚合各本地目录的磁盘占用与文件数。

只 ``stat`` 不读内容：目录可能很大（``browser-profile`` 是 Chromium 用户目录，
``user_files`` 是附件磁盘副本），任何"读进来再算"的实现都会把一次统计变成一次
全量 IO。文件内容本身**永远不出现在响应里**——这里只有路径标签、字节数与文件数。

目录都以**数据库文件所在目录**为根（与 ``user_files_dir``、``auto_backup_directory``
同一套规则）：生产环境它就是 ``backend/data``，测试库自动隔离到临时目录，统计结果
天然不混入真实数据目录。
"""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import Engine

from ..config import DATA_DIR
from ..dataset_registry import datasets_directory
from .data_backup.auto_backup import AUTO_BACKUP_DIRNAME, auto_backup_directory
from .data_backup.paths import database_path
from .user_files import USER_FILES_DIRNAME, user_files_dir

# SQLite 的边车文件：与主库同名的 -wal / -shm / -journal，属于主库体积的一部分。
_DB_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")

# 手动备份目录：迁移前的自动备份（database_migrations.backup_sqlite_database 的默认去处），
# 目前没有轮转也没有界面，RF-25 起在这里可见、可逐份清理。
BACKUPS_DIRNAME = "backups"
# 手动备份的可恢复删除位置：删除 = 移动到这里，不做永久删除。
BACKUP_TRASH_DIRNAME = ".trash"


def _base_directory(bind: Engine | None) -> Path:
    """统计根目录：文件型 SQLite 用库所在目录，其余回退到数据目录。"""
    try:
        path = database_path(bind)
    except Exception:  # noqa: BLE001 - 内存库等没有文件路径，回退即可
        return DATA_DIR
    return path.parent


def _path_stats(path: Path) -> tuple[int, int]:
    """递归统计一个文件或目录的（字节数, 文件数）；不存在算 0，stat 失败跳过。"""
    if path.is_file():
        try:
            return path.stat().st_size, 1
        except OSError:  # pragma: no cover - Windows 上文件被占用的瞬时态
            return 0, 0
    if not path.is_dir():
        return 0, 0
    total = 0
    count = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.stat(os.path.join(root, name)).st_size
            except OSError:  # pragma: no cover - 竞态删除
                continue
            count += 1
    return total, count


def _database_entry(db_path: Path) -> dict:
    """主库文件 + 边车文件合并为一项：用户关心的是"数据库占多大"，不是几个文件。"""
    total = 0
    count = 0
    for suffix in ("", *_DB_SIDECAR_SUFFIXES):
        size, file_count = _path_stats(Path(f"{db_path}{suffix}"))
        total += size
        count += file_count
    return {"key": "database", "label": "数据库（含 WAL 边车）", "size_bytes": total, "file_count": count}


def storage_overview(bind: Engine | None = None) -> dict:
    """各项存储占用汇总。顺序按"用户能对它做什么"排：库、备份、副本、产物、环境。"""
    base = _base_directory(bind)
    db_path = database_path(bind) if base != DATA_DIR else base / "resume_forge.db"

    directories: list[tuple[str, str, Path]] = [
        ("datasets", "数据集（含回收站）", datasets_directory()),
        ("backups", "手动备份", base / BACKUPS_DIRNAME),
        ("auto_backups", "自动备份快照", auto_backup_directory(bind) if base != DATA_DIR else base / AUTO_BACKUP_DIRNAME),
        ("user_files", "附件磁盘副本", user_files_dir(bind)),
        ("exports", "导出备份包", base / "exports"),
        ("captures", "站点采集样例", base / "captures"),
        ("share_packages", "分享页面包", base / "share_packages"),
        ("referral_images", "内推备注图片", base / "referral_images"),
        ("logs", "日志", base / "logs"),
        ("browser_profile", "投递浏览器用户目录", base / "browser-profile"),
        ("webform_browser_profile", "网申浏览器用户目录", base / "webform-browser-profile"),
        ("restore", "导入暂存", base / "restore"),
        ("pre_update", "升级前快照", base / "pre-update"),
    ]

    items = [_database_entry(db_path)]
    for key, label, path in directories:
        size, count = _path_stats(path)
        items.append({"key": key, "label": label, "size_bytes": size, "file_count": count})

    total_size, total_count = _path_stats(base)
    return {
        "data_dir": str(base),
        "items": items,
        "total_bytes": total_size,
        "total_file_count": total_count,
    }


__all__ = [
    "AUTO_BACKUP_DIRNAME",
    "BACKUPS_DIRNAME",
    "BACKUP_TRASH_DIRNAME",
    "USER_FILES_DIRNAME",
    "storage_overview",
]

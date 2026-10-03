"""备份常量、``ExtraDatabase``、``BackupError``、数据库/临时目录路径与启动清理。

从 ``services/data_backup.py`` 拆出（职责①⑥）：成员名与目录名常量、随包数据集
描述、对外错误类型，以及数据库路径与 restore/exports 临时目录的清理。
"""
from __future__ import annotations

import time

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import Engine


BACKUP_FORMAT_VERSION = 2
DATABASE_MEMBER = "resume_forge.db"
MANIFEST_MEMBER = "manifest.json"
# 归档里"其余数据集"的存放前缀。
#
# 当前活动的那份**仍然叫 ``resume_forge.db``**（格式 1 的位置不变），其余数据集按
# ``datasets/<id>.db`` 另放。这样即使有人拿格式 2 的包去喂老版本，老版本也至少能按老位置
# 拿到活动数据集——不过清单里的 ``format`` 会被标成 2，老版本会**明确拒收**而不是安静地
# 只恢复一份（见 ``_read_manifest`` 的前向兼容守卫）。
ARCHIVE_DATASETS_DIRNAME = "datasets"

# 临时文件放在数据库同级目录：Windows 上跨盘 os.replace 失败，而恢复正是要做
# 一次原子替换。上传的待恢复包与导出产物分开放，避免启动清理时误删用户刚上传、
# 还没确认的包。
RESTORE_DIRNAME = "restore"
EXPORT_DIRNAME = "exports"
_STALE_TEMP_SECONDS = 1800


@dataclass(frozen=True)
class ExtraDatabase:
    """随包一起带走的**其余数据集**。

    ``data_backup`` 刻意不认识"数据集注册表"：它只管把一个数据库快照塞进包里，
    "哪些数据集要带走、它们叫什么"由 ``services/datasets`` 决定。备份格式因此与
    数据集的文件布局解耦。
    """

    dataset_id: str
    name: str
    source: Path
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def member(self) -> str:
        return f"{ARCHIVE_DATASETS_DIRNAME}/{self.dataset_id}.db"

    @property
    def metadata_member(self) -> str:
        return f"{ARCHIVE_DATASETS_DIRNAME}/{self.dataset_id}.json"

    def manifest_entry(self, size_bytes: int) -> dict[str, Any]:
        """备份清单里的一条数据集条目。"""
        return {
            "id": self.dataset_id,
            "name": self.name,
            "file": self.member,
            "metadata_file": self.metadata_member,
            "size_bytes": size_bytes,
        }


class BackupError(Exception):
    """对外暴露的备份错误，message 为可直接展示给用户的中文提示。"""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def database_path(bind: Engine) -> Path:
    """返回 SQLite 文件路径；内存库等无文件的情况抛出 BackupError。"""
    database = bind.url.database
    if bind.dialect.name != "sqlite" or not database or database == ":memory:":
        raise BackupError("当前数据库不是本地 SQLite 文件，无法备份或恢复", status_code=409)
    return Path(database).resolve()


def restore_directory(bind: Engine) -> Path:
    return database_path(bind).parent / RESTORE_DIRNAME


def export_directory(bind: Engine) -> Path:
    return database_path(bind).parent / EXPORT_DIRNAME



def _purge_stale(directory: Path) -> None:
    """删除上一轮遗留的临时文件；仍在使用的包按修改时间保留。"""
    if not directory.exists():
        return
    deadline = time.time() - _STALE_TEMP_SECONDS
    for item in directory.iterdir():
        if item.is_file() and item.stat().st_mtime < deadline:
            item.unlink(missing_ok=True)


def purge_stale_restores(bind: Engine) -> None:
    _purge_stale(restore_directory(bind))


def cleanup_temp_directories(bind: Engine) -> None:
    """启动时清空临时目录：上一轮未应用的备份包与导出产物都不会再用到。"""
    for directory in (restore_directory(bind), export_directory(bind)):
        if not directory.exists():
            continue
        for item in directory.iterdir():
            if item.is_file():
                item.unlink(missing_ok=True)


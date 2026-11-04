# SPDX-License-Identifier: Apache-2.0
"""2.0 备份包的表集合守卫：声称完整、实际缺表的包必须被拒收。

1.x 时代这里还有一条「旧备份仍可导入」的用例：少 4 张投递表、revision 退回 0009 的包
由迁移补齐。2.0 走全新库路线——1.x 备份包在 ``_check_candidate_epoch`` 处就被拒收
（文案提示用 1.0.2 打开），"迁移补出旧表"这条路径不再存在，对应用例随旧迁移链一起
删除；"1.x 包被拒收"本身由 ``test_backup_reject_legacy.py``（T05）覆盖。

本文件保留反向对照：包内库/清单声称是完整的 2.0 库、却真的缺表，说明包被改过，必须
拒收——否则「表集合与模型注册表一致」这道校验形同虚设。
"""

import sqlite3
import zipfile
from contextlib import contextmanager
from pathlib import Path

import pytest
from app.database import engine
from app.services.data_backup import (
    DATABASE_MEMBER,
    BackupError,
    create_backup_archive,
    inspect_archive,
)

APPLY_TABLES = ("job_match_analysis", "apply_queue_item", "apply_task", "apply_task_item")


def _database_bytes(archive_path: Path) -> bytes:
    with zipfile.ZipFile(archive_path) as archive:
        return archive.read(DATABASE_MEMBER)


@contextmanager
def _tweaked_sqlite(database: Path):
    """打开测试库做改动，退出时提交、checkpoint 并**真正关闭**连接。

    备份快照继承生产库的 WAL 文件头，WAL 模式下 ``with sqlite3.connect(...)``
    只提交不关闭——未 checkpoint 的改动留在 ``-wal`` 文件里，随后裸读 ``.db``
    字节重建压缩包会拿到旧内容。
    """
    connection = sqlite3.connect(database)
    try:
        with connection:
            yield connection
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        connection.close()


def _rebuild_archive(archive: Path, destination: Path, replacements: dict[str, bytes]) -> Path:
    """一次成型重建压缩包，避免出现重名成员。"""
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(destination, "w") as target:
        for name in source.namelist():
            target.writestr(name, replacements.get(name, source.read(name)))
    return destination


def test_inspect_rejects_a_head_revision_backup_missing_the_apply_tables(db_session, tmp_path):
    """反向对照：库声称在 head、却缺投递表，说明包被改过，必须拒收。"""
    archive = create_backup_archive(engine, tmp_path / "staging")

    tampered_database = tmp_path / "head-but-missing.db"
    tampered_database.write_bytes(_database_bytes(archive))
    with _tweaked_sqlite(tampered_database) as connection:
        for name in APPLY_TABLES:
            connection.execute(f"DROP TABLE {name}")

    tampered = _rebuild_archive(
        archive,
        tmp_path / "head-but-missing.zip",
        {DATABASE_MEMBER: tampered_database.read_bytes()},
    )

    with pytest.raises(BackupError, match="缺少数据表"):
        inspect_archive(tampered, engine, tmp_path / "staging")

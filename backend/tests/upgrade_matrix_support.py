# SPDX-License-Identifier: Apache-2.0
"""升级矩阵测试的共享工具：逐表行数与内容指纹（可观察量，不依赖内存对象）。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from app.database_migrations import application_tables


def table_row_counts(database: Path) -> dict[str, int]:
    """按模型注册表统计库内每张业务表的行数；库里没有的表记 0。"""
    counts: dict[str, int] = {}
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        present = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for name in application_tables():
            if name not in present:
                counts[name] = 0
                continue
            counts[name] = connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    return counts


def table_fingerprints(database: Path) -> dict[str, str]:
    """逐表内容指纹：按 rowid 排序后逐行 JSON 序列化再 sha256。

    只比较"数据内容"，不受 SQLite 页面布局/文件字节影响；行顺序按 rowid（插入顺序）
    固定，导入/恢复后应逐表相同。
    """
    fingerprints: dict[str, str] = {}
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        present = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for name in application_tables():
            if name not in present:
                fingerprints[name] = "<missing>"
                continue
            digest = hashlib.sha256()
            columns = [
                row[1] for row in connection.execute(f'PRAGMA table_info("{name}")').fetchall()
            ]
            digest.update(json.dumps(columns, ensure_ascii=False).encode("utf-8"))
            for row in connection.execute(f'SELECT * FROM "{name}" ORDER BY rowid'):
                digest.update(
                    json.dumps(list(row), ensure_ascii=False, default=str).encode("utf-8")
                )
                digest.update(b"\n")
            fingerprints[name] = digest.hexdigest()
    return fingerprints


def snapshot_state(database: Path) -> dict[str, object]:
    """行数 + 指纹，一起作为"升级前后数据没变"的判据。"""
    return {
        "counts": table_row_counts(database),
        "fingerprints": table_fingerprints(database),
    }

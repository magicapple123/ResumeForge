# SPDX-License-Identifier: Apache-2.0
"""``scripts/clean_blank_skill_rows.py``：存量"空名字技能行"的清理必须**只删这一类行**。

为什么值得一个测试：这是一个会 ``DELETE`` 用户数据的脚本，而它面对的是**真实库**。
所以用例要钉住三件事：

1. 名字为空白的行被删、其它行**一个字都不动**（等级/名字都保留）；
2. 幂等——第二次跑报告 0 行、退出码 0（否则"再跑一次确认"就成了新的风险动作）；
3. 默认只报告：不加 ``--apply`` 时数据库字节不变（误敲一次不该毁数据）。

脚本会直接写库，所以这里**用子进程调用**，绝不 import（与 ``test_seed_demo_data`` 同一做法）。
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "clean_blank_skill_rows.py"

# (id, profile_id, name, level)：两条空名字（空白 / 全角空格）、两条正常行。
_ROWS = [
    (1, 1, "Python", "熟练"),
    (2, 1, "", "精通"),
    (3, 1, "  ", ""),
    (4, 1, "Go", "熟悉"),
    (5, 1, "\u3000", "掌握"),
]


def _make_dataset(path: Path) -> Path:
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "CREATE TABLE skill (id INTEGER PRIMARY KEY, profile_id INTEGER, name TEXT, level TEXT)"
        )
        connection.executemany(
            "INSERT INTO skill (id, profile_id, name, level) VALUES (?, ?, ?, ?)", _ROWS
        )
        connection.commit()
    finally:
        connection.close()
    return path


def _rows(path: Path) -> list[tuple[int, str, str]]:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        return [
            (int(row[0]), str(row[1]), str(row[2]))
            for row in connection.execute("SELECT id, name, level FROM skill ORDER BY id")
        ]
    finally:
        connection.close()


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env=dict(os.environ, PYTHONUTF8="1"),
    )


def test_dry_run_reports_blank_rows_without_touching_the_database(tmp_path):
    database = _make_dataset(tmp_path / "dataset.db")
    before = _rows(database)

    result = _run("--db", str(database))

    assert result.returncode == 0, result.stderr
    assert "待删除 3 行" in result.stdout
    assert _rows(database) == before, "默认必须只读：不加 --apply 时一行都不许动"


def test_apply_deletes_only_blank_names_and_is_idempotent(tmp_path):
    database = _make_dataset(tmp_path / "dataset.db")

    first = _run("--db", str(database), "--apply")
    assert first.returncode == 0, first.stderr
    assert "已删除 3 行" in first.stdout
    assert _rows(database) == [(1, "Python", "熟练"), (4, "Go", "熟悉")]

    # 幂等：第二次跑报告 0 行，退出码仍是 0（"再跑一次确认"必须是安全动作）。
    second = _run("--db", str(database), "--apply")
    assert second.returncode == 0, second.stderr
    assert "没有名字为空白的技能行" in second.stdout
    assert _rows(database) == [(1, "Python", "熟练"), (4, "Go", "熟悉")]


def test_a_database_without_the_skill_table_is_refused(tmp_path):
    """指错文件时必须停下来：宁可报错，也不要对着别人的库执行 DELETE。"""
    database = tmp_path / "not_a_dataset.db"
    connection = sqlite3.connect(database)
    try:
        connection.execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")
        connection.commit()
    finally:
        connection.close()

    result = _run("--db", str(database), "--apply")

    assert result.returncode != 0
    assert "没有 skill 表" in result.stdout + result.stderr


def test_missing_database_path_fails_loudly(tmp_path):
    result = _run("--db", str(tmp_path / "nope.db"), "--apply")

    assert result.returncode != 0
    assert "找不到数据库" in result.stdout + result.stderr

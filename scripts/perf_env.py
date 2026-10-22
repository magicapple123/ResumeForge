# SPDX-License-Identifier: Apache-2.0
"""环境口径与被测库校验：HEAD/硬件快照、环境准备、engine 绑定断言、FTS 能力探测。

搬迁自 ``scripts/measure_api_perf.py`` 第 62–64 行（仓库路径常量）与第 258–448 行
（环境段 6 个函数 + 库校验段 ``probe_fts``/``validate_database``）。

路径常量按本文件自己的 ``__file__`` 推导——本文件与入口脚本同在 ``scripts/`` 下，
所以 ``REPO_ROOT``/``BACKEND_DIR``/``SCRIPTS_DIR`` 的取值与拆分前完全一致。
"""

from __future__ import annotations

import ctypes
import os
import platform
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from sqlalchemy import text

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
SCRIPTS_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# 环境与硬件口径。
# ---------------------------------------------------------------------------
def _git_head_commit() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return completed.stdout.strip()
    except Exception:  # noqa: BLE001 - 无 git 环境（发布包）时如实留空
        return ""


def _cpu_name() -> str:
    name = platform.processor() or platform.machine()
    if os.name == "nt":
        try:
            completed = subprocess.run(
                ["wmic", "cpu", "get", "name"],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
            if len(lines) >= 2:
                return lines[1]
        except Exception:  # noqa: BLE001 - wmic 可能不存在，回退 platform
            pass
    return name


def _total_memory_bytes() -> int:
    try:
        if os.name == "nt":

            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            statex = _MEMORYSTATUSEX()
            statex.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(statex))
            return int(statex.ullTotalPhys)
        # POSIX 上没有统一的"物理内存总量"接口，读 /proc/meminfo 的 MemTotal。
        with open("/proc/meminfo", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) * 1024
        return 0
    except Exception:  # noqa: BLE001 - 拿不到就留 0，报告里如实显示 unknown
        return 0


def collect_environment_info(db_path: Path, mode: str, scale_label: str) -> dict[str, Any]:
    """测量口径快照：HEAD / 硬件 / Python，供报告原样引用。"""
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "git_head": _git_head_commit(),
        "mode": mode,
        "scale_label": scale_label,
        "db_path": str(db_path),
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.release()} ({platform.machine()})",
        "cpu": _cpu_name(),
        "cpu_count": os.cpu_count() or 0,
        "total_memory_bytes": _total_memory_bytes(),
        "measurement_client": "fastapi.testclient.TestClient（进程内，非真实网络/浏览器）",
    }


def prepare_environment(db_path: Path) -> str:
    """在导入 app 之前设置环境（config 在导入时读取一次环境变量）。

    直接复用 stress_seed.schema 的同一份实现，保证测量库与造数库的
    环境口径完全一致（DATABASE_URL / LOG_FILE_ENABLED / PYTHONUTF8）。
    """
    # backend 目录必须可导入（app.* 仅在调用 prepare_environment 之后 import）。
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    from stress_seed import schema as stress_schema

    return stress_schema.prepare_environment(db_path)


def _assert_engine_binds_db(engine: Any, db_path: Path) -> None:
    """断言实际绑定的引擎 URL 就是声明的 DB_PATH，而不是被指针改写过的路径。"""
    bound = getattr(engine.url, "database", None)
    if not bound or Path(str(bound)).resolve() != db_path.resolve():
        raise SystemExit(
            f"实际引擎 URL（{bound!r}）与声明输出（{str(db_path.resolve())!r}）不一致，"
            "测量将写到意料之外的库上；已拒绝执行。"
        )


# ---------------------------------------------------------------------------
# FTS 能力探测与 fixture 校验。
# ---------------------------------------------------------------------------
def probe_fts(conn: Any) -> dict[str, Any]:
    """SQLite/FTS5/trigram 能力探测（只建 temp 虚拟表，不留任何对象）。"""
    info: dict[str, Any] = {"sqlite_version": sqlite3.sqlite_version}
    for key, ddl in (
        ("fts5_available", "CREATE VIRTUAL TABLE temp.rf_fts_probe USING fts5(a)"),
        (
            "trigram_tokenizer",
            "CREATE VIRTUAL TABLE temp.rf_fts_probe_tri USING fts5(a, tokenize='trigram')",
        ),
    ):
        try:
            conn.execute(text(ddl))
            conn.execute(text("DROP TABLE IF EXISTS temp.rf_fts_probe"))
            conn.execute(text("DROP TABLE IF EXISTS temp.rf_fts_probe_tri"))
            info[key] = True
        except Exception:  # noqa: BLE001 - 能力探测失败即不可用
            info[key] = False
    rows = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'")
    ).all()
    info["knowledge_fts_table"] = bool(rows)
    return info


FTS_PLAN_SQL = (
    "SELECT knowledge_entry.id FROM knowledge_entry "
    "WHERE knowledge_entry.deleted_at IS NULL "
    "AND knowledge_entry.id IN ("
    "SELECT rowid FROM knowledge_fts WHERE knowledge_fts MATCH :fts_match)"
)


def validate_database(engine: Any, terms: dict[str, str]) -> dict[str, Any]:
    """校验被测库：alembic head 一致、FTS 表存在、知识库搜索计划真的走 FTS。

    这是"测量工具有资格谈 FTS 收益"的前提：任何一条不满足都直接抛错退出，
    不允许在错误 schema 上继续产出数字。
    """
    from alembic.migration import MigrationContext
    from alembic.script import ScriptDirectory
    from app.database_migrations import build_alembic_config
    from sqlalchemy import text

    config = build_alembic_config(engine)
    expected_head = ScriptDirectory.from_config(config).get_current_head()
    report: dict[str, Any] = {"expected_head": expected_head}
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
        report["alembic_version"] = current
        report["alembic_head_matches"] = current == expected_head
        report.update(probe_fts(conn))
        report["fts_search_plan_uses_fts"] = False
        report["fts_search_plan"] = []
        if report["knowledge_fts_table"]:
            term = terms.get("knowledge") or "面试"
            escaped = term.replace('"', '""')
            plan_rows = conn.execute(
                text("EXPLAIN QUERY PLAN " + FTS_PLAN_SQL),
                {"fts_match": f'"{escaped}"'},
            ).all()
            details = [row[3] for row in plan_rows]
            report["fts_search_plan"] = details
            report["fts_search_plan_uses_fts"] = any(
                "knowledge_fts" in detail for detail in details
            )
    problems = []
    if not report["alembic_head_matches"]:
        problems.append(
            f"alembic 版本 {report['alembic_version']!r} != 迁移链 head {expected_head!r}"
        )
    if not report["knowledge_fts_table"]:
        problems.append("knowledge_fts 表不存在（迁移 0044 未生效，FTS 搜索路径无从谈起）")
    if report["knowledge_fts_table"] and not report["fts_search_plan_uses_fts"]:
        problems.append("知识库搜索的 EXPLAIN QUERY PLAN 未命中 knowledge_fts")
    if problems:
        raise SystemExit("被测库校验失败（拒绝产出误导性数字）:\n  - " + "\n  - ".join(problems))
    return report

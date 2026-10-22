# SPDX-License-Identifier: Apache-2.0
"""生成一份**纯虚构**的演示数据集，可选地把全部只读接口跑一遍做自检。

为什么需要它：README 与文档要放真实运行截图（不是示意图），而截图不能出现任何真实用户资料。
这个脚本负责造出那份"看起来像真在用、但没有一个字节是真的"的数据，并在写完之后**用应用自己的
接口逐个读一遍**——演示数据写坏 schema 的后果在真实用户那里表现为"某个页面打不开"，
所以这里宁可自己先撞一次墙。

用法（在仓库根目录执行）：

    backend\\.venv\\Scripts\\python.exe scripts\\seed_demo_data.py --check

默认写到 ``runtime/demo/demo.db``（``runtime/`` 已被 .gitignore 忽略）。
演示库请**用 DATABASE_URL 指向它单独启动一份后端**，不要覆盖 ``backend/data/resume_forge.db``：

    $env:DATABASE_URL = "sqlite:///D:/ResumeForge/runtime/demo/demo.db"
    backend\\.venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8123  # 在 backend 目录执行

``--check`` 需要 ``fastapi.testclient``（dev 依赖里已有）。不带它时只写数据、不起应用。

本文件只负责「解析参数 → 建库 → 按序调用各域 → 自检」；各域的数据模板在
``scripts/demo_data/``（按数据库表族分模块，纯搬迁，见各模块 docstring）。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

DEFAULT_OUT = REPO_ROOT / "runtime" / "demo" / "demo.db"


def _preparse_out() -> Path:
    """在导入 app 之前把 ``--out`` 读出来。

    ``app.config`` 在**导入时**就通过 ``get_settings()`` 定下 ``database_url``（进程内缓存），
    所以环境变量必须先设好、后导入——顺序反了就还是会写到默认库上。
    """
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    known, _ = parser.parse_known_args()
    return Path(known.out).expanduser().resolve()


DB_PATH = _preparse_out()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = "sqlite:///" + DB_PATH.as_posix()

# ⚠️ 各数据域模块只能在 DB_PATH 定好之后导入：它们会（间接）导入 app.config，
# 而 app.config 在导入时就把 database_url 缓存好了（见 _preparse_out 的注释）。
from demo_data import (  # noqa: E402
    apply_assistant,
    checks,
    jobs,
    knowledge_interviews,
    profile,
    resumes_ledger,
    tracker_referrals,
)
from demo_data.base import init_db  # noqa: E402


def main() -> int:
    """解析参数 → 重建演示库 → 按原文件顺序逐域造数 → 可选自检。"""
    parser = argparse.ArgumentParser(description="生成纯虚构的演示数据集")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="演示库的输出路径")
    parser.add_argument("--check", action="store_true", help="写完后把只读接口跑一遍自检")
    arguments = parser.parse_args()

    init_db()
    # 调用顺序必须与拆分前 ins(...) 在文件里的出现顺序一致：数据里藏着 profile_id=1、
    # job_id=1 这类自增 id 与 JOBS[n] 的排位假设，换序写出来的库就不是同一份数据了。
    profile.seed()
    jobs.seed()
    resumes_ledger.seed()
    knowledge_interviews.seed()
    tracker_referrals.seed()
    apply_assistant.seed()

    print(f"演示数据集已写入 {DB_PATH}")
    if Path(arguments.out).expanduser().resolve() != DB_PATH:
        # --out 与 DB_PATH 理应一致；不一致说明"先解析再导入"的顺序被改坏了。
        print(
            f"警告：实际写入路径 {DB_PATH} 与 --out {arguments.out} 不一致。",
            file=sys.stderr,
        )
        raise SystemExit(2)
    if arguments.check:
        raise SystemExit(checks.run_checks())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

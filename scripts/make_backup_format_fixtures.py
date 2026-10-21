# SPDX-License-Identifier: Apache-2.0
"""生成 ``backend/tests/fixtures/backup-formats/`` 下的格式样本包（§12.3）。

为什么要冻结样本：格式号是**给老版本看的信号**，一条"升级一次就读不回旧包"的回归
在开发机上几乎不可能靠手点发现。这里用**当前代码**为每个格式号各产出一份最小、
纯合成的包（空 schema 库 + 一份假字体 + 一条假模型配置，均不含任何真实用户数据），
提交进仓库；``test_backup_format_matrix`` 每次全量测试逐个导入一次。将来任何一次
"改包结构忘了升号/忘了兼容"都会在这里变红，而不是等到用户导不回自己的旧备份。

用法（在 ``backend`` 目录）::

    .venv\\Scripts\\python.exe ..\\scripts\\make_backup_format_fixtures.py

新增格式号时：加一个 ``--formats`` 分支 + 在测试的期望表里加一行 + CHANGELOG/README
各一行（见 AGENTS.md「备份包结构变更」一节）。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

FIXTURE_DIR = BACKEND_DIR / "tests" / "fixtures" / "backup-formats"

# 合成字体：只需要"扩展名合法 + 固定字节"，样本包不参与渲染。
FAKE_FONT_NAME = "sample-sans.ttf"
FAKE_FONT_BYTES = b"\x00\x01\x00\x00" + b"\x00" * 508

# 合成模型配置：只带 LLMConfig 认识的字段，密钥为空（样本包永远不含凭据）。
FAKE_PROFILE = {
    "id": "p_fixture0000001",
    "name": "样本配置",
    "config": {"provider": "openai", "base_url": "http://127.0.0.1:1/v1", "model": "sample"},
    "models": ["sample"],
    "created_at": "2026-01-01T00:00:00+08:00",
    "updated_at": "2026-01-01T00:00:00+08:00",
}


def _prepare_environment(root: Path) -> None:
    """让 app 把整份数据目录都落到临时目录里（绝不能碰开发机的 backend/data）。"""
    os.environ["RF_DATA_DIR"] = str(root)
    os.environ["DATABASE_URL"] = f"sqlite:///{(root / 'resume_forge.db').as_posix()}"
    os.environ["LOG_FILE_ENABLED"] = "false"
    os.environ["AUTO_BACKUP_ENABLED"] = "false"


def _write_global_state(root: Path) -> None:
    (root / "global_settings.json").write_text(
        json.dumps(
            {
                "version": 2,
                "llm": {"profiles": [FAKE_PROFILE], "active_profile_id": FAKE_PROFILE["id"]},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_font(root: Path) -> None:
    fonts = root / "fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    (fonts / FAKE_FONT_NAME).write_bytes(FAKE_FONT_BYTES)
    (fonts / "active.json").write_text(
        json.dumps({"name": FAKE_FONT_NAME}, ensure_ascii=False), encoding="utf-8"
    )
    (fonts / "names.json").write_text(
        json.dumps({FAKE_FONT_NAME: "样本字体"}, ensure_ascii=False), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="生成备份格式样本包")
    parser.add_argument("--output", type=Path, default=FIXTURE_DIR)
    args = parser.parse_args()

    root = Path(tempfile.mkdtemp(prefix="rf-backup-fixtures-"))
    _prepare_environment(root)
    _write_global_state(root)
    _write_font(root)

    from app import database
    from app.database_migrations import run_database_migrations
    from app.services.data_backup.collection_export import create_collection_archive
    from app.services.data_backup.export import create_backup_archive

    run_database_migrations(database.engine)

    args.output.mkdir(parents=True, exist_ok=True)
    staging = root / "staging"
    plan = {
        1: lambda: create_backup_archive(database.engine, staging / "f1"),
        3: lambda: create_backup_archive(database.engine, staging / "f3", include_api_keys=True),
        4: lambda: create_collection_archive(database.engine, staging / "f4"),
        5: lambda: create_backup_archive(database.engine, staging / "f5", include_global_llm=True),
        6: lambda: create_backup_archive(
            database.engine, staging / "f6", include_global_assets=True
        ),
    }
    try:
        for version, build in plan.items():
            archive = build()
            target = args.output / f"format-{version}.zip"
            shutil.copyfile(archive, target)
            print(f"format {version}: {target.name} ({target.stat().st_size} bytes)")
    finally:
        database.engine.dispose()
        shutil.rmtree(root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

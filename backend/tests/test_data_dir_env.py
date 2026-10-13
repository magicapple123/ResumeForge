"""RF_DATA_DIR 数据目录覆盖（ADR-0004，2026-10-13 生产审计 PR-05）。

config.py 的 DATA_DIR 在设置了 RF_DATA_DIR 时取该值（桌面壳把用户数据指到
%APPDATA%），未设置时保持 backend/data 默认——环境变量/默认值顺序不变。
config 是模块级常量，子进程导入做断言，避免污染本进程的模块缓存，也天然
兼容 pytest-xdist 的并行隔离要求。
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

_PROBE = "import app.config as c; print(c.DATA_DIR); print(c.DEFAULT_DATABASE_URL)"


def _import_config(extra_env: dict[str, str]) -> list[str]:
    env = {k: v for k, v in os.environ.items() if k != "RF_DATA_DIR"}
    env["PYTHONUTF8"] = "1"
    env.update(extra_env)
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    return result.stdout.strip().splitlines()


def test_default_data_dir_is_backend_data_when_env_absent() -> None:
    lines = _import_config({})
    assert lines[0] == str(BACKEND_DIR / "data")
    assert lines[1] == f"sqlite:///{(BACKEND_DIR / 'data' / 'resume_forge.db').as_posix()}"


def test_rf_data_dir_redirects_data_dir_and_database_url() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        lines = _import_config({"RF_DATA_DIR": tmp})
    assert lines[0] == str(Path(tmp))
    assert lines[1] == f"sqlite:///{Path(tmp).as_posix()}/resume_forge.db"

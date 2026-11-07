# SPDX-License-Identifier: Apache-2.0
"""升级矩阵场景②③④（端到端）：真实启动一次应用，看数据目录与库的实际结果。

不走 in-process 的 enforce()，而是起一个隔离子进程：环境变量指到临时数据目录，
TestClient 触发完整 lifespan（闸门 → 归档/拒绝 → 迁移 → 健康检查）。这样"进程能不能
启动、端口后面有没有可用应用"才是可观察的；in-process 测试只覆盖函数契约。
"""

import json
import os
import sqlite3
import subprocess
import sys
import zipfile
from pathlib import Path

from alembic import command
from app import database
from app.database_migrations import build_alembic_config
from tests.migration_refs import head_revision
from tests.upgrade_matrix_support import snapshot_state

BACKEND_DIR = Path(__file__).resolve().parents[1]
LEGACY_FIXTURE = Path(__file__).parent / "fixtures" / "legacy-1x" / "backup-1.0.2.zip"

_STARTUP_SCRIPT = """
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    response = client.get("/api/health")
    print("HEALTH", response.status_code)
"""


def _run_startup(data_dir: Path, database_file: Path, timeout: int = 180):
    environment = os.environ.copy()
    environment.update(
        {
            "PYTHONUTF8": "1",
            "DATABASE_URL": f"sqlite:///{database_file.as_posix()}",
            "RF_DATA_DIR": str(data_dir),
            "LOG_FILE_ENABLED": "false",
            "AUTO_BACKUP_ENABLED": "false",
        }
    )
    return subprocess.run(
        [sys.executable, "-c", _STARTUP_SCRIPT],
        cwd=BACKEND_DIR,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def _state(database_file: Path) -> tuple[int, int]:
    stat = database_file.stat()
    return stat.st_size, stat.st_mtime_ns


def _baseline_database(database_file: Path) -> None:
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        command.upgrade(build_alembic_config(engine), "head")
    finally:
        engine.dispose()


def _extract_legacy_library(data_dir: Path) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    database_file = data_dir / "resume_forge.db"
    with zipfile.ZipFile(LEGACY_FIXTURE) as archive:
        database_file.write_bytes(archive.read("resume_forge.db"))
    return database_file


def test_fresh_install_starts_and_builds_2_0_database(tmp_path) -> None:
    data_dir = tmp_path / "data"
    database_file = data_dir / "resume_forge.db"
    result = _run_startup(data_dir, database_file)
    assert result.returncode == 0, result.stderr[-4000:]
    assert "HEALTH 200" in result.stdout
    assert database_file.is_file()
    assert not (data_dir / "legacy-archive").exists()
    with sqlite3.connect(database_file) as connection:
        assert connection.execute("SELECT epoch FROM app_schema_epoch").fetchall() == [(2,)]
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    assert revision == head_revision()


def test_1x_library_is_archived_then_starts_on_empty_2_0_database(tmp_path) -> None:
    data_dir = tmp_path / "data"
    database_file = _extract_legacy_library(data_dir)
    result = _run_startup(data_dir, database_file)
    assert result.returncode == 0, result.stderr[-6000:]
    assert "HEALTH 200" in result.stdout

    archive_roots = list((data_dir / "legacy-archive").glob("*"))
    assert len(archive_roots) == 1
    archive_root = archive_roots[0]
    zip_path = next((archive_root / "package").glob("*.zip"))
    with zipfile.ZipFile(zip_path) as archive:
        assert archive.testzip() is None
        manifest = json.loads(archive.read("manifest.json"))
        assert isinstance(manifest["format"], int)
    archived_database = archive_root / "files" / "resume_forge.db"
    with sqlite3.connect(archived_database) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"

    assert database_file.is_file(), "移走旧库后应在同一路径重开空库"
    with sqlite3.connect(database_file) as connection:
        assert connection.execute("SELECT epoch FROM app_schema_epoch").fetchall() == [(2,)]
        for table in ("profile_entry", "resume_record", "user_profile", "education"):
            assert connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == 0


def test_too_new_library_refuses_to_start_without_touching_files(tmp_path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database_file = data_dir / "resume_forge.db"
    _baseline_database(database_file)
    with sqlite3.connect(database_file) as connection:
        connection.execute("UPDATE app_schema_epoch SET epoch = 3")
        connection.commit()
    before_state = snapshot_state(database_file)
    before_file = _state(database_file)

    result = _run_startup(data_dir, database_file)

    assert result.returncode != 0
    assert "更新版本" in (result.stderr + result.stdout)
    assert _state(database_file) == before_file
    assert snapshot_state(database_file) == before_state
    assert not (data_dir / "legacy-archive").exists(), "拒绝启动不得新增归档目录"

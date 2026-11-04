# SPDX-License-Identifier: Apache-2.0
"""更新前完整快照脚本（scripts/create_user_data_snapshot.py）的回归测试。

钉住更新器依赖的解析协议与快照内容：

1. 成功：stdout 恰好一行 SNAPSHOT=<zip 绝对路径>，退出码 0；
2. 失败：stdout 是 SNAPSHOT_ERROR=<原因>，退出码 2（更新器据此中止更新）；
3. 包必须能通过 legacy_archive.verify_archive，并且真的带数据库、字体与全局资产
   ——只拷 *.db 的旧实现没有这些；
4. --include-api-keys 与导出界面的勾选项同义，会写进子包清单。
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
SNAPSHOT_SCRIPT = BACKEND_DIR / "scripts" / "create_user_data_snapshot.py"
MIGRATE_SNIPPET = (
    "from app.database import engine; "
    "from app.database_migrations import run_database_migrations; "
    "run_database_migrations(engine); "
    "engine.dispose()"
)
FONT_NAME = "Synthetic-Sans.ttf"
FONT_BYTES = b"\x00\x01\x00\x00" + b"synthetic-font" * 16


def _environment(data_dir: Path, *, database_url: str | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["RF_DATA_DIR"] = str(data_dir)
    env["DATABASE_URL"] = database_url or ("sqlite:///" + (data_dir / "resume_forge.db").as_posix())
    env["LOG_FILE_ENABLED"] = "false"
    return env


def _run(arguments: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        arguments,
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        check=False,
    )


def _seed_database(env: dict[str, str]) -> None:
    result = _run([sys.executable, "-c", MIGRATE_SNIPPET], env)
    assert result.returncode == 0, result.stdout + result.stderr


def _seed_font(data_dir: Path) -> None:
    fonts = data_dir / "fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    (fonts / FONT_NAME).write_bytes(FONT_BYTES)


def _outer_manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read("manifest.json"))


def _main_sub_manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        manifest = json.loads(handle.read("manifest.json"))
        entry = next(item for item in manifest["datasets"] if item["id"] == "main")
        payload = handle.read(entry["file"])
    with zipfile.ZipFile(io.BytesIO(payload)) as sub:
        return json.loads(sub.read("manifest.json"))


def test_success_prints_snapshot_line_and_carries_full_data(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    env = _environment(data_dir)
    _seed_database(env)
    _seed_font(data_dir)
    destination = data_dir / "pre-update" / "20260101-000000"

    result = _run([sys.executable, str(SNAPSHOT_SCRIPT), "--destination", str(destination)], env)

    assert result.returncode == 0, result.stdout + result.stderr
    snapshot_lines = [line for line in result.stdout.splitlines() if line.startswith("SNAPSHOT=")]
    assert len(snapshot_lines) == 1, result.stdout
    assert "SNAPSHOT_ERROR=" not in result.stdout
    archive = Path(snapshot_lines[0].split("=", 1)[1])
    assert archive.is_absolute()
    assert archive.parent == destination.resolve()
    assert archive.is_file()

    with zipfile.ZipFile(archive) as outer:
        assert outer.testzip() is None
        names = set(outer.namelist())
        manifest = json.loads(outer.read("manifest.json"))
    # 字体是跨数据集的全局资产：外层必须带上它（格式 6）。
    assert manifest["format"] == 6, manifest["format"]
    assert manifest["type"] == "collection"
    assert {"manifest.json", "README.txt", "global_assets.json"} <= names
    assert any(name.startswith("fonts/") and name.endswith(".ttf") for name in names)
    # 活动库在嵌套子包里，子包清单也要自洽。
    with zipfile.ZipFile(archive) as outer:
        entry = next(item for item in manifest["datasets"] if item["id"] == "main")
        sub_payload = outer.read(entry["file"])
    with zipfile.ZipFile(io.BytesIO(sub_payload)) as sub:
        sub_names = set(sub.namelist())
        sub_manifest = json.loads(sub.read("manifest.json"))
    assert {"manifest.json", "resume_forge.db"} <= sub_names
    assert sub_manifest["alembic_revision"] == entry["alembic_revision"]
    assert sub_manifest["api_key_included"] is False

    # 快照必须能通过归档校验（更新器真正依赖的那道闸）。
    from app.services.data_backup.legacy_archive import verify_archive

    verify_archive(archive)


def test_include_api_keys_is_opt_in(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    env = _environment(data_dir)
    _seed_database(env)
    destination = data_dir / "pre-update" / "keys-on"

    result = _run(
        [
            sys.executable,
            str(SNAPSHOT_SCRIPT),
            "--destination",
            str(destination),
            "--include-api-keys",
        ],
        env,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    archive = Path(
        next(line for line in result.stdout.splitlines() if line.startswith("SNAPSHOT=")).split(
            "=", 1
        )[1]
    )
    assert _main_sub_manifest(archive)["api_key_included"] is True
    assert _outer_manifest(archive)["datasets"], "整包清单必须逐份记录数据集"


def test_failure_prints_error_line_and_exits_two(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    # 数据库 URL 指向一个**目录**：SQLite 打不开它，导出必然失败。
    # （不能用"父目录不存在"制造失败：app.database 导入时会把配置路径的父目录建出来，
    # 那是正常的启动行为，反而会让快照"成功"。）
    not_a_database = tmp_path / "not-a-db"
    not_a_database.mkdir()
    env = _environment(data_dir, database_url="sqlite:///" + not_a_database.as_posix())
    destination = tmp_path / "pre-update" / "broken"

    result = _run([sys.executable, str(SNAPSHOT_SCRIPT), "--destination", str(destination)], env)

    assert result.returncode == 2, result.stdout + result.stderr
    error_lines = [
        line for line in result.stdout.splitlines() if line.startswith("SNAPSHOT_ERROR=")
    ]
    assert len(error_lines) == 1, result.stdout
    assert error_lines[0] != "SNAPSHOT_ERROR=", "失败原因不能为空"
    assert "SNAPSHOT=" not in result.stdout
    assert not list(destination.glob("*.zip")), "失败时不能留下半成品包"

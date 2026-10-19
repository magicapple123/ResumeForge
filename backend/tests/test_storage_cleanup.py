"""存储清理（R19）：只列"旧到没用"的文件，清理 = 移入回收目录。

三条必须守住的性质：
1. **永不硬删**——清理后文件仍在 ``.cleanup-trash/<时间戳>/`` 下，能找回；
2. **不碰在用的文件**——新备份、数据库、附件都不在候选里；
3. **预览与执行同一口径**——预览说 1 个文件 12 字节，执行就移走这 1 个。
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from app.services.cleanup import TRASH_DIRNAME, plan_cleanup, run_cleanup


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """每个用例一个干净的数据目录：清理是按目录扫描的，用例之间不能互相看见文件。"""
    monkeypatch.setattr("app.services.cleanup.DATA_DIR", str(tmp_path))
    return tmp_path


def _write(relative: str, size: int, *, age_days: float) -> Path:
    path = Path(__import__("app.services.cleanup", fromlist=["DATA_DIR"]).DATA_DIR) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    stamp = time.time() - age_days * 86400
    os.utime(path, (stamp, stamp))
    return path


def test_only_files_older_than_the_retention_window_are_listed():
    old = _write("backups/old.zip", 12, age_days=90)
    fresh = _write("backups/fresh.zip", 8, age_days=1)

    plan = plan_cleanup(older_than_days=30)

    listed = {item["path"] for item in plan["candidates"]}
    assert "backups/old.zip" in listed
    assert "backups/fresh.zip" not in listed
    assert plan["totals"]["files"] == 1
    assert plan["totals"]["bytes"] == 12
    assert old.exists() and fresh.exists(), "预览不能动任何文件"


def test_cleanup_moves_files_into_a_dated_trash_directory(data_dir):
    source = _write("backups/ancient.zip", 16, age_days=120)

    result = run_cleanup(older_than_days=30)

    assert result["moved"] == 1
    assert result["freed_bytes"] == 16
    assert not source.exists(), "原位置应当被腾空"
    moved = data_dir / result["trash_dir"] / "backups/ancient.zip"
    assert moved.exists() and moved.stat().st_size == 16
    assert result["trash_dir"].startswith(TRASH_DIRNAME)


def test_cleanup_never_touches_current_data_files(data_dir):
    database = data_dir / "resume_forge.db"
    database.write_bytes(b"db")
    old_stamp = time.time() - 400 * 86400
    os.utime(database, (old_stamp, old_stamp))
    asset = _write("user_files/old-attachment.pdf", 10, age_days=400)

    plan = plan_cleanup(older_than_days=30)
    paths = {item["path"] for item in plan["candidates"]}

    assert "resume_forge.db" not in paths
    assert "user_files/old-attachment.pdf" not in paths
    assert database.exists() and asset.exists()


def test_preview_and_execute_agree(client):
    _write("runtime/logs/old.log", 32, age_days=60)

    before = client.get("/api/stats/storage/cleanup-preview", params={"older_than_days": 30})
    assert before.status_code == 200
    plan = before.json()
    assert plan["totals"]["files"] == 1

    after = client.post("/api/stats/storage/cleanup", json={"older_than_days": 30})
    assert after.status_code == 200
    assert after.json()["moved"] == 1

    # 再预览一次：候选已经清空（文件在回收目录里，不再被列出）。
    again = client.get("/api/stats/storage/cleanup-preview", params={"older_than_days": 30})
    assert again.json()["totals"]["files"] == 0


def test_cleanup_accepts_a_bad_window_without_failing(client):
    response = client.post("/api/stats/storage/cleanup", json={"older_than_days": "很久"})
    assert response.status_code == 200
    # 回落到默认 30 天，而不是 500。
    assert response.json()["moved"] == 0

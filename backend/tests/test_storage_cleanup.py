# SPDX-License-Identifier: Apache-2.0
"""存储清理（R19）：只列"旧到没用"的文件，清理 = 移入回收目录。

四条必须守住的性质：
1. **永不硬删**——清理后文件仍在 ``.cleanup-trash/<时间戳>/`` 下，能找回；
2. **不碰在用的文件**——新备份、数据库、附件都不在候选里；
3. **预览与执行同一口径**——预览说 1 个文件 12 字节，执行就移走这 1 个；
4. **最近 3 份备份永不入选**——清掉它们等于把"能回滚"降级成"回滚到很久以前"。
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from app.services import cleanup
from app.services.cleanup import KEEP_RECENT_BACKUPS, TRASH_DIRNAME, plan_cleanup, run_cleanup


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """每个用例一个干净的数据目录：清理是按目录扫描的，用例之间不能互相看见文件。

    **这个 fixture 是必须的，不是清洁癖**：2026-10-19 这组用例最初直接以
    ``app.config.DATA_DIR`` 为根，跑一次测试就把开发机的 ``backend/data`` 当成沙箱——
    主库被写成 2 字节、真实备份被移进 ``.cleanup-trash``。现在固定指向 ``tmp_path``，
    并断言补丁真的生效（写在错误根上的清理测试，比没有测试更危险）。
    """
    monkeypatch.setattr(cleanup, "DATA_DIR", str(tmp_path))
    assert cleanup._data_root() == tmp_path
    return tmp_path


def _write(relative: str, size: int, *, age_days: float) -> Path:
    path = cleanup._data_root() / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    stamp = time.time() - age_days * 86400
    os.utime(path, (stamp, stamp))
    return path


def test_only_files_older_than_the_retention_window_are_listed():
    # 三份新鲜备份占住"最近 3 份"的保护位，超期那份才是候选。
    for index in range(3):
        _write(f"backups/fresh{index}.zip", 8, age_days=1 + index)
    old = _write("backups/old.zip", 12, age_days=90)

    plan = plan_cleanup(older_than_days=30)

    listed = {item["path"] for item in plan["candidates"]}
    assert listed == {"backups/old.zip"}
    assert plan["totals"]["files"] == 1
    assert plan["totals"]["bytes"] == 12
    assert old.exists(), "预览不能动任何文件"


def test_the_three_most_recent_backups_never_become_candidates():
    """最近 3 份备份永远不进清单（R19）：它们才是"出事了能回滚"的那几条。"""
    for index in range(1, 6):  # b1 最新（41 天）… b5 最老（45 天）
        _write(f"backups/b{index}.db", 10, age_days=40 + index)

    plan = plan_cleanup(older_than_days=30)

    assert {item["path"] for item in plan["candidates"]} == {"backups/b4.db", "backups/b5.db"}
    assert {item["path"] for item in plan["skipped"]} == {
        "backups/b1.db",
        "backups/b2.db",
        "backups/b3.db",
    }
    assert {item["reason"] for item in plan["skipped"]} == {f"最近 {KEEP_RECENT_BACKUPS} 份备份"}
    assert plan["totals"]["files"] == 2


def test_cleanup_moves_files_into_a_dated_trash_directory(data_dir):
    for index in range(1, 5):  # 4 份 → 最新 3 份受保护，只剩最老那份被移走
        _write(f"backups/b{index}.db", 16, age_days=40 + index)
    oldest = data_dir / "backups/b4.db"

    result = run_cleanup(older_than_days=30)

    assert result["moved"] == 1
    assert result["freed_bytes"] == 16
    assert not oldest.exists(), "原位置应当被腾空"
    moved = data_dir / result["trash_dir"] / "backups/b4.db"
    assert moved.exists() and moved.stat().st_size == 16
    assert result["trash_dir"].startswith(TRASH_DIRNAME)
    # 最近 3 份原样留在原地，并原样回报给界面。
    assert {path.name for path in (data_dir / "backups").glob("b*.db")} == {
        "b1.db",
        "b2.db",
        "b3.db",
    }
    assert len(result["skipped"]) == KEEP_RECENT_BACKUPS


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


def test_auto_backups_are_scanned():
    """``auto-backups/``（每 6 小时堆积）必须在扫描范围内，否则它会无声长到几个 GB。"""
    snapshot = _write("auto-backups/main/snap.db", 24, age_days=40)

    plan = plan_cleanup(older_than_days=30)

    assert "auto-backups/main/snap.db" in {item["path"] for item in plan["candidates"]}
    assert plan["by_category"]["auto-backups"] == {"label": "自动备份", "files": 1, "bytes": 24}
    assert snapshot.exists()


def test_trash_and_auto_backups_have_no_retention_policy():
    """保留策略只对手动备份生效：``.trash`` 与自动备份里的东西本来就该被清。"""
    for index in range(1, 5):
        _write(f"backups/.trash/r{index}.zip", 5, age_days=40 + index)
        _write(f"auto-backups/main/s{index}.db", 5, age_days=40 + index)
        _write(f"backups/b{index}.db", 5, age_days=40 + index)

    plan = plan_cleanup(older_than_days=30)
    listed = {item["path"] for item in plan["candidates"]}

    assert "backups/.trash/r1.zip" in listed
    assert "auto-backups/main/s1.db" in listed
    # 同一个文件不会被列两次（.trash 走 backup-trash 这一类，backups 那一类不递归）。
    assert len(listed) == len(plan["candidates"]) == 4 + 4 + 1


def test_categories_select_only_the_named_kinds():
    _write("backups/.trash/r1.zip", 5, age_days=40)
    _write("auto-backups/main/s1.db", 6, age_days=40)
    _write("logs/old.log", 7, age_days=40)

    plan = plan_cleanup(older_than_days=30, categories={"logs"})

    assert [item["path"] for item in plan["candidates"]] == ["logs/old.log"]
    assert plan["totals"] == {"files": 1, "bytes": 7}
    # 未选中的类别仍然报出体积：弹窗里取消勾选后，用户还要看到这一堆有多少东西。
    assert plan["by_category"]["auto-backups"]["files"] == 1
    assert plan["by_category"]["logs"] == {"label": "运行日志", "files": 1, "bytes": 7}


def test_the_logs_category_points_at_the_directory_that_is_actually_written():
    """「运行日志」必须指 ``logs/``，不是 ``runtime/logs/``。

    这条是 2026-10 那处死路径的回归：``runtime/logs`` 从来没有人写（全后端不存在
    ``DATA_DIR / "runtime"`` 的写入点），但界面上「运行日志」指向它，于是用户点清理
    永远清不到东西；真正在滚动的 ``logs/backend.log``（+ 4 个轮转）反被标成「旧日志」。
    """
    live = _write("logs/backend.log.1", 11, age_days=40)
    dead = _write("runtime/logs/old.log", 13, age_days=40)

    plan = plan_cleanup(older_than_days=30)

    listed = {item["path"] for item in plan["candidates"]}
    assert "logs/backend.log.1" in listed
    assert "runtime/logs/old.log" not in listed, "无人写入的目录不该出现在清单里"
    assert dead.exists() and live.exists()
    # 类别表就是弹窗的选项表：不允许再出现一个指向空目录的类别。
    relative_paths = {category.relative for category in cleanup.CATEGORIES}
    assert "logs" in relative_paths
    assert "runtime/logs" not in relative_paths
    assert [item["key"] for item in plan["categories"]].count("logs") == 1
    assert "old-logs" not in [item["key"] for item in plan["categories"]]


def test_an_empty_category_set_cleans_nothing(client, data_dir):
    _write("logs/old.log", 8, age_days=40)

    plan = plan_cleanup(older_than_days=30, categories=set())
    assert plan["candidates"] == []
    assert plan["totals"] == {"files": 0, "bytes": 0}

    result = run_cleanup(older_than_days=30, categories=set())
    assert result["moved"] == 0 and result["freed_bytes"] == 0
    assert (data_dir / "logs/old.log").exists()

    # 接口层同样区分"没传 categories"（=全部）与"传了空"（=什么都不清）。
    preview = client.get("/api/stats/storage/cleanup-preview", params={"categories": ""})
    assert preview.status_code == 200 and preview.json()["totals"]["files"] == 0
    assert client.get("/api/stats/storage/cleanup-preview").json()["totals"]["files"] == 1
    response = client.post(
        "/api/stats/storage/cleanup", json={"older_than_days": 30, "categories": []}
    )
    assert response.status_code == 200 and response.json()["moved"] == 0
    assert (data_dir / "logs/old.log").exists()


def test_unknown_category_is_rejected_with_the_legal_values(client):
    response = client.post("/api/stats/storage/cleanup", json={"categories": ["bogus"]})

    assert response.status_code == 400
    detail = response.json()["detail"]
    for key in ("backups", "backup-trash", "auto-backups", "logs"):
        assert key in detail
    # 已退役的旧类别：要么被拒绝，要么被当成合法值——绝不允许"接受了但永远清不到东西"。
    assert "old-logs" not in detail

    preview = client.get("/api/stats/storage/cleanup-preview", params={"categories": "bogus"})
    assert preview.status_code == 400
    # 显式传退役类别同样被拒绝（而不是静默当成"全部"）。
    retired = client.get("/api/stats/storage/cleanup-preview", params={"categories": "old-logs"})
    assert retired.status_code == 400
    # 执行端与预览端同一口径：退役类别在 POST 上也是 400，不能"预览拒绝、执行照做"。
    retired_run = client.post("/api/stats/storage/cleanup", json={"categories": ["old-logs"]})
    assert retired_run.status_code == 400
    assert "old-logs" in retired_run.json()["detail"]
    # 400 的 detail 里要列出**当前**合法值，否则用户照着一个不存在的选项继续试。
    assert "logs" in retired_run.json()["detail"]


def test_preview_and_execute_honour_the_same_categories(client, data_dir):
    _write("logs/old.log", 12, age_days=60)
    trashed = _write("backups/.trash/old.zip", 9, age_days=60)

    preview = client.get("/api/stats/storage/cleanup-preview", params={"categories": "logs"})
    assert preview.status_code == 200
    assert [item["path"] for item in preview.json()["candidates"]] == ["logs/old.log"]

    result = client.post("/api/stats/storage/cleanup", json={"categories": ["logs"]})
    assert result.status_code == 200
    assert result.json()["moved"] == 1
    # 没选中的类别一个都没动；选中的那个已经移进回收目录。
    assert trashed.exists()
    assert not (data_dir / "logs/old.log").exists()


def test_preview_and_execute_agree(client):
    _write("logs/old.log", 32, age_days=60)

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

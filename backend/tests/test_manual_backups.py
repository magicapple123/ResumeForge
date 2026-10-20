# SPDX-License-Identifier: Apache-2.0
"""手动备份（backups/）的列表与可恢复删除（RF-25）。

删除的性质必须钉住：**移动到 backups/.trash/，绝不 unlink**；没有自动清理，
"全部删除"这类一键入口也不存在。
"""

import os
import shutil
from pathlib import Path

from app.database import engine

SNAPSHOT_NAME = "resume_forge-20260101-000000-123456.db"


def _make_backups_dir() -> Path:
    backups = Path(engine.url.database).parent / "backups"
    # conftest 只清表不清文件：上一个用例留在 backups/ 里的东西要在这里重置掉。
    shutil.rmtree(backups, ignore_errors=True)
    backups.mkdir(parents=True)
    return backups


def test_manual_backups_list_only_db_files(client):
    backups = _make_backups_dir()
    (backups / SNAPSHOT_NAME).write_bytes(b"x" * 500)
    (backups / "readme.txt").write_text("不是快照")
    (backups / ".trash").mkdir(exist_ok=True)
    (backups / ".trash" / "old.db").write_bytes(b"t")

    listed = client.get("/api/backups/manual")
    assert listed.status_code == 200
    payload = listed.json()
    assert [item["name"] for item in payload["items"]] == [SNAPSHOT_NAME]
    assert payload["items"][0]["size_bytes"] == 500
    assert payload["trashed_count"] == 1
    # GitHub Windows runner 上 pytest 临时目录可能出现 8.3 短路径名，而 API 侧
    # ``Path.resolve()`` 会展开成长路径——用 realpath + normcase 做等价比较。
    assert os.path.normcase(os.path.realpath(payload["directory"])) == os.path.normcase(
        os.path.realpath(str(backups))
    )


def test_trash_manual_backup_moves_file_never_deletes(client):
    backups = _make_backups_dir()
    (backups / SNAPSHOT_NAME).write_bytes(b"x" * 500)

    resp = client.delete(f"/api/backups/manual/{SNAPSHOT_NAME}")
    assert resp.status_code == 200
    assert resp.json()["size_bytes"] == 500
    # 可恢复：内容原样出现在 .trash/，原位置不再有。
    assert (backups / ".trash" / SNAPSHOT_NAME).read_bytes() == b"x" * 500
    assert not (backups / SNAPSHOT_NAME).exists()
    assert client.get("/api/backups/manual").json()["items"] == []


def test_trash_manual_backup_rejects_missing_and_traversal(client):
    _make_backups_dir()
    assert client.delete("/api/backups/manual/missing.db").status_code == 404
    # 路径穿越：斜进别的目录的请求要么路由不匹配、要么被名字校验挡下，一律 404。
    assert client.delete("/api/backups/manual/..%2Fresume_forge.db").status_code == 404
    assert client.delete("/api/backups/manual/.trash%5Cold.db").status_code == 404


def test_trash_manual_backup_same_name_gets_timestamped_copy(client):
    backups = _make_backups_dir()
    trash = backups / ".trash"
    trash.mkdir(exist_ok=True)
    (trash / SNAPSHOT_NAME).write_bytes(b"old")
    (backups / SNAPSHOT_NAME).write_bytes(b"new")

    assert client.delete(f"/api/backups/manual/{SNAPSHOT_NAME}").status_code == 200
    # 已有的 .trash 同名文件不被覆盖：用户上次移除的还找得回来。
    assert (trash / SNAPSHOT_NAME).read_bytes() == b"old"
    assert len(list(trash.iterdir())) == 2

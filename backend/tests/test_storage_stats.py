"""存储体积统计（RF-25）：分项体积、只 stat 不读内容、测试库目录隔离。"""

import os
import shutil
from pathlib import Path

from app.database import engine


def _reset_dir(path: Path) -> None:
    """统计目录会被同进程先跑的用例（如 user_files 附件测试）写满：先重置再断言精确值。"""
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)


def test_storage_overview_counts_directories_and_database(client):
    base = Path(engine.url.database).parent
    _reset_dir(base / "user_files")
    _reset_dir(base / "browser-profile")
    (base / "user_files" / "a.bin").write_bytes(b"x" * 1000)
    (base / "browser-profile" / "profile.bin").write_bytes(b"y" * 2000)

    data = client.get("/api/stats/storage")
    assert data.status_code == 200
    payload = data.json()
    items = {item["key"]: item for item in payload["items"]}

    # 数据库项至少包含主库文件本身（WAL 边车有多少算多少）。
    assert items["database"]["size_bytes"] >= Path(engine.url.database).stat().st_size
    assert items["user_files"]["size_bytes"] == 1000
    assert items["user_files"]["file_count"] == 1
    assert items["browser_profile"]["size_bytes"] == 2000
    # 不存在的目录算 0，而不是报错。
    assert items["captures"]["size_bytes"] == 0
    assert items["captures"]["file_count"] == 0
    # 汇总 >= 任何分项。
    assert payload["total_bytes"] >= 3000
    assert payload["total_file_count"] >= 2
    # GitHub Windows runner 上 pytest 临时目录可能出现 8.3 短路径名，而 API 侧
    # ``Path.resolve()`` 会展开成长路径——用 realpath + normcase 做等价比较。
    assert os.path.normcase(os.path.realpath(payload["data_dir"])) == os.path.normcase(
        os.path.realpath(str(base))
    )


def test_storage_overview_never_returns_file_contents(client):
    base = Path(engine.url.database).parent
    (base / "user_files").mkdir(exist_ok=True)
    (base / "user_files" / "secret.txt").write_text("机密内容")

    raw = client.get("/api/stats/storage").content.decode()
    assert "机密内容" not in raw

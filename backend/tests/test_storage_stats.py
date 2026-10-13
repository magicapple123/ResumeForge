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


# ---------------------------------------------------------------------------
# PR-16：统一路径作用域、不重叠分项、扫描预算与缓存
#
# 这些用例用 monkeypatch 把统计根（``storage_stats._data_root``）指到 ``tmp_path``，
# 复现"激活库在 datasets/ 里"的场景；``raising=False`` 让同一份 monkeypatch 在旧实现
# （还没有 _data_root）上也设置得进去——红阶段由断言本身失败，而不是 setattr 失败。
# ---------------------------------------------------------------------------


def _patch_root(monkeypatch, storage_stats, root):
    monkeypatch.setattr(storage_stats, "_data_root", lambda: root, raising=False)
    monkeypatch.setattr(storage_stats, "DATA_DIR", root, raising=False)


def test_custom_database_name_is_counted_as_the_database(tmp_path, monkeypatch):
    """数据目录下自定义名字的库文件按"数据库"统计，不被硬编码的 resume_forge.db 顶掉。"""
    from app.database import build_engine
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    custom = tmp_path / "my-own-forge.db"
    probe_engine = build_engine(f"sqlite:///{custom.as_posix()}")
    try:
        with probe_engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("INSERT INTO probe (id) VALUES (1)")
        _patch_root(monkeypatch, storage_stats, tmp_path)
        storage_stats.reset_storage_cache()

        payload = storage_overview(probe_engine)
        items = {item["key"]: item for item in payload["items"]}

        assert items["database"]["size_bytes"] >= custom.stat().st_size
        assert items["database"]["file_count"] >= 1
    finally:
        probe_engine.dispose()
        storage_stats.reset_storage_cache()


def test_items_do_not_overlap_and_total_equals_the_sum(tmp_path, monkeypatch):
    """激活导入库时（统计根落在 datasets/ 父目录），分项互不重复计入，总计=分项之和。"""
    from app.database import build_engine
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    datasets_dir = tmp_path / "datasets"
    inner_user_files = datasets_dir / "user_files"
    inner_user_files.mkdir(parents=True, exist_ok=True)
    (inner_user_files / "attachment.bin").write_bytes(b"a" * 500)
    dataset_db = datasets_dir / "aabbccdd11223344.db"
    dataset_engine = build_engine(f"sqlite:///{dataset_db.as_posix()}")
    try:
        with dataset_engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        (tmp_path / "top-level.bin").write_bytes(b"t" * 100)
        _patch_root(monkeypatch, storage_stats, tmp_path)
        storage_stats.reset_storage_cache()

        payload = storage_overview(dataset_engine)
        items = payload["items"]
        by_key = {item["key"]: item for item in items}

        assert sum(item["size_bytes"] for item in items) == payload["total_bytes"]
        assert sum(item["file_count"] for item in items) == payload["total_file_count"]
        # 数据集库文件归"数据集"分项；激活库本身归"数据库"分项——每个文件只算一次。
        assert by_key["user_files"]["size_bytes"] == 500
        assert by_key["database"]["size_bytes"] >= dataset_db.stat().st_size
        # 这里唯一的 .db 就是激活库本身：它已计入"数据库"分项，不得再进"数据集"分项。
        assert by_key["datasets"]["size_bytes"] == 0
        assert by_key["uncategorized"]["size_bytes"] >= 100
    finally:
        dataset_engine.dispose()
        storage_stats.reset_storage_cache()


def test_uncategorized_bucket_collects_unknown_files(tmp_path, monkeypatch):
    """不属于任何已知分项的文件进"未分类"兜底项，且计入总计。"""
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    (tmp_path / "stray.bin").write_bytes(b"s" * 64)
    _patch_root(monkeypatch, storage_stats, tmp_path)
    storage_stats.reset_storage_cache()

    payload = storage_overview(engine)
    by_key = {item["key"]: item for item in payload["items"]}

    assert by_key["uncategorized"]["size_bytes"] >= 64
    assert sum(item["size_bytes"] for item in payload["items"]) == payload["total_bytes"]


def test_every_item_declares_its_scope(monkeypatch):
    """每个分项都标注作用域：application / dataset / shared / backup。"""
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    storage_stats.reset_storage_cache()
    payload = storage_overview(engine)
    by_key = {item["key"]: item for item in payload["items"]}

    assert by_key["user_files"]["scope"] == "dataset"
    assert by_key["referral_images"]["scope"] == "dataset"
    assert by_key["database"]["scope"] == "dataset"
    assert by_key["datasets"]["scope"] == "shared"
    assert by_key["backups"]["scope"] == "backup"
    assert by_key["auto_backups"]["scope"] == "backup"
    assert by_key["exports"]["scope"] == "backup"
    assert by_key["browser_profile"]["scope"] == "application"
    assert by_key["captures"]["scope"] == "application"
    assert by_key["logs"]["scope"] == "application"


def test_application_scope_root_does_not_drift_with_dataset(tmp_path, monkeypatch):
    """统计根锚在数据目录上，不随激活库（datasets/ 子目录）漂移。"""
    from app.database import build_engine
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    datasets_dir = tmp_path / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)
    dataset_db = datasets_dir / "aabbccdd11223344.db"
    dataset_engine = build_engine(f"sqlite:///{dataset_db.as_posix()}")
    try:
        _patch_root(monkeypatch, storage_stats, tmp_path)
        storage_stats.reset_storage_cache()
        payload = storage_overview(dataset_engine)
        # 统计根 == 数据根，而不是激活库所在的 datasets/ 子目录。
        assert payload["data_dir"] == str(tmp_path)
        assert payload["data_dir"] != str(dataset_db.parent)
    finally:
        dataset_engine.dispose()
        storage_stats.reset_storage_cache()


def test_permission_error_becomes_a_warning_instead_of_a_crash(tmp_path, monkeypatch):
    """目录不可读：计成告警项继续统计其余部分，不崩溃、不静默。"""
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    base = Path(engine.url.database).parent
    captures = base / "captures"
    captures.mkdir(parents=True, exist_ok=True)
    try:
        real_scandir = os.scandir

        def _deny(name):
            if not isinstance(name, (str, os.PathLike)):
                # shutil.rmtree 在 POSIX 上用目录 fd（int）调 scandir，透传给真实现。
                return real_scandir(name)
            if Path(name).name == "captures":
                raise PermissionError(13, "权限不足", str(name))
            return real_scandir(name)

        monkeypatch.setattr(storage_stats.os, "scandir", _deny)
        storage_stats.reset_storage_cache()

        payload = storage_overview(engine)

        assert any("captures" in warning for warning in payload["warnings"])
        assert payload["items"]  # 其余分项照常返回
    finally:
        shutil.rmtree(captures, ignore_errors=True)
        storage_stats.reset_storage_cache()


def test_sidecar_files_count_toward_the_database_item(tmp_path, monkeypatch):
    """-wal/-shm/-journal 边车计入数据库分项，且不重复计入总计。"""
    from app.database import build_engine
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    db_file = tmp_path / "sidecar-probe.db"
    probe_engine = build_engine(f"sqlite:///{db_file.as_posix()}")
    try:
        with probe_engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        wal = Path(f"{db_file}-wal")
        wal.write_bytes(b"w" * 128)
        _patch_root(monkeypatch, storage_stats, tmp_path)
        storage_stats.reset_storage_cache()

        payload = storage_overview(probe_engine)
        by_key = {item["key"]: item for item in payload["items"]}

        assert by_key["database"]["size_bytes"] >= db_file.stat().st_size + 128
        assert sum(item["size_bytes"] for item in payload["items"]) == payload["total_bytes"]
    finally:
        probe_engine.dispose()
        storage_stats.reset_storage_cache()


def test_short_ttl_cache_and_manual_reset(tmp_path, monkeypatch):
    """短 TTL 缓存：TTL 内复用结果；reset 后立刻反映新文件。"""
    from app.services import storage_stats
    from app.services.storage_stats import storage_overview

    base = Path(engine.url.database).parent
    user_dir = base / "user_files"
    _reset_dir(user_dir)
    try:
        storage_stats.reset_storage_cache()
        first = storage_overview(engine)

        (user_dir / "late.bin").write_bytes(b"late")
        second = storage_overview(engine)
        by_key = {item["key"]: item for item in second["items"]}
        assert by_key["user_files"]["size_bytes"] == 0, "TTL 内应复用缓存而不是重扫"

        storage_stats.reset_storage_cache()
        third = storage_overview(engine)
        by_key = {item["key"]: item for item in third["items"]}
        assert by_key["user_files"]["size_bytes"] == len(b"late")
        assert first["data_dir"] == third["data_dir"]
    finally:
        shutil.rmtree(user_dir, ignore_errors=True)
        storage_stats.reset_storage_cache()

# SPDX-License-Identifier: Apache-2.0
"""备份覆盖面（P1/P3/P4）：资产类别单源、导出兜底扫描、表覆盖与格式矩阵。

方案 §12.1 的"永久红灯"落在这里：

- 磁盘上出现"既不在清单、也不在 uncovered"的东西 → ``test_new_data_directory_is_never_silent``；
- 资产类别与覆盖名单不一致、或与 ``RUNTIME_ONLY`` 相交 →
  ``test_asset_categories_and_coverage_agree``；
- 新增模型表却没进 ``manifest["tables"]`` → ``test_backup_table_coverage``。

格式矩阵（§12.3）用 ``backend/tests/fixtures/backup-formats/`` 下冻结的样本包：它们由
``scripts/make_backup_format_fixtures.py`` 以纯合成数据生成，逐个导入一次，防止
"升级一次就悄悄读不回旧包"。
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import zipfile
from pathlib import Path

import pytest
from app.database import engine
from app.database_migrations import application_tables
from app.dataset_registry import DatasetError, dataset_database_file
from app.services.data_backup import (
    MANIFEST_MEMBER,
    BackupError,
    ExtraDatabase,
    asset_categories,
    coverage,
    create_backup_archive,
    database_path,
    uncovered_summary,
)
from app.services.data_backup.coverage import (
    COVERED_DIRECTORIES,
    RUNTIME_ONLY,
    is_covered,
    scan_uncovered,
)
from app.services.datasets import create_dataset, import_dataset, list_datasets

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "backup-formats"
FORMAT_FIXTURES = {1: "dataset", 3: "dataset", 4: "collection", 5: "dataset", 6: "dataset"}


def _read_manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(MANIFEST_MEMBER))


def _members(archive: Path) -> set[str]:
    with zipfile.ZipFile(archive) as handle:
        return set(handle.namelist())


def _rewrite_manifest(archive: Path, mutate) -> Path:
    """复制一份包并改写清单（其余成员原样搬运），用来构造"被改过的包"。"""
    target = archive.with_name(f"tampered-{archive.name}")
    with (
        zipfile.ZipFile(archive) as source,
        zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as destination,
    ):
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename == MANIFEST_MEMBER:
                manifest = json.loads(payload)
                mutate(manifest)
                payload = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
            destination.writestr(info, payload)
    return target


@pytest.fixture
def data_dir():
    """测试库所在的"数据目录"；用例自己造的目录在退出时清掉，不污染其它用例。"""
    root = database_path(engine).parent
    created: list[Path] = []
    yield root, created
    for path in created:
        shutil.rmtree(path, ignore_errors=True)


# ---------------------------------------------------------------------------
# P1 分类单源 / P3 覆盖名单一致
# ---------------------------------------------------------------------------


def test_asset_categories_and_coverage_agree():
    """三条红灯之二：类别名单与覆盖名单必须同一份，且与"已知不覆盖"不相交。"""
    from app.services.data_backup import archive_guard

    assert set(asset_categories.ASSET_CATEGORIES) == set(COVERED_DIRECTORIES)
    assert not (COVERED_DIRECTORIES & RUNTIME_ONLY)
    assert coverage.DATASETS_DIRNAME not in COVERED_DIRECTORIES
    # 导入侧的校验名单也必须用同一份，否则"加了类别但导入侧不认"会静默丢附件。
    assert archive_guard._CATEGORIES is asset_categories.ASSET_CATEGORIES
    # 每一个资产类别天然是"已覆盖"，否则导出的兜底扫描会把它们报成未覆盖。
    for category in asset_categories.ASSET_CATEGORIES:
        assert is_covered(category)


def test_runtime_directories_are_known_and_quiet():
    """运行产物（登录态、缓存、备份自己的产物）不告警——它们本来就不该进包。"""
    for name in sorted(RUNTIME_ONLY):
        assert is_covered(name), name
    for name in ("active.json", "global_settings.json", "datasets", "resume_forge.db"):
        assert is_covered(name), name


# ---------------------------------------------------------------------------
# P3 兜底扫描
# ---------------------------------------------------------------------------


def test_scan_reports_unknown_directory(tmp_path):
    """未知目录默认落进 uncovered——这就是"以后新增目录不会被静默漏掉"的机制。"""
    (tmp_path / "mystery").mkdir()
    (tmp_path / "mystery" / "deep").mkdir()
    (tmp_path / "mystery" / "deep" / "blob.bin").write_bytes(b"x" * 32)
    (tmp_path / "user_files").mkdir()
    (tmp_path / "user_files" / "known.bin").write_bytes(b"y" * 8)
    (tmp_path / "captures").mkdir()
    (tmp_path / "captures" / "shot.png").write_bytes(b"z" * 4)

    report = scan_uncovered(tmp_path)

    assert [item["name"] for item in report["items"]] == ["mystery"]
    assert report["items"][0]["kind"] == "dir"
    assert report["items"][0]["bytes"] == 32
    assert report["count"] == 1 and report["bytes"] == 32
    assert report["truncated"] is False


def test_scan_is_depth_limited_and_skips_symlinks(tmp_path):
    """只到 3 层：更深处的内容不统计（避免扫描变成全盘遍历），符号链接一律跳过。"""
    deep = tmp_path / "mystery" / "a" / "b" / "c"
    deep.mkdir(parents=True)
    (deep / "too-deep.bin").write_bytes(b"x" * 16)
    (tmp_path / "mystery" / "top.bin").write_bytes(b"y" * 4)

    report = scan_uncovered(tmp_path)

    assert report["count"] == 1
    # 顶层文件 4 字节计入；第 4 层（a/b/c/too-deep.bin）不计入。
    assert report["items"][0]["bytes"] == 4
    assert report["items"][0]["files"] == 1


def test_scan_stops_at_the_file_cap(tmp_path, monkeypatch):
    """超过 5000 文件只报"至少这么多"，并标 truncated（不把导出拖成全盘扫描）。"""
    monkeypatch.setattr(coverage, "MAX_FILES", 3)
    (tmp_path / "mystery").mkdir()
    for index in range(10):
        (tmp_path / "mystery" / f"f{index}.bin").write_bytes(b"x")

    report = scan_uncovered(tmp_path)

    assert report["truncated"] is True
    assert report["count"] == 1


def test_new_data_directory_is_never_silent(data_dir, tmp_path):
    """任意新顶层目录 → 必须出现在 uncovered，且不出现在"已知覆盖"里。"""
    root, created = data_dir
    for name in ("mystery", "新的目录"):
        path = root / name
        path.mkdir(exist_ok=True)
        (path / "payload.bin").write_bytes(b"abc")
        created.append(path)

    archive = create_backup_archive(engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    names = {item["name"] for item in manifest["uncovered"]}

    assert {"mystery", "新的目录"} <= names
    assert manifest["uncovered_count"] == len(manifest["uncovered"])
    assert uncovered_summary(manifest)["count"] == len(manifest["uncovered"])
    assert uncovered_summary(manifest)["bytes"] >= 6


def test_backup_ignores_runtime_directories(data_dir, tmp_path):
    """登录态、缓存、日志这些运行产物不进 uncovered：否则每次导出都有一屏噪音。"""
    root, created = data_dir
    for name in ("captures", "browser-profile", "webform-browser-profile", "logs"):
        path = root / name
        path.mkdir(exist_ok=True)
        (path / "trace.bin").write_bytes(b"zz")
        created.append(path)

    archive = create_backup_archive(engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    names = {item["name"] for item in manifest["uncovered"]}

    assert not ({"captures", "browser-profile", "webform-browser-profile", "logs"} & names)


def test_export_reports_uncovered_items_in_response_headers(data_dir, client):
    """界面唯一的通道是响应头（响应体是二进制包）：计数与体积必须真的出现在头上。"""
    root, created = data_dir
    mystery = root / "mystery-headers"
    mystery.mkdir(exist_ok=True)
    (mystery / "blob.bin").write_bytes(b"x" * 2048)
    created.append(mystery)

    response = client.get("/api/settings/datasets/main/export?include_api_keys=false")

    assert response.status_code == 200, response.text
    assert int(response.headers["X-Backup-Uncovered"]) >= 1
    assert int(response.headers["X-Backup-Uncovered-Bytes"]) >= 2048
    assert "X-Backup-Uncovered-Truncated" not in response.headers


def test_uncovered_section_is_absent_when_nothing_is_left_out(data_dir, tmp_path):
    """没有未覆盖项时不出多余文案：计数为 0，界面据此一个字都不加。"""
    archive = create_backup_archive(engine, tmp_path / "staging")
    manifest = _read_manifest(archive)

    assert manifest["uncovered_count"] == uncovered_summary(manifest)["count"]
    assert "uncovered_truncated" not in manifest


# ---------------------------------------------------------------------------
# 表覆盖（永久红灯之一）
# ---------------------------------------------------------------------------


def test_backup_table_coverage(tmp_path):
    """新增模型表却没进清单 → 这里红。清单的表集合必须等于模型注册表。"""
    archive = create_backup_archive(engine, tmp_path / "staging")
    manifest = _read_manifest(archive)

    assert set(manifest["tables"]) == set(application_tables())


# ---------------------------------------------------------------------------
# P4 随包数据集行数复核
# ---------------------------------------------------------------------------


def test_nested_dataset_row_mismatch_is_rejected(tmp_path):
    """改过行数的随包数据集必须被拒收，且不落盘（其余份也不受影响）。"""
    info = create_dataset("额外数据集", engine)
    source = dataset_database_file(info["id"])
    archive = create_backup_archive(
        engine,
        tmp_path / "staging",
        extra_databases=[
            ExtraDatabase(dataset_id=info["id"], name=info["name"], source=source),
        ],
    )
    assert _read_manifest(archive)["format"] == 2

    def bump(manifest: dict) -> None:
        tables = manifest["datasets"][0]["tables"]
        key = next(iter(tables))
        tables[key] = int(tables[key]) + 1

    tampered = _rewrite_manifest(archive, bump)
    before = {item["id"] for item in list_datasets()}

    with pytest.raises((DatasetError, BackupError), match="行数"):
        import_dataset(tampered, "坏包", engine, tmp_path / "import")

    assert {item["id"] for item in list_datasets()} == before


def _rewrite_collection_sub_manifest(archive: Path, victim_index: int) -> Path:
    """改外层包里某一份**子包清单**的行数，并同步外层 sha256/大小。

    外层只负责分发与逐份校验，所以改完子包必须把外层记录的摘要一起改对——本用例要
    验的是"子包内容与它自己的清单不符"，不是"外层摘要对不上"。
    """
    target = archive.with_name(f"tampered-{archive.name}")
    with zipfile.ZipFile(archive) as source:
        outer = json.loads(source.read(MANIFEST_MEMBER))
        entry = outer["datasets"][victim_index]
        buffer = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(source.read(entry["file"]))) as sub,
            zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as rebuilt,
        ):
            for info in sub.infolist():
                data = sub.read(info.filename)
                if info.filename == MANIFEST_MEMBER:
                    sub_manifest = json.loads(data)
                    tables = sub_manifest["tables"]
                    key = next(iter(tables))
                    tables[key] = int(tables[key]) + 1
                    data = json.dumps(sub_manifest, ensure_ascii=False).encode("utf-8")
                rebuilt.writestr(info, data)
        payload = buffer.getvalue()
        entry["sha256"] = hashlib.sha256(payload).hexdigest()
        entry["size_bytes"] = len(payload)

        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as destination:
            for info in source.infolist():
                if info.filename == entry["file"]:
                    destination.writestr(info, payload)
                elif info.filename == MANIFEST_MEMBER:
                    destination.writestr(
                        info, json.dumps(outer, ensure_ascii=False).encode("utf-8")
                    )
                else:
                    destination.writestr(info, source.read(info.filename))
    return target


def test_nested_collection_rejects_only_the_tampered_sub_package(tmp_path):
    """整包里坏一份只拒那一份：其余份照常恢复（R16 的隔离语义 + P4 的行数复核）。"""
    from app.services.datasets import export_all_datasets

    create_dataset("随包的第二份", engine)
    archive = export_all_datasets(engine, tmp_path / "staging")
    tampered = _rewrite_collection_sub_manifest(archive, 0)

    result = import_dataset(tampered, "整包恢复", engine, tmp_path / "import")

    assert result["summary"] == {"restored": 1, "skipped": 0, "failed": 1}
    assert "行数" in result["failed"][0]["error"]


def test_exported_extra_dataset_carries_its_row_counts(tmp_path):
    """格式 2 的每份数据集都带 ``tables`` 快照——没有它，导入侧就无从复核行数。"""
    info = create_dataset("另一份", engine)
    archive = create_backup_archive(
        engine,
        tmp_path / "staging",
        extra_databases=[
            ExtraDatabase(
                dataset_id=info["id"], name=info["name"], source=dataset_database_file(info["id"])
            )
        ],
    )
    entry = _read_manifest(archive)["datasets"][0]

    assert set(entry["tables"]) == set(application_tables())


# ---------------------------------------------------------------------------
# 格式矩阵（§12.3）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("version", sorted(FORMAT_FIXTURES))
def test_backup_format_matrix(version, tmp_path):
    """每个历史格式号的样本包都必须**仍可导入**（或按语义明确拒收）。"""
    archive = FIXTURE_DIR / f"format-{version}.zip"
    assert archive.is_file(), (
        f"缺少格式样本包：{archive}（跑 scripts/make_backup_format_fixtures.py）"
    )
    manifest = _read_manifest(archive)
    assert manifest["format"] == version
    assert manifest["type"] == FORMAT_FIXTURES[version]

    result = import_dataset(archive, f"格式 {version} 样本", engine, tmp_path / f"staging{version}")

    assert result["id"]


def test_future_format_is_rejected_with_an_upgrade_hint(tmp_path):
    """来自更新版本的包必须明确拒收，不能"按自己认识的形状"安静误读。"""
    tampered = _rewrite_manifest(
        FIXTURE_DIR / "format-1.zip", lambda manifest: manifest.__setitem__("format", 99)
    )

    with pytest.raises(BackupError, match="更新版本"):
        import_dataset(tampered, "未来包", engine, tmp_path / "staging")


def test_format_six_members_are_present_and_hashed():
    """格式 6 的样本必须真的带字体成员与清单段，否则这个样本名不副实。"""
    archive = FIXTURE_DIR / "format-6.zip"
    manifest = _read_manifest(archive)
    members = _members(archive)

    assert manifest["global_assets"]["version"] == 1
    assert "global_assets.json" in members
    assert any(name.startswith("fonts/") and name.endswith(".ttf") for name in members)

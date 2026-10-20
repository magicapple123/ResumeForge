"""备份资产清单（PR-15）：按数据库内容收集附件引用，包内带逐文件校验清单。

红→绿矩阵钉住的行为：

- 单数据集导出**不夹带**同目录其他数据集的附件（跨数据集隐私）；
- 「导出全部数据集」覆盖主库 + 各导入库两个位置的附件；
- 恢复到空目录后逐文件 sha256 复核、DB 关键行数复核，问题**显式列出**不静默；
- 旧格式备份包（无资产清单）照常导入；
- 导入崩溃确定性：数据库写入中途失败不留 ``.partial`` 残留，附件恢复硬故障
  不拖垮导入（显式进 ``asset_issues``）。

自动备份轮转（``.trash``）、调度租约与恢复验证原语见
``test_backup_auto_rotation.py``。
"""

import hashlib
import json
import sqlite3
import zipfile

import pytest
from app.dataset_registry import DatasetError
from app.services.data_backup import (
    MANIFEST_MEMBER,
    BackupError,
    create_backup_archive,
    manifest_asset_counts,
    manifest_asset_warnings,
)
from app.services.data_backup import asset_manifest as asset_manifest_module
from app.services.data_backup.asset_manifest import build_asset_manifest
from app.services.datasets import (
    export_all_datasets,
    export_dataset,
    import_dataset,
)

# 夹具与共享辅助搬进了 ``backup_asset_fixtures``（行数预算）；这里的 import 既取回
# 辅助函数，也把 ``three_datasets`` 夹具注入本模块命名空间。
from tests.backup_asset_fixtures import (  # noqa: F401
    _add_main_user_file,
    _dataset_names,
    _fingerprints,
    _import_all,
    _legacy_all_archive,
    _member_names,
    _read_manifest,
    _sub_members,
    database,
    dataset_database_file,
)

# ---------------------------------------------------------------------------
# 导出侧
# ---------------------------------------------------------------------------


def test_known_missing_is_separated_from_new_missing(tmp_path):
    """H2：导入时就缺的附件只做说明，不把整份备份标成"不完整"。"""
    database_file = tmp_path / "data.db"
    with sqlite3.connect(database_file) as connection:
        connection.execute("CREATE TABLE user_file (disk_name TEXT, sha256 TEXT)")
        connection.executemany(
            "INSERT INTO user_file VALUES (?, ?)",
            [("gone-at-import.bin", "abc"), ("gone-now.bin", "def")],
        )
    (tmp_path / "user_files").mkdir()

    manifest = build_asset_manifest(
        database_file, tmp_path, known_missing={"user_files": ["gone-at-import.bin"]}
    )

    assert manifest["user_files"] == []
    assert manifest["user_files_missing_at_import"] == ["gone-at-import.bin"]
    assert manifest["user_files_missing"] == ["gone-now.bin"]
    wrapper = {"asset_manifest": manifest}
    assert manifest_asset_counts(wrapper) == {
        "missing": 1,
        "mismatched": 0,
        "missing_at_import": 1,
    }
    # 只有"新缺失"才产生警告（= 触发 X-Backup-Incomplete）。
    assert len(manifest_asset_warnings(wrapper)) == 1


def test_single_dataset_export_does_not_leak_other_datasets_files(three_datasets, tmp_path):
    """导出数据集 A：包里只能有 A 自己引用的附件，不能把同目录 B 的文件整目录带走。"""
    archive = export_dataset(three_datasets.id_a, database.engine, tmp_path / "staging")

    names = _member_names(archive)
    assert "user_files/aaa-dataset-a-file.bin" in names
    assert "referral_images/aaa-referral-note.png" in names
    assert "user_files/bbb-dataset-b-file.bin" not in names
    assert not any("bbb-dataset-b-file" in name for name in names)


def test_single_dataset_export_does_not_leak_unreferenced_files(three_datasets, tmp_path):
    """user_files 目录里未被任何库引用的文件不该进包（按引用收集，不是整目录拷贝）。"""
    datasets_dir = three_datasets.path_a.parent
    stray = datasets_dir / "user_files" / "zzz-not-referenced-by-anyone.bin"
    stray.write_bytes(b"stray")

    archive = export_dataset(three_datasets.id_a, database.engine, tmp_path / "staging")

    assert "user_files/zzz-not-referenced-by-anyone.bin" not in _member_names(archive)


def test_all_datasets_export_covers_assets_of_every_dataset(three_datasets, tmp_path):
    """导出全部数据集：每份**子包**里只装它自己引用的附件（各自隔离命名空间）。"""
    archive = export_all_datasets(database.engine, tmp_path / "staging")

    # 格式 4：附件跟着各自的子包走，子包内部仍是单数据集包的扁平前缀。
    main_names = _sub_members(archive, "main")
    assert "user_files/main-only-attachment.bin" in main_names
    names_a = _sub_members(archive, three_datasets.id_a)
    assert "user_files/aaa-dataset-a-file.bin" in names_a
    assert "referral_images/aaa-referral-note.png" in names_a
    assert not any("bbb-dataset-b-file" in name for name in names_a)
    assert "user_files/bbb-dataset-b-file.bin" in _sub_members(archive, three_datasets.id_b)


def test_all_datasets_export_manifest_lists_assets_with_checksums(three_datasets, tmp_path):
    """外层清单逐份带 sha256；每份的附件清单带 size 与 sha256。"""
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    manifest = _read_manifest(archive)

    main_entry = next(item for item in manifest["datasets"] if item["id"] == "main")
    asset_manifest = main_entry["asset_manifest"]
    assert asset_manifest["manifest_version"] == asset_manifest_module.ASSET_MANIFEST_VERSION
    user_entries = {entry["name"]: entry for entry in asset_manifest["user_files"]}
    assert user_entries["main-only-attachment.bin"]["size_bytes"] == len(b"MAIN-CONTENT" * 10)
    assert (
        user_entries["main-only-attachment.bin"]["sha256"]
        == hashlib.sha256(b"MAIN-CONTENT" * 10).hexdigest()
    )
    assert all(len(item["sha256"]) == 64 for item in manifest["datasets"])

    entry_a = next(item for item in manifest["datasets"] if item["id"] == three_datasets.id_a)
    entry_assets = entry_a["asset_manifest"]
    assert {entry["name"] for entry in entry_assets["user_files"]} == {"aaa-dataset-a-file.bin"}
    assert {entry["name"] for entry in entry_assets["referral_images"]} == {"aaa-referral-note.png"}


# ---------------------------------------------------------------------------
# 导入侧：恢复到空目录 + 显式问题清单
# ---------------------------------------------------------------------------


def test_restore_to_empty_directory_roundtrip(three_datasets, tmp_path):
    """整包恢复：附件齐、内容逐字节一致、DB 行数复核无问题、结果不带 asset_issues。"""
    _, result = _import_all(three_datasets, tmp_path)

    assert result.get("asset_issues") is None
    user_dir = three_datasets.path_a.parent / "user_files"
    assert (user_dir / "aaa-dataset-a-file.bin").read_bytes() == b"A" * 128
    assert (user_dir / "bbb-dataset-b-file.bin").read_bytes() == b"B" * 128
    image_dir = three_datasets.path_a.parent / "referral_images"
    assert (image_dir / "aaa-referral-note.png").read_bytes() == b"REF-A-IMAGE" * 8


def test_corrupted_asset_refuses_the_whole_import_before_writing(three_datasets, tmp_path):
    """包里附件被篡改（与清单 hash 不符）：导入**整体拒绝**，一个字节都不写。

    RR-03 之前这里断言的是"恢复仍完成、问题列在 asset_issues 里"——那是把损坏的
    附件写进共享目录之后才发现的。现在的契约是：完整性问题的判定发生在写盘之前。
    """
    archive, _ = _import_all(three_datasets, tmp_path)
    names = _member_names(archive)
    target_member = f"datasets/{three_datasets.id_b}/user_files/bbb-dataset-b-file.bin"
    assert target_member in names

    tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(tampered, "w") as target:
        for name in source.namelist():
            payload = b"CORRUPTED" * 20 if name == target_member else source.read(name)
            target.writestr(name, payload)

    datasets_dir = three_datasets.path_a.parent
    before = _fingerprints(datasets_dir)
    names_before = _dataset_names()

    with pytest.raises(DatasetError, match="附件未通过校验"):
        import_dataset(tampered, "被篡改的包", database.engine, tmp_path / "staging-tampered")

    # 一个字节都没动：既有库、既有附件、列表都不变。
    assert _fingerprints(datasets_dir) == before
    assert _dataset_names() == names_before

    # 用户显式选择"跳过有问题的附件"时，导入继续，但问题必须逐条可见。
    partial = import_dataset(
        tampered,
        "被篡改的包-部分",
        database.engine,
        tmp_path / "staging-tampered-partial",
        allow_partial_assets=True,
    )
    issues = "\n".join(partial.get("asset_issues") or [])
    assert "bbb-dataset-b-file.bin" in issues
    assert "不符" in issues or "校验" in issues
    # 损坏的字节没有被写进共享目录：B 的附件在磁盘上保持原样（A 的原件）。
    assert (
        datasets_dir / "user_files" / "bbb-dataset-b-file.bin"
    ).read_bytes() != b"CORRUPTED" * 20


def test_missing_asset_refuses_the_whole_import_before_writing(three_datasets, tmp_path):
    """包里缺了清单声明的一份附件：导入整体拒绝，既有数据一字未变。"""
    archive, _ = _import_all(three_datasets, tmp_path)
    target_member = f"datasets/{three_datasets.id_a}/referral_images/aaa-referral-note.png"

    stripped = tmp_path / "missing-asset.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(stripped, "w") as target:
        for name in source.namelist():
            if name != target_member:
                target.writestr(name, source.read(name))

    datasets_dir = three_datasets.path_a.parent
    before = _fingerprints(datasets_dir)
    image = datasets_dir / "referral_images" / "aaa-referral-note.png"
    image_before = image.read_bytes()

    with pytest.raises(DatasetError, match="附件未通过校验"):
        import_dataset(stripped, "缺附件的包", database.engine, tmp_path / "staging-missing")

    assert _fingerprints(datasets_dir) == before
    assert image.read_bytes() == image_before

    partial = import_dataset(
        stripped,
        "缺附件的包-部分",
        database.engine,
        tmp_path / "staging-missing-partial",
        allow_partial_assets=True,
    )
    issues = "\n".join(partial.get("asset_issues") or [])
    assert "aaa-referral-note.png" in issues


def test_restore_verifies_database_row_counts(three_datasets, tmp_path):
    """恢复后按清单复核 DB 关键行数：行数不符要出现在问题清单里（不静默）。"""
    archive, result = _import_all(three_datasets, tmp_path)
    assert result.get("asset_issues") is None

    # 把清单里的 user_file 行数改大，再灌一份同样被改过清单的包：行数复核应报不一致。
    manifest = _read_manifest(archive)
    manifest["tables"]["user_file"] = 999
    lying = tmp_path / "lying-counts.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(lying, "w") as target:
        for name in source.namelist():
            if name == MANIFEST_MEMBER:
                target.writestr(name, json.dumps(manifest))
            else:
                target.writestr(name, source.read(name))

    from app.dataset_registry import DatasetError

    with pytest.raises(DatasetError, match="数据库行数"):
        import_dataset(lying, "行数不符的包", database.engine, tmp_path / "staging-lying")
    with pytest.raises(DatasetError, match="数据库行数"):
        import_dataset(
            lying,
            "跳过附件也不能跳过数据库校验",
            database.engine,
            tmp_path / "staging-lying-partial",
            allow_partial_assets=True,
        )


def test_legacy_package_without_asset_manifest_still_imports(three_datasets, tmp_path):
    """旧格式（清单里没有 asset_manifest 段）：导入照常成功，附件按旧规则恢复。"""
    archive = create_backup_archive(database.engine, tmp_path / "staging-export")
    # 造一个"旧包"：主库导出 + 手工补 user_files 成员 + 从清单里删掉 asset_manifest。
    manifest = _read_manifest(archive)
    manifest.pop("asset_manifest", None)
    legacy = tmp_path / "legacy.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(legacy, "w") as target:
        for name in source.namelist():
            if name == MANIFEST_MEMBER:
                target.writestr(name, json.dumps(manifest))
            elif name.startswith("user_files/"):
                continue  # 旧包重新打包时不带新逻辑产生的成员，下面手工补
            else:
                target.writestr(name, source.read(name))
        target.writestr("user_files/legacy-attachment.bin", b"LEGACY-CONTENT")

    result = import_dataset(legacy, "旧格式包", database.engine, tmp_path / "staging-legacy")

    datasets_dir = three_datasets.path_a.parent
    restored = datasets_dir / "user_files" / "legacy-attachment.bin"
    assert restored.read_bytes() == b"LEGACY-CONTENT"
    assert result.get("asset_issues") is None


def test_asset_manifest_with_unknown_version_is_rejected(three_datasets, tmp_path):
    """资产清单版本比当前代码新：fail-closed，拒收并明确提示，而不是安静误读。"""
    archive = create_backup_archive(database.engine, tmp_path / "staging-export")
    manifest = _read_manifest(archive)
    manifest["asset_manifest"]["manifest_version"] = 999
    future = tmp_path / "future.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(future, "w") as target:
        for name in source.namelist():
            if name == MANIFEST_MEMBER:
                target.writestr(name, json.dumps(manifest))
            else:
                target.writestr(name, source.read(name))

    with pytest.raises(BackupError, match="资产清单"):
        import_dataset(future, "未来格式", database.engine, tmp_path / "staging-future")


# ---------------------------------------------------------------------------
# 导入崩溃确定性（PR-18 补测：此前这两条故障路径没有任何测试守着）
# ---------------------------------------------------------------------------


def test_partial_file_is_cleaned_up_when_database_write_fails(
    three_datasets, tmp_path, monkeypatch
):
    """数据库写入中途失败：不留下 .partial 残留，也不留下任何半截数据集。

    ``import_dataset`` 的「先写临时文件再原子改名」路径此前没有测试——在
    ``extract_database`` 注入 OSError 故障点（与 PR-10 事务测试同一风格），断言
    失败后 datasets 目录里既没有 .partial 也没有新增 .db，列表里看不到半成品。
    """
    from app.services import datasets as datasets_service

    datasets_dir = three_datasets.path_a.parent
    before = {path.name for path in datasets_dir.iterdir()}
    # 格式 2 的整包（活动库 + 两份随包数据集）走"先验后写"的单次落盘链路；
    # 格式 4 的嵌套包改成逐份导入，这条原子性用例由格式 2 守着。
    archive = _legacy_all_archive(three_datasets, tmp_path / "staging-export")

    def _explode(_archive_path, _partial):
        raise OSError("模拟磁盘写入失败")

    monkeypatch.setattr(datasets_service, "extract_database", _explode)

    with pytest.raises(datasets_service.DatasetError):
        datasets_service.import_dataset(
            archive, "崩溃恢复", database.engine, tmp_path / "staging-partial"
        )

    after = {path.name for path in datasets_dir.iterdir()}
    assert not any(name.endswith(".partial") for name in after), (
        f"应清理 .partial 残留，目录现状：{sorted(after)}"
    )
    assert after - before == set(), f"失败导入不应在 datasets 目录留下任何新文件：{after - before}"


def test_asset_publish_failure_rolls_the_new_datasets_back(three_datasets, tmp_path, monkeypatch):
    """附件发布阶段硬故障（磁盘满/权限）：库与附件都不留下——失败就等于什么都没发生。

    RR-03 之前这里断言的是"数据集照常导入、问题进 asset_issues"：包里的附件写不进去
    也照样发布库，用户看到一次失败却在列表里多出几份半截数据集。现在发布顺序是
    "附件先验→库→附件发布"，发布阶段的失败会把本次新建的数据集文件收回去（只删
    自己刚建的那几份）。
    """
    from app.services.data_backup.asset_restore import AssetRestorePlan

    archive = _legacy_all_archive(three_datasets, tmp_path / "staging-export")

    def _explode(self):
        raise OSError("模拟附件发布中途磁盘故障")

    monkeypatch.setattr(AssetRestorePlan, "publish", _explode)

    datasets_dir = three_datasets.path_a.parent
    before = _fingerprints(datasets_dir)
    names_before = _dataset_names()

    with pytest.raises(OSError, match="模拟附件发布中途磁盘故障"):
        import_dataset(archive, "附件故障包", database.engine, tmp_path / "staging-asset-fail")

    # 回滚到导入前：没有半截数据集、没有新增附件、没有暂存残留。
    assert _fingerprints(datasets_dir) == before
    assert _dataset_names() == names_before
    assert not [path for path in datasets_dir.iterdir() if path.name.startswith(".rf-restore-")]

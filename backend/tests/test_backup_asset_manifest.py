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
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from app import database
from app.database import build_engine, database_url_for
from app.dataset_registry import dataset_database_file
from app.models.referral import Referral
from app.models.user_file import UserFile
from app.services.data_backup import (
    MANIFEST_MEMBER,
    BackupError,
    create_backup_archive,
    database_path,
)
from app.services.data_backup import asset_manifest as asset_manifest_module
from app.services.datasets import (
    create_dataset,
    export_all_datasets,
    export_dataset,
    import_dataset,
)
from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# 夹具：临时根下主库 + 两个导入库（A、B），各带内容可区分的合成附件。
# ---------------------------------------------------------------------------


def _add_user_file(dataset_db: Path, disk_name: str, content: bytes) -> None:
    """往一份数据集库里登记一条 user_file 行，并把内容写到该库同目录 user_files/。"""
    engine = build_engine(database_url_for(dataset_db))
    try:
        with Session(engine) as session:
            session.add(
                UserFile(
                    sha256=hashlib.sha256(content).hexdigest(),
                    disk_name=disk_name,
                    original_name=disk_name,
                    mime="application/octet-stream",
                    size=len(content),
                    source_type="test",
                    source_ref="test:asset-manifest",
                )
            )
            session.commit()
    finally:
        engine.dispose()
    directory = dataset_db.parent / "user_files"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / disk_name).write_bytes(content)


def _add_referral_image(dataset_db: Path, image_name: str, content: bytes) -> None:
    """往一份数据集库里登记一条 referral.note_images 引用，并落盘对应图片。"""
    engine = build_engine(database_url_for(dataset_db))
    try:
        with Session(engine) as session:
            session.add(Referral(note_images=[f"referral_images/{image_name}"]))
            session.commit()
    finally:
        engine.dispose()
    directory = dataset_db.parent / "referral_images"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / image_name).write_bytes(content)


def _add_main_user_file(db_session, disk_name: str, content: bytes) -> None:
    """主库（当前活动测试库）的 user_file 行 + 磁盘副本。"""
    db_session.add(
        UserFile(
            sha256=hashlib.sha256(content).hexdigest(),
            disk_name=disk_name,
            original_name=disk_name,
            mime="application/octet-stream",
            size=len(content),
            source_type="test",
            source_ref="test:asset-manifest",
        )
    )
    db_session.commit()
    directory = database_path(database.engine).parent / "user_files"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / disk_name).write_bytes(content)


@pytest.fixture()
def three_datasets(db_session):
    """主库 + 数据集 A、B：每个库都有自己独特的附件，且 A 另有一张内推备注图。"""
    dataset_a = create_dataset("数据集A", database.engine)
    dataset_b = create_dataset("数据集B", database.engine)
    path_a = dataset_database_file(dataset_a["id"])
    path_b = dataset_database_file(dataset_b["id"])

    main_file = database_path(database.engine).parent / "user_files" / "main-only-attachment.bin"
    _add_main_user_file(db_session, "main-only-attachment.bin", b"MAIN-CONTENT" * 10)
    _add_user_file(path_a, "aaa-dataset-a-file.bin", b"A" * 128)
    _add_user_file(path_b, "bbb-dataset-b-file.bin", b"B" * 128)
    _add_referral_image(path_a, "aaa-referral-note.png", b"REF-A-IMAGE" * 8)
    try:
        yield SimpleNamespace(
            id_a=dataset_a["id"], id_b=dataset_b["id"], path_a=path_a, path_b=path_b
        )
    finally:
        # 主库父目录（进程级测试根）不在 conftest 的数据集清理范围内，自己收尾。
        main_file.unlink(missing_ok=True)


def _member_names(archive_path: Path) -> set[str]:
    with zipfile.ZipFile(archive_path) as archive:
        return set(archive.namelist())


def _read_manifest(archive_path: Path) -> dict:
    with zipfile.ZipFile(archive_path) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


# ---------------------------------------------------------------------------
# 导出侧
# ---------------------------------------------------------------------------


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
    """导出全部数据集：主库 + A + B 的附件都要在包里（各自隔离命名空间）。"""
    archive = export_all_datasets(database.engine, tmp_path / "staging")

    names = _member_names(archive)
    # 主库附件仍在老位置（老版本可读）。
    assert "user_files/main-only-attachment.bin" in names
    # A、B 的附件在各自 datasets/<id>/ 前缀下，互不混装。
    assert f"datasets/{three_datasets.id_a}/user_files/aaa-dataset-a-file.bin" in names
    assert f"datasets/{three_datasets.id_a}/referral_images/aaa-referral-note.png" in names
    assert f"datasets/{three_datasets.id_b}/user_files/bbb-dataset-b-file.bin" in names


def test_all_datasets_export_manifest_lists_assets_with_checksums(three_datasets, tmp_path):
    """清单里逐文件带 size 与 sha256，且显式标 manifest_version。"""
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    manifest = _read_manifest(archive)

    asset_manifest = manifest["asset_manifest"]
    assert asset_manifest["manifest_version"] == asset_manifest_module.ASSET_MANIFEST_VERSION
    user_entries = {entry["name"]: entry for entry in asset_manifest["user_files"]}
    assert user_entries["main-only-attachment.bin"]["size_bytes"] == len(b"MAIN-CONTENT" * 10)
    assert (
        user_entries["main-only-attachment.bin"]["sha256"]
        == hashlib.sha256(b"MAIN-CONTENT" * 10).hexdigest()
    )

    entry_a = next(item for item in manifest["datasets"] if item["id"] == three_datasets.id_a)
    entry_assets = entry_a["asset_manifest"]
    assert {entry["name"] for entry in entry_assets["user_files"]} == {"aaa-dataset-a-file.bin"}
    assert {entry["name"] for entry in entry_assets["referral_images"]} == {"aaa-referral-note.png"}


# ---------------------------------------------------------------------------
# 导入侧：恢复到空目录 + 显式问题清单
# ---------------------------------------------------------------------------


def _import_all(three_datasets, tmp_path):
    archive = export_all_datasets(database.engine, tmp_path / "staging-export")
    result = import_dataset(archive, "整包恢复", database.engine, tmp_path / "staging-import")
    return archive, result


def test_restore_to_empty_directory_roundtrip(three_datasets, tmp_path):
    """整包恢复：附件齐、内容逐字节一致、DB 行数复核无问题、结果不带 asset_issues。"""
    _, result = _import_all(three_datasets, tmp_path)

    assert result.get("asset_issues") is None
    user_dir = three_datasets.path_a.parent / "user_files"
    assert (user_dir / "aaa-dataset-a-file.bin").read_bytes() == b"A" * 128
    assert (user_dir / "bbb-dataset-b-file.bin").read_bytes() == b"B" * 128
    image_dir = three_datasets.path_a.parent / "referral_images"
    assert (image_dir / "aaa-referral-note.png").read_bytes() == b"REF-A-IMAGE" * 8


def test_restore_reports_a_corrupted_asset_explicitly(three_datasets, tmp_path):
    """包里附件被篡改：恢复仍完成，但结果必须显式列出问题，不许静默成功。"""
    archive, _ = _import_all(three_datasets, tmp_path)
    names = _member_names(archive)
    target_member = f"datasets/{three_datasets.id_b}/user_files/bbb-dataset-b-file.bin"
    assert target_member in names

    tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(tampered, "w") as target:
        for name in source.namelist():
            payload = b"CORRUPTED" * 20 if name == target_member else source.read(name)
            target.writestr(name, payload)

    result = import_dataset(tampered, "被篡改的包", database.engine, tmp_path / "staging-tampered")

    issues = "\n".join(result.get("asset_issues") or [])
    assert "bbb-dataset-b-file.bin" in issues
    # 大小不符 / hash 不符 / 缺失，三种显式报告形态都算数——关键是"不许静默"。
    assert "不符" in issues or "校验" in issues or "缺少" in issues


def test_restore_reports_a_missing_asset_explicitly(three_datasets, tmp_path):
    """包里缺了清单声明的一份附件：导入结果必须显式点名，不静默。"""
    archive, _ = _import_all(three_datasets, tmp_path)
    target_member = f"datasets/{three_datasets.id_a}/referral_images/aaa-referral-note.png"

    stripped = tmp_path / "missing-asset.zip"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(stripped, "w") as target:
        for name in source.namelist():
            if name != target_member:
                target.writestr(name, source.read(name))

    result = import_dataset(stripped, "缺附件的包", database.engine, tmp_path / "staging-missing")

    issues = "\n".join(result.get("asset_issues") or [])
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

    lying_result = import_dataset(
        lying, "行数不符的包", database.engine, tmp_path / "staging-lying"
    )

    issues = "\n".join(lying_result.get("asset_issues") or [])
    assert "user_file" in issues


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
    archive = export_all_datasets(database.engine, tmp_path / "staging-export")

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


def test_asset_restore_hard_failure_does_not_sink_the_import(three_datasets, tmp_path, monkeypatch):
    """附件恢复的硬故障（OSError）：数据集本身照常导入，问题显式进 asset_issues。

    ``restore_assets_from_manifest`` 复制中途的 OSError（磁盘满/权限）由
    ``import_dataset`` 兜住转成 ``asset_issues``（"附件恢复失败：…"）——这条
    except 分支此前没有测试。契约：附件故障**不拖垮**数据集导入，但必须可见。
    """
    from app.services import datasets as datasets_service

    archive = export_all_datasets(database.engine, tmp_path / "staging-export")
    real_restore = datasets_service.restore_assets_from_manifest

    def _restore_then_fail(archive_path, asset_manifest, *, prefixes, destinations):
        # 只让「活动数据集」段（扁平前缀）失败：随包数据集段照常走真实现。
        if prefixes["user_files"].endswith("user_files/") and "/" not in prefixes[
            "user_files"
        ].rstrip("/"):
            raise OSError("模拟附件恢复中途磁盘故障")
        return real_restore(
            archive_path, asset_manifest, prefixes=prefixes, destinations=destinations
        )

    monkeypatch.setattr(datasets_service, "restore_assets_from_manifest", _restore_then_fail)

    result = import_dataset(archive, "附件故障包", database.engine, tmp_path / "staging-asset-fail")

    issues = "\n".join(result.get("asset_issues") or [])
    assert "附件恢复失败" in issues, issues
    assert "模拟附件恢复中途磁盘故障" in issues, issues
    # 数据集本身照常可用：导入结果在列表里可见。
    names = {item["name"] for item in datasets_service.list_datasets()}
    assert "附件故障包" in names

"""备份恢复的先验后发布与冲突语义（RR-03）——从 ``test_backup_asset_manifest.py``
拆出（行数预算）；夹具体现在 ``tests/backup_asset_fixtures.py``，用例原样搬迁。
"""

import hashlib
import zipfile

import pytest
from app.dataset_registry import DatasetError
from app.models.user_file import UserFile
from app.services.data_backup import create_backup_archive
from app.services.datasets import export_all_datasets, import_dataset
from tests.backup_asset_fixtures import (
    _dataset_names,
    _fingerprints,
    _import_all,
    _read_manifest,
    database,
    database_path,
)

# ---------------------------------------------------------------------------
# RR-03：附件"先验后发布"、冲突不覆盖、导出侧如实标记
# ---------------------------------------------------------------------------


def test_conflicting_local_asset_is_never_overwritten(three_datasets, tmp_path):
    """本机同名但内容不同的附件：默认整体拒绝；显式跳过后也**绝不覆盖**本机文件。"""
    archive, _ = _import_all(three_datasets, tmp_path)
    datasets_dir = three_datasets.path_a.parent
    victim = datasets_dir / "user_files" / "aaa-dataset-a-file.bin"
    victim.write_bytes(b"LOCAL-EDITED-CONTENT")

    with pytest.raises(DatasetError, match="附件未通过校验"):
        import_dataset(archive, "冲突包", database.engine, tmp_path / "staging-conflict")
    assert victim.read_bytes() == b"LOCAL-EDITED-CONTENT", "被拒绝的导入不能改动本机文件"

    result = import_dataset(
        archive,
        "冲突包-部分",
        database.engine,
        tmp_path / "staging-conflict-partial",
        allow_partial_assets=True,
    )
    assert victim.read_bytes() == b"LOCAL-EDITED-CONTENT", "显式跳过也不许覆盖本机文件"
    issues = "\n".join(result.get("asset_issues") or [])
    assert "aaa-dataset-a-file.bin" in issues
    assert "绝不覆盖" in issues
    # 独立复核（以磁盘现状对照清单）也如实报告本机文件与包内不符。
    assert "不符" in issues
    # 没有冲突的附件照常恢复。
    assert (datasets_dir / "user_files" / "bbb-dataset-b-file.bin").read_bytes() == b"B" * 128


def test_cross_section_same_name_conflict_is_detected(tmp_path):
    """包内两段声明同名附件但内容不同：冲突被记下，第二份不会被发布。

    共享目录意味着包内前缀不同也挡不住物理同名——只有逐文件比对内容才能发现。
    """
    from app.services.data_backup.asset_restore import AssetRestorePlan

    archive = tmp_path / "dup.zip"
    with zipfile.ZipFile(archive, "w") as archive_file:
        archive_file.writestr("user_files/dup.bin", b"AAAA")
        archive_file.writestr("datasets/xyz123/user_files/dup.bin", b"BBBB")

    def _section(payload: bytes) -> dict:
        return {
            "manifest_version": 1,
            "user_files": [
                {
                    "name": "dup.bin",
                    "size_bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            ],
        }

    destinations = {
        "user_files": tmp_path / "out" / "user_files",
        "referral_images": tmp_path / "out" / "referral_images",
    }
    plan = AssetRestorePlan(tmp_path / "staging")
    try:
        plan.add_section(
            archive,
            _section(b"AAAA"),
            prefixes={"user_files": "user_files/", "referral_images": "referral_images/"},
            destinations=destinations,
            label="活动数据集",
        )
        plan.add_section(
            archive,
            _section(b"BBBB"),
            prefixes={
                "user_files": "datasets/xyz123/user_files/",
                "referral_images": "datasets/xyz123/referral_images/",
            },
            destinations=destinations,
            label="随包数据集",
        )

        assert any("同名但内容不同" in issue for issue in plan.blocking_issues())
        plan.publish()
        assert (destinations["user_files"] / "dup.bin").read_bytes() == b"AAAA"
    finally:
        plan.discard()


def test_identical_duplicate_across_sections_is_deduplicated(tmp_path):
    """包内两段声明同名且同内容：不是冲突，只发布一次。"""
    from app.services.data_backup.asset_restore import AssetRestorePlan

    archive = tmp_path / "same.zip"
    with zipfile.ZipFile(archive, "w") as archive_file:
        archive_file.writestr("user_files/same.bin", b"IDENTICAL")
        archive_file.writestr("datasets/xyz123/user_files/same.bin", b"IDENTICAL")
    section = {
        "manifest_version": 1,
        "user_files": [
            {
                "name": "same.bin",
                "size_bytes": 9,
                "sha256": hashlib.sha256(b"IDENTICAL").hexdigest(),
            }
        ],
    }
    destinations = {
        "user_files": tmp_path / "out" / "user_files",
        "referral_images": tmp_path / "out" / "referral_images",
    }
    plan = AssetRestorePlan(tmp_path / "staging")
    try:
        plan.add_section(
            archive,
            section,
            prefixes={"user_files": "user_files/", "referral_images": "referral_images/"},
            destinations=destinations,
            label="活动数据集",
        )
        plan.add_section(
            archive,
            section,
            prefixes={
                "user_files": "datasets/xyz123/user_files/",
                "referral_images": "datasets/xyz123/referral_images/",
            },
            destinations=destinations,
            label="随包数据集",
        )
        assert plan.blocking_issues() == []
        restored, issues = plan.publish()
        assert issues == []
        assert restored["user_files"] == 1
        assert (destinations["user_files"] / "same.bin").read_bytes() == b"IDENTICAL"
    finally:
        plan.discard()


def test_export_flags_missing_and_mismatched_assets(db_session, tmp_path):
    """导出侧：引用但磁盘上没有的附件记 missing，磁盘内容与登记哈希不符的记 mismatched。"""
    directory = database_path(database.engine).parent / "user_files"
    directory.mkdir(parents=True, exist_ok=True)

    gone_name = "rr03-missing-attachment.bin"
    db_session.add(
        UserFile(
            sha256=hashlib.sha256(b"NEVER-WRITTEN").hexdigest(),
            disk_name=gone_name,
            original_name=gone_name,
            mime="application/octet-stream",
            size=13,
            source_type="test",
            source_ref="test:rr03",
        )
    )
    edited_name = "rr03-mismatched-attachment.bin"
    edited_path = directory / edited_name
    edited_path.write_bytes(b"CONTENT-ON-DISK")
    db_session.add(
        UserFile(
            sha256=hashlib.sha256(b"CONTENT-AT-REGISTRATION").hexdigest(),
            disk_name=edited_name,
            original_name=edited_name,
            mime="application/octet-stream",
            size=len(b"CONTENT-AT-REGISTRATION"),
            source_type="test",
            source_ref="test:rr03",
        )
    )
    db_session.commit()
    try:
        archive = create_backup_archive(database.engine, tmp_path / "staging-export")
        section = _read_manifest(archive)["asset_manifest"]
        assert gone_name in section.get("user_files_missing", [])
        assert edited_name in section.get("user_files_mismatched", [])

        # 导入这份"本来就不完整"的备份：如实提示，而不是当成一次完整恢复。
        result = import_dataset(archive, "不完整备份", database.engine, tmp_path / "staging-import")
        warnings = "\n".join(result.get("backup_asset_warnings") or [])
        assert gone_name in warnings
        assert "不完整" in warnings
        # 内容与登记不符的那份：导出按**磁盘现状**（真实字节）装包，导入后逐字节一致。
        restored_path = (
            database_path(database.engine).parent / "datasets" / "user_files" / edited_name
        )
        assert restored_path.exists(), "附件应当被恢复到共享资产目录"
        assert hashlib.sha256(restored_path.read_bytes()).hexdigest() == (
            hashlib.sha256(b"CONTENT-ON-DISK").hexdigest()
        ), "恢复出来的必须是与清单一致的当前磁盘字节"
    finally:
        edited_path.unlink(missing_ok=True)


def test_second_packaged_dataset_failure_rolls_back_the_first(
    three_datasets, tmp_path, monkeypatch
):
    """随包的第二份数据集落盘失败：第一份也必须被收回（不留半截数据集）。

    RR-03 的验收点之一。``place_packaged_datasets`` 逐条落盘，中途失败时调用方的
    回滚清单必须已经登记过前面几条——否则列表里会多出一份没人认领的数据集。
    """
    from app.services import datasets_admin as datasets_admin_service

    archive = export_all_datasets(database.engine, tmp_path / "staging-export")
    datasets_dir = three_datasets.path_a.parent
    before = _fingerprints(datasets_dir)
    names_before = _dataset_names()

    real_write_metadata = datasets_admin_service.write_metadata
    calls = {"count": 0}

    def failing_write_metadata(dataset_id, metadata):
        calls["count"] += 1
        if calls["count"] == 2:
            raise OSError("模拟：第二份随包数据集写元信息时磁盘故障")
        return real_write_metadata(dataset_id, metadata)

    monkeypatch.setattr(datasets_admin_service, "write_metadata", failing_write_metadata)

    with pytest.raises(OSError, match="模拟：第二份随包数据集"):
        import_dataset(archive, "随包失败包", database.engine, tmp_path / "staging-packaged-fail")

    assert _fingerprints(datasets_dir) == before, "两份随包数据集都应被收回，目录回到导入前"
    assert _dataset_names() == names_before, "列表里不许留下半截数据集"


def test_archive_supplied_dataset_name_cannot_escape_the_staging_dir(tmp_path):
    """包内数据集名字带路径成分时，暂存目录不许被写到外面（评审复现的穿越）。"""
    from app.services.data_backup.asset_restore import AssetRestorePlan

    archive = tmp_path / "evil.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("user_files/leak.bin", b"ATTACKER-CONTROLLED-BYTES")
    section = {
        "manifest_version": 1,
        "user_files": [
            {
                "name": "leak.bin",
                "size_bytes": len(b"ATTACKER-CONTROLLED-BYTES"),
                "sha256": hashlib.sha256(b"ATTACKER-CONTROLLED-BYTES").hexdigest(),
            }
        ],
    }
    destinations = {
        "user_files": tmp_path / "out" / "user_files",
        "referral_images": tmp_path / "out" / "referral_images",
    }
    # 恶意段标签：如果它被拼进暂存路径，写入就会落在 staging 目录之外。
    plan = AssetRestorePlan(tmp_path / "staging")
    try:
        plan.add_section(
            archive,
            section,
            prefixes={"user_files": "user_files/", "referral_images": "referral_images/"},
            destinations=destinations,
            label="evil/../../../../PWNED-ESCAPE」",
        )
        escaped = tmp_path / "PWNED-ESCAPE」"
        assert not escaped.exists(), "暂存路径不能采用包内的名字"
        assert all(item.staged_path.is_relative_to(plan.staging_dir) for item in plan._files), (
            "暂存文件必须落在私有暂存目录里"
        )
        plan.publish()
        assert (destinations["user_files"] / "leak.bin").read_bytes() == (
            b"ATTACKER-CONTROLLED-BYTES"
        )
    finally:
        plan.discard()

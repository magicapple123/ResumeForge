#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""R01 演练的恢复阶段：在全新目录里导入并核对，坏包逐个撞 fail-closed。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import zipfile
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any

from .checks import check_disk_assets, expected_assets
from .common import (
    ARCHIVE_FILES,
    DB_SECRET,
    EXTRA_PAYLOADS,
    FONT_A_NAME,
    FONTS,
    GLOBAL_SECRET,
    MAIN_PAYLOADS,
    MANIFEST_MEMBER,
    Drill,
    added_files,
    bytes_sha256,
    changed_files,
    file_sha256,
    read_json_member,
    read_member,
    rewrite_database,
    rewrite_manifest,
    rewrite_zip,
    tree_fingerprints,
)

# ===== 恢复阶段：在全新目录里导入并核对，坏包逐个撞 fail-closed =====


def seed_preexisting_dataset(root: Path) -> dict[str, Any]:
    """目标端先有一份"旧数据集"：导入后它必须一个字节都不变。"""
    from app import database
    from app.database_migrations import run_database_migrations
    from app.models.job import Job
    from app.models.user_file import UserFile
    from app.services.datasets import create_dataset

    run_database_migrations(database.engine, backup=False)
    old = create_dataset("合成旧数据集", database.engine)
    old_path = root / "datasets" / f"{old['id']}.db"
    asset_bytes = b"pre-existing target asset that imports must never touch"
    asset_sha = hashlib.sha256(asset_bytes).hexdigest()
    disk_name = f"{asset_sha[:16]}-r01-preexisting.txt"
    engine = database.build_engine(database.database_url_for(old_path))
    try:
        from sqlalchemy.orm import Session

        with Session(engine) as session:
            session.add(Job(title="旧数据集岗位", company="合成旧公司"))
            session.add(
                UserFile(
                    sha256=asset_sha,
                    disk_name=disk_name,
                    original_name="r01-preexisting.txt",
                    mime="text/plain",
                    size=len(asset_bytes),
                    source_type="synthetic",
                    source_ref="r01-drill-preexisting",
                )
            )
            session.commit()
    finally:
        engine.dispose()
    asset_path = root / "datasets" / "user_files" / disk_name
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    asset_path.write_bytes(asset_bytes)
    return {"dataset_id": str(old["id"]), "asset_name": disk_name}


def import_like_api(archive: Path, name: str, root: Path) -> dict[str, Any]:
    """镜像 POST /api/datasets/import：数据集 + 全局模型配置 + 字体。"""
    from app import database
    from app.services.data_backup.global_assets import (
        read_global_assets_payload,
        restore_global_assets,
    )
    from app.services.data_backup.global_config import read_global_llm_payload
    from app.services.datasets import import_dataset
    from app.services.global_llm_merge import merge_exported_profiles

    result = import_dataset(archive, name, database.engine, root / "restore")
    artifacts: dict[str, Any] = {"result": result}
    llm_payload = read_global_llm_payload(archive)
    if llm_payload is not None:
        artifacts["llm_merge"] = merge_exported_profiles(llm_payload)
    assets_payload = read_global_assets_payload(archive)
    if assets_payload is not None:
        artifacts["fonts"] = restore_global_assets(archive, assets_payload)
    return artifacts


def stored_dataset_key(database_file: Path) -> str:
    from app.services.llm_settings import _LLM_CONFIG_KEY

    with closing(sqlite3.connect(f"{database_file.as_uri()}?mode=ro", uri=True)) as connection:
        row = connection.execute(
            "SELECT value FROM app_setting WHERE key = ?", (_LLM_CONFIG_KEY,)
        ).fetchone()
    if not row or not row[0]:
        return ""
    try:
        return str(json.loads(row[0]).get("api_key") or "")
    except (json.JSONDecodeError, AttributeError):
        return ""


def dataset_stats(database_file: Path) -> tuple[set[str], dict[str, int]]:
    with closing(sqlite3.connect(f"{database_file.as_uri()}?mode=ro", uri=True)) as connection:
        tables = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        counts = {
            name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            for name in tables
        }
    return tables, counts


def verify_dataset(
    drill: Drill,
    key: str,
    manifest: dict[str, Any],
    dataset_id: str,
    expected_tables: set[str],
) -> None:
    """核对一份恢复出来的数据集：表结构 + 逐表行数与清单一致。"""
    from app.dataset_registry import dataset_database_file

    drill.check(f"{key}.id", bool(dataset_id), "没有拿到新数据集 id")
    if not dataset_id:
        return
    database_file = dataset_database_file(dataset_id)
    drill.check(f"{key}.exists", database_file.exists(), f"数据集文件不存在：{database_file}")
    if not database_file.exists():
        return
    tables, counts = dataset_stats(database_file)
    drill.check(
        f"{key}.tables", expected_tables <= tables, f"缺少表 {sorted(expected_tables - tables)}"
    )
    expected_counts = {name: int(value) for name, value in (manifest.get("tables") or {}).items()}
    mismatched = [
        f"{name}: {counts.get(name)} != {expected}"
        for name, expected in expected_counts.items()
        if counts.get(name) != expected
    ]
    drill.check(f"{key}.row_counts", not mismatched, "; ".join(mismatched[:3]))


def expect_rejected(
    drill: Drill,
    key: str,
    action: Callable[[], Any],
    needles: tuple[str, ...],
    *,
    root: Path,
    snapshot: dict[str, str],
) -> None:
    from app.dataset_registry import DatasetError
    from app.services.data_backup import BackupError

    try:
        action()
    except (BackupError, DatasetError) as exc:
        message = str(exc)
        drill.check(key, any(needle in message for needle in needles), message)
    else:
        drill.check(key, False, "导入没有拒绝这份包")
    after = tree_fingerprints(root)
    changed = changed_files(snapshot, after)
    added = added_files(snapshot, after)
    drill.check(
        f"{key}.no_partial_writes",
        not changed and not added,
        f"失败后仍有改动：{changed[:2]} 新增：{added[:2]}",
    )


def build_rejected_archives(archives: Path, staging: Path) -> dict[str, Path]:
    from app.services.data_backup import BACKUP_FORMAT_VERSION

    good = archives / ARCHIVE_FILES["single-default"]
    manifest = read_json_member(good, MANIFEST_MEMBER)
    user_files = (manifest.get("asset_manifest") or {}).get("user_files") or []
    asset_name = str(user_files[0]["name"])
    rejected = archives / "rejected"
    rejected.mkdir(parents=True, exist_ok=True)
    bad_format = rewrite_manifest(
        good,
        rejected / "bad-format.zip",
        lambda payload: payload.__setitem__("format", BACKUP_FORMAT_VERSION + 1),
    )
    bad_asset = rewrite_zip(
        good,
        rejected / "bad-asset-sha.zip",
        replacements={f"user_files/{asset_name}": b"tampered bytes"},
    )
    missing_asset = rewrite_zip(
        good,
        rejected / "missing-asset.zip",
        removals=(f"user_files/{asset_name}",),
    )

    def drop_row(database: Path) -> None:
        connection = sqlite3.connect(database)
        try:
            with connection:
                connection.execute(
                    "DELETE FROM resume_record WHERE id = (SELECT MAX(id) FROM resume_record)"
                )
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            connection.close()

    bad_rows = rewrite_database(good, rejected / "bad-row-counts.zip", staging, drop_row)
    return {
        "format": bad_format,
        "asset_sha": bad_asset,
        "asset_missing": missing_asset,
        "row_counts": bad_rows,
    }


def collection_sub_manifest(archives: Path, dataset_id: str) -> dict[str, Any] | None:
    archive_path = archives / ARCHIVE_FILES["collection-all"]
    try:
        with zipfile.ZipFile(archive_path) as archive:
            payload = archive.read(f"datasets/{dataset_id}.zip")
    except (KeyError, OSError, zipfile.BadZipFile):
        return None
    path = archives / "readonly-sub-manifest.zip"
    path.write_bytes(payload)
    try:
        return read_json_member(path, MANIFEST_MEMBER)
    except (KeyError, ValueError, zipfile.BadZipFile):
        return None
    finally:
        path.unlink(missing_ok=True)


def tampered_collection(archives: Path, collection: dict[str, Any]) -> Path:
    """把整包里随包子包的字节改掉（大小不变 -> 只能靠 SHA-256 发现）。"""
    source = archives / ARCHIVE_FILES["collection-all"]
    entries = [entry for entry in collection.get("datasets") or [] if isinstance(entry, dict)]
    target = next((entry for entry in entries if entry.get("id") != "main"), None)
    if target is None:
        raise SystemExit("R01 演练：整包里没有随包数据集，无法构造坏子包用例")
    member = f"datasets/{target['id']}.zip"
    original = read_member(source, member)
    destination = archives / "rejected" / "bad-collection.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)
    return rewrite_zip(source, destination, replacements={member: b"\x00" * len(original)})


def restore_and_verify(drill: Drill, root: Path, archives: Path) -> None:
    from app.database_migrations import application_tables
    from app.dataset_registry import MAIN_DATASET_ID, dataset_database_file
    from app.services.api_key_crypto import decrypt_key
    from app.services.global_llm_profiles import read_global_llm
    from app.services.user_fonts import active_font_name, fonts_dir

    expected_tables = set(application_tables())
    preexisting = seed_preexisting_dataset(root)
    baseline = tree_fingerprints(root, ignore_sqlite_sidecars=True)
    datasets_root = root / "datasets"

    def assert_baseline(key: str) -> None:
        current = tree_fingerprints(root, ignore_sqlite_sidecars=True)
        changed = changed_files(baseline, current)
        drill.check(key, not changed, f"既有文件被改动：{changed[:3]}")

    default_path = archives / ARCHIVE_FILES["single-default"]
    default_manifest = read_json_member(default_path, MANIFEST_MEMBER)
    single = import_like_api(default_path, "R01-恢复-单数据集", root)
    single_id = str(single["result"].get("id") or "")
    verify_dataset(drill, "restore.single", default_manifest, single_id, expected_tables)
    check_disk_assets(
        drill,
        "restore.single.assets",
        datasets_root,
        expected_assets(default_manifest.get("asset_manifest"), MAIN_PAYLOADS),
    )
    drill.check(
        "restore.single.result_flags",
        single["result"].get("api_key_included") is False
        and not single["result"].get("assets_incomplete"),
    )
    drill.check(
        "restore.single.db_key_empty",
        stored_dataset_key(dataset_database_file(single_id)) == "",
    )
    assert_baseline("restore.single.preexisting_unchanged")

    again = import_like_api(default_path, "R01-恢复-单数据集-第二次", root)
    again_id = str(again["result"].get("id") or "")
    drill.check(
        "restore.reimport.new_dataset",
        bool(again_id) and again_id != single_id and dataset_database_file(again_id).exists(),
    )
    drill.check(
        "restore.reimport.keeps_previous",
        dataset_database_file(single_id).exists(),
    )
    assert_baseline("restore.reimport.preexisting_unchanged")

    keys_path = archives / ARCHIVE_FILES["single-keys"]
    keys_manifest = read_json_member(keys_path, MANIFEST_MEMBER)
    keys = import_like_api(keys_path, "R01-恢复-含密钥", root)
    keys_id = str(keys["result"].get("id") or "")
    verify_dataset(drill, "restore.keys", keys_manifest, keys_id, expected_tables)
    drill.check("restore.keys.flag", keys["result"].get("api_key_included") is True)
    drill.check(
        "restore.keys.db_key_decrypts",
        decrypt_key(stored_dataset_key(dataset_database_file(keys_id))) == DB_SECRET,
    )
    fonts_result = keys.get("fonts") or {}
    drill.check(
        "restore.keys.fonts_restored",
        fonts_result.get("restored") == len(FONTS) and not fonts_result.get("issues"),
        json.dumps(fonts_result, ensure_ascii=False),
    )
    for name, payload in FONTS.items():
        path = fonts_dir() / name
        drill.check(
            f"restore.keys.font.{name}",
            path.exists() and file_sha256(path) == bytes_sha256(payload),
        )
    drill.check("restore.keys.active_font", active_font_name() == FONT_A_NAME)
    merged_llm = read_global_llm()
    drill.check(
        "restore.keys.global_llm_key",
        merged_llm is not None and merged_llm.config.api_key == GLOBAL_SECRET,
    )
    assert_baseline("restore.keys.preexisting_unchanged")

    globals_path = archives / ARCHIVE_FILES["single-globals"]
    globals_manifest = read_json_member(globals_path, MANIFEST_MEMBER)
    globals_result = import_like_api(globals_path, "R01-恢复-不含密钥", root)
    globals_id = str(globals_result["result"].get("id") or "")
    verify_dataset(drill, "restore.globals", globals_manifest, globals_id, expected_tables)
    globals_fonts = globals_result.get("fonts") or {}
    drill.check(
        "restore.globals.fonts_skipped_not_overwritten",
        globals_fonts.get("restored") == 0 and globals_fonts.get("skipped") == len(FONTS),
        json.dumps(globals_fonts, ensure_ascii=False),
    )
    drill.check(
        "restore.globals.llm_not_overwritten",
        (globals_result.get("llm_merge") or {}).get("skipped", 0) >= 1
        and read_global_llm() is not None
        and read_global_llm().config.api_key == GLOBAL_SECRET,
    )
    drill.check(
        "restore.globals.font_bytes_unchanged",
        all(
            file_sha256(fonts_dir() / name) == bytes_sha256(payload)
            for name, payload in FONTS.items()
        ),
    )
    assert_baseline("restore.globals.preexisting_unchanged")

    collection_path = archives / ARCHIVE_FILES["collection-all"]
    collection_manifest = read_json_member(collection_path, MANIFEST_MEMBER)
    collection = import_like_api(collection_path, "R01-恢复-整包", root)
    summary = (collection["result"] or {}).get("summary") or {}
    entries = [
        entry for entry in collection_manifest.get("datasets") or [] if isinstance(entry, dict)
    ]
    drill.check(
        "restore.collection.summary",
        summary.get("restored") == len(entries) and summary.get("failed") == 0,
        json.dumps(summary, ensure_ascii=False),
    )
    restored_map = {
        str(item.get("source_id")): item
        for item in (collection["result"] or {}).get("restored") or []
        if isinstance(item, dict)
    }
    for entry in entries:
        dataset_id = str(entry.get("id"))
        item = restored_map.get(dataset_id) or {}
        restored_id = str(((item.get("result") or {}) if item else {}).get("id") or "")
        sub_manifest = collection_sub_manifest(archives, dataset_id)
        if sub_manifest is None:
            drill.check(f"restore.collection.dataset.{dataset_id}", False, "子包清单不可读")
            continue
        verify_dataset(
            drill,
            f"restore.collection.dataset.{dataset_id}",
            sub_manifest,
            restored_id,
            expected_tables,
        )
        payloads = MAIN_PAYLOADS if dataset_id == MAIN_DATASET_ID else EXTRA_PAYLOADS
        check_disk_assets(
            drill,
            f"restore.collection.assets.{dataset_id}",
            datasets_root,
            expected_assets(sub_manifest.get("asset_manifest"), payloads),
        )
    assert_baseline("restore.collection.preexisting_unchanged")

    isolated = import_like_api(
        tampered_collection(archives, collection_manifest), "R01-恢复-整包-坏子包", root
    )
    isolated_summary = (isolated["result"] or {}).get("summary") or {}
    drill.check(
        "restore.collection.isolates_broken_subset",
        isolated_summary.get("restored") == 1 and isolated_summary.get("failed") == 1,
        json.dumps(isolated_summary, ensure_ascii=False),
    )
    assert_baseline("restore.collection.isolation_preexisting_unchanged")

    rejected = build_rejected_archives(archives, root / "tamper-staging")
    cases = {
        "format": (rejected["format"], ("请先升级", "格式不受支持")),
        "asset_sha": (rejected["asset_sha"], ("SHA-256 不符", "附件")),
        "asset_missing": (rejected["asset_missing"], ("缺少该附件", "附件")),
        "row_counts": (rejected["row_counts"], ("行数与清单不符", "不一致")),
    }
    for name, (archive_path, needles) in cases.items():
        snapshot = tree_fingerprints(root)
        expect_rejected(
            drill,
            f"restore.reject.{name}",
            lambda path=archive_path, case=name: import_like_api(path, f"R01-拒绝-{case}", root),
            needles,
            root=root,
            snapshot=snapshot,
        )

    conflict_name = str(
        ((default_manifest.get("asset_manifest") or {}).get("user_files") or [{}])[0].get("name")
    )
    conflict_path = datasets_root / "user_files" / conflict_name
    conflict_bytes = b"local content differs from the archive"
    conflict_path.write_bytes(conflict_bytes)
    snapshot = tree_fingerprints(root)
    expect_rejected(
        drill,
        "restore.reject.asset_conflict",
        lambda: import_like_api(default_path, "R01-拒绝-附件冲突", root),
        ("已保留本机文件", "附件"),
        root=root,
        snapshot=snapshot,
    )
    drill.check(
        "restore.reject.asset_conflict.keeps_local",
        conflict_path.read_bytes() == conflict_bytes,
    )
    drill.check(
        "restore.preexisting_dataset_exists",
        dataset_database_file(preexisting["dataset_id"]).exists(),
    )

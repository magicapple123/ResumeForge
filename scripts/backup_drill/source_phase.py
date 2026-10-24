#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""R01 演练的源阶段：造合成数据 + 导出四份备份包并核对包结构。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import zipfile
from contextlib import closing
from pathlib import Path
from typing import Any

from .checks import check_assets, check_fonts
from .common import (
    ARCHIVE_FILES,
    DATABASE_MEMBER,
    DB_SECRET,
    EXTRA_FILE_BYTES,
    EXTRA_FILE_NAME,
    EXTRA_IMAGE_BYTES,
    EXTRA_IMAGE_NAME,
    FONT_A_BYTES,
    FONT_A_NAME,
    FONT_B_BYTES,
    FONT_B_NAME,
    GLOBAL_LLM_MEMBER,
    GLOBAL_SECRET,
    MANIFEST_MEMBER,
    REFERRAL_IMAGE_BYTES,
    REFERRAL_IMAGE_NAME,
    RUNTIME_ONLY_DIR,
    UNCOVERED_DIR,
    UNCOVERED_FILE,
    USER_FILE_BYTES,
    USER_FILE_NAME,
    Drill,
    member_contains,
    member_digest,
    read_json_member,
    read_member,
)

_FONTS = {FONT_A_NAME: FONT_A_BYTES, FONT_B_NAME: FONT_B_BYTES}

# ===== 源阶段：造合成数据 + 导出并核对包结构 =====


def seed_source(root: Path) -> dict[str, Any]:
    """在源数据目录里造一份完整合成数据（数据库/附件/字体/全局配置/第二数据集）。"""
    from app import database
    from app.database import SessionLocal
    from app.database_migrations import run_database_migrations
    from app.models.job import Job
    from app.models.referral import Referral
    from app.models.resume import ResumeRecord
    from app.models.user_file import UserFile
    from app.schemas.setting import LLMConfig
    from app.services import user_fonts
    from app.services.datasets import create_dataset
    from app.services.global_llm_profiles import write_global_llm
    from app.services.global_settings import read_raw
    from app.services.llm_settings import _LLM_CONFIG_KEY, save_llm_config

    run_database_migrations(database.engine, backup=False)

    user_sha = hashlib.sha256(USER_FILE_BYTES).hexdigest()
    user_disk = f"{user_sha[:16]}-{USER_FILE_NAME}"
    extra_sha = hashlib.sha256(EXTRA_FILE_BYTES).hexdigest()
    extra_disk = f"{extra_sha[:16]}-{EXTRA_FILE_NAME}"

    with SessionLocal() as session:
        job = Job(
            title="后端开发工程师",
            company="合成数据公司",
            description="R01 演练用虚构岗位描述，不含真实招聘信息。",
            requirements="熟悉合成数据与备份恢复。",
        )
        session.add(job)
        session.flush()
        session.add(
            ResumeRecord(
                title="合成简历-R01",
                job_id=job.id,
                job_title=job.title,
                company=job.company,
                content={
                    "name": "合成候选人",
                    "job_intent": "后端开发工程师",
                    "experience": [
                        {
                            "company": "合成科技",
                            "title": "后端实习生",
                            "description": ["负责演练数据的合成与校验。"],
                        }
                    ],
                },
                source="manual",
                draft=False,
            )
        )
        session.add(
            UserFile(
                sha256=user_sha,
                disk_name=user_disk,
                original_name=USER_FILE_NAME,
                mime="text/plain",
                size=len(USER_FILE_BYTES),
                source_type="synthetic",
                source_ref="r01-drill",
            )
        )
        session.add(
            Referral(
                job_id=job.id,
                job_title=job.title,
                company=job.company,
                referrer_name="合成内推人",
                note_images=[f"referral_images/{REFERRAL_IMAGE_NAME}"],
            )
        )
        save_llm_config(
            session,
            LLMConfig(
                base_url="https://synthetic.invalid/v1",
                api_key=DB_SECRET,
                model="synthetic-drill-model",
            ),
        )
        session.commit()

    with closing(sqlite3.connect(root / "resume_forge.db")) as connection:
        row = connection.execute(
            "SELECT value FROM app_setting WHERE key = ?", (_LLM_CONFIG_KEY,)
        ).fetchone()
    stored_db_key = str(json.loads(row[0]).get("api_key") or "") if row and row[0] else ""

    (root / "user_files").mkdir(parents=True, exist_ok=True)
    (root / "user_files" / user_disk).write_bytes(USER_FILE_BYTES)
    (root / "referral_images").mkdir(parents=True, exist_ok=True)
    (root / "referral_images" / REFERRAL_IMAGE_NAME).write_bytes(REFERRAL_IMAGE_BYTES)

    write_global_llm(
        LLMConfig(
            base_url="https://synthetic-global.invalid/v1",
            api_key=GLOBAL_SECRET,
            model="synthetic-global-model",
        )
    )
    state = read_raw() or {}
    profiles = ((state.get("llm") or {}).get("profiles")) or []
    stored_global_key = ""
    if profiles and isinstance(profiles[0].get("config"), dict):
        stored_global_key = str(profiles[0]["config"].get("api_key") or "")

    fonts_root = user_fonts.fonts_dir()
    fonts_root.mkdir(parents=True, exist_ok=True)
    (fonts_root / FONT_A_NAME).write_bytes(FONT_A_BYTES)
    (fonts_root / FONT_B_NAME).write_bytes(FONT_B_BYTES)
    user_fonts.set_active(FONT_A_NAME)
    user_fonts.rename_font(FONT_A_NAME, "合成演示字体")

    extra = create_dataset("合成第二数据集", database.engine)
    extra_engine = database.build_engine(
        database.database_url_for(root / "datasets" / f"{extra['id']}.db")
    )
    try:
        from sqlalchemy.orm import Session

        with Session(extra_engine) as session:
            extra_job = Job(title="第二数据集岗位", company="合成数据公司")
            session.add(extra_job)
            session.flush()
            session.add(
                UserFile(
                    sha256=extra_sha,
                    disk_name=extra_disk,
                    original_name=EXTRA_FILE_NAME,
                    mime="text/plain",
                    size=len(EXTRA_FILE_BYTES),
                    source_type="synthetic",
                    source_ref="r01-drill-extra",
                )
            )
            session.add(
                Referral(
                    job_id=extra_job.id,
                    job_title=extra_job.title,
                    company=extra_job.company,
                    note_images=[f"referral_images/{EXTRA_IMAGE_NAME}"],
                )
            )
            session.commit()
    finally:
        extra_engine.dispose()
    datasets_root = root / "datasets"
    (datasets_root / "user_files").mkdir(parents=True, exist_ok=True)
    (datasets_root / "user_files" / extra_disk).write_bytes(EXTRA_FILE_BYTES)
    (datasets_root / "referral_images").mkdir(parents=True, exist_ok=True)
    (datasets_root / "referral_images" / EXTRA_IMAGE_NAME).write_bytes(EXTRA_IMAGE_BYTES)

    (root / UNCOVERED_DIR).mkdir(parents=True, exist_ok=True)
    (root / UNCOVERED_DIR / "keep.bin").write_bytes(b"uncovered synthetic bytes")
    (root / UNCOVERED_FILE).write_text("uncovered synthetic file", encoding="utf-8")
    (root / RUNTIME_ONLY_DIR).mkdir(parents=True, exist_ok=True)
    (root / RUNTIME_ONLY_DIR / "old-snapshot.db").write_bytes(b"runtime-only snapshot")

    return {
        "main_assets": {
            "user_files": {user_disk: USER_FILE_BYTES},
            "referral_images": {REFERRAL_IMAGE_NAME: REFERRAL_IMAGE_BYTES},
        },
        "extra_assets": {
            "user_files": {extra_disk: EXTRA_FILE_BYTES},
            "referral_images": {EXTRA_IMAGE_NAME: EXTRA_IMAGE_BYTES},
        },
        "extra_id": str(extra["id"]),
        "stored_db_key": stored_db_key,
        "stored_global_key": stored_global_key,
    }


def export_and_verify(drill: Drill, root: Path, archives: Path, expected: dict[str, Any]) -> None:
    """导出四份包并核对 manifest / 表集合 / 资产 / 字体 / 密钥两态 / uncovered。"""
    from app import database
    from app.database_migrations import application_tables
    from app.dataset_registry import MAIN_DATASET_ID
    from app.services.data_backup import (
        BACKUP_FORMAT_GLOBAL_ASSETS,
        create_backup_archive,
        current_head_revision,
    )
    from app.services.data_backup.global_assets import read_global_assets_payload
    from app.services.data_backup.global_config import read_global_llm_payload
    from app.services.datasets import export_all_datasets, export_dataset

    bind = database.engine
    tables = set(application_tables())
    head = current_head_revision(bind)
    stored_db_key = expected["stored_db_key"]
    stored_global_key = expected["stored_global_key"]

    default_path = archives / ARCHIVE_FILES["single-default"]
    create_backup_archive(bind, archives).replace(default_path)
    manifest = read_json_member(default_path, MANIFEST_MEMBER)
    drill.check("export.default.format", manifest.get("format") == 1)
    drill.check("export.default.type", manifest.get("type") == "dataset")
    drill.check("export.default.tables", set(manifest.get("tables") or {}) == tables)
    drill.check("export.default.revision", manifest.get("alembic_revision") == head)
    drill.check("export.default.api_key_flag", manifest.get("api_key_included") is False)
    drill.check(
        "export.default.no_stored_key",
        not member_contains(default_path, DATABASE_MEMBER, stored_db_key.encode()),
    )
    drill.check(
        "export.default.no_plaintext_key",
        not member_contains(default_path, DATABASE_MEMBER, DB_SECRET.encode()),
    )
    check_assets(
        drill,
        "export.default.assets",
        default_path,
        manifest.get("asset_manifest"),
        expected["main_assets"],
    )
    uncovered = [str(item.get("name")) for item in manifest.get("uncovered") or []]
    drill.check("export.default.uncovered_lists_unknown_dir", UNCOVERED_DIR in uncovered)
    drill.check("export.default.uncovered_lists_unknown_file", UNCOVERED_FILE in uncovered)
    drill.check(
        "export.default.uncovered_excludes_runtime",
        not (set(uncovered) & {RUNTIME_ONLY_DIR, "fonts", "user_files", "datasets"}),
        f"{uncovered}",
    )

    keys_path = archives / ARCHIVE_FILES["single-keys"]
    export_dataset(MAIN_DATASET_ID, bind, archives, include_api_keys=True).replace(keys_path)
    keys_manifest = read_json_member(keys_path, MANIFEST_MEMBER)
    drill.check("export.keys.format", keys_manifest.get("format") == BACKUP_FORMAT_GLOBAL_ASSETS)
    drill.check("export.keys.flag", keys_manifest.get("api_key_included") is True)
    drill.check(
        "export.keys.db_key_present",
        member_contains(keys_path, DATABASE_MEMBER, stored_db_key.encode()),
    )
    keys_llm = read_global_llm_payload(keys_path) or {}
    keys_profiles = [item for item in keys_llm.get("profiles") or [] if isinstance(item, dict)]
    drill.check("export.keys.global_profiles", len(keys_profiles) == 1)
    if keys_profiles:
        drill.check(
            "export.keys.global_key_present",
            (keys_profiles[0].get("config") or {}).get("api_key") == stored_global_key,
        )

    globals_path = archives / ARCHIVE_FILES["single-globals"]
    export_dataset(MAIN_DATASET_ID, bind, archives).replace(globals_path)
    globals_manifest = read_json_member(globals_path, MANIFEST_MEMBER)
    drill.check(
        "export.globals.format", globals_manifest.get("format") == BACKUP_FORMAT_GLOBAL_ASSETS
    )
    drill.check(
        "export.globals.font_count",
        (globals_manifest.get("global_assets") or {}).get("fonts") == len(_FONTS),
    )
    fonts_payload = check_fonts(drill, "export.globals.fonts", globals_path, _FONTS) or {}
    drill.check("export.globals.active_font", fonts_payload.get("active") == FONT_A_NAME)
    globals_llm = read_global_llm_payload(globals_path) or {}
    globals_profiles = [
        item for item in globals_llm.get("profiles") or [] if isinstance(item, dict)
    ]
    drill.check("export.globals.llm_profiles", len(globals_profiles) == 1)
    if globals_profiles:
        drill.check(
            "export.globals.llm_key_excluded",
            (globals_profiles[0].get("config") or {}).get("api_key") == "",
        )
    drill.check(
        "export.globals.no_stored_db_key",
        not member_contains(globals_path, DATABASE_MEMBER, stored_db_key.encode()),
    )
    drill.check(
        "export.globals.no_stored_global_key",
        not member_contains(globals_path, GLOBAL_LLM_MEMBER, stored_global_key.encode()),
    )
    drill.check(
        "export.globals.fonts_payload",
        (read_global_assets_payload(globals_path) or {}).get("font_count") == len(_FONTS),
    )

    collection_path = archives / ARCHIVE_FILES["collection-all"]
    export_all_datasets(bind, archives).replace(collection_path)
    collection = read_json_member(collection_path, MANIFEST_MEMBER)
    entries = [entry for entry in collection.get("datasets") or [] if isinstance(entry, dict)]
    ids = {str(entry.get("id")) for entry in entries}
    drill.check("export.collection.format", collection.get("format") == BACKUP_FORMAT_GLOBAL_ASSETS)
    drill.check("export.collection.type", collection.get("type") == "collection")
    drill.check(
        "export.collection.datasets",
        ids == {MAIN_DATASET_ID, expected["extra_id"]},
        f"{sorted(ids)}",
    )
    for entry in entries:
        dataset_id = str(entry.get("id"))
        member = f"datasets/{dataset_id}.zip"
        try:
            size, digest = member_digest(collection_path, member)
        except KeyError:
            drill.check(f"export.collection.member.{dataset_id}", False, "缺少子包")
            continue
        drill.check(
            f"export.collection.member.{dataset_id}",
            size == entry.get("size_bytes") and digest == entry.get("sha256"),
            "子包大小或 SHA-256 与清单不一致",
        )
        sub_path = archives / f"readonly-{dataset_id}.zip"
        sub_path.write_bytes(read_member(collection_path, member))
        try:
            sub_manifest = read_json_member(sub_path, MANIFEST_MEMBER)
            drill.check(
                f"export.collection.sub_tables.{dataset_id}",
                set(sub_manifest.get("tables") or {}) == tables,
                "子包清单的表集合与当前代码不一致",
            )
            payloads = (
                expected["main_assets"]
                if dataset_id == MAIN_DATASET_ID
                else expected["extra_assets"]
            )
            check_assets(
                drill,
                f"export.collection.assets.{dataset_id}",
                sub_path,
                sub_manifest.get("asset_manifest"),
                payloads,
            )
        except (KeyError, ValueError, zipfile.BadZipFile):
            drill.check(f"export.collection.sub_manifest.{dataset_id}", False, "子包清单不可读")
        finally:
            sub_path.unlink(missing_ok=True)
    check_archive_isolation(drill, collection_path, expected)


def check_archive_isolation(drill: Drill, collection: Path, expected: dict[str, Any]) -> None:
    """活动数据集与随包数据集的附件按各自命名空间隔离。"""
    with zipfile.ZipFile(collection) as archive:
        sub_members = sorted(
            name
            for name in archive.namelist()
            if name.startswith("datasets/") and name.endswith(".zip")
        )
        if not sub_members:
            drill.check("export.collection.isolation", False, "没有找到随包子包")
            return
        sub_user_files: dict[str, set[str]] = {}
        for member in sub_members:
            payload = archive.read(member)
            path = collection.parent / "readonly-sub.zip"
            path.write_bytes(payload)
            try:
                with zipfile.ZipFile(path) as sub:
                    sub_user_files[member] = {
                        name.rsplit("/", 1)[-1]
                        for name in sub.namelist()
                        if name.startswith("user_files/")
                    }
            finally:
                path.unlink(missing_ok=True)
    main_names = set(expected["main_assets"]["user_files"])
    extra_names = set(expected["extra_assets"]["user_files"])
    main_sub = sub_user_files.get("datasets/main.zip", set())
    extra_sub: set[str] = set()
    for member, names in sub_user_files.items():
        if member != "datasets/main.zip":
            extra_sub |= names
    drill.check(
        "export.collection.isolation",
        main_names <= main_sub and extra_names <= extra_sub and not (main_names & extra_sub),
        "活动/随包数据集的附件命名空间发生串联",
    )

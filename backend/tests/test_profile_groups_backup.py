# SPDX-License-Identifier: Apache-2.0
"""资料大字段/组的新表备份回归（F2 契约 §5.3 / 需求 R-48/R-49/R-51）。

钉住三件事：
1. 新模型 8 张表都在备份清单里（表集合 == 模型注册表，台账守卫继续成立）；
2. 旧格式样本包导入后**新表为空、旧表完整**（迁移链补齐空表，旧数据原样保留）；
3. 含旧资料、停在 0063 的旧备份导入后触发升级状态（R-47：旧表有数据 + 新模型为空）。
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path

from app import database
from app.database import build_engine, database_url_for
from app.database_migrations import application_tables, run_database_migrations
from app.dataset_registry import dataset_database_file
from app.models.profile import Education, UserProfile
from app.services.data_backup import (
    DATABASE_MEMBER,
    MANIFEST_MEMBER,
    asset_categories,
    create_backup_archive,
    inspect_archive,
)
from app.services.data_backup.coverage import COVERED_DIRECTORIES, RUNTIME_ONLY
from app.services.datasets import import_dataset
from app.services.profile import legacy_status
from app.services.profile.entry_store import upsert_entry
from app.services.profile.profile_reader import load_workspace_upgrade_status
from sqlalchemy.orm import Session

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "backup-formats"
# F1 新增的 8 张表（0064 只加表）；旧备份里没有它们，导入时由迁移补成空表。
NEW_PROFILE_TABLES = (
    "profile_entry",
    "profile_group",
    "profile_group_member",
    "profile_workspace_state",
    "profile_custom_section",
    "profile_custom_field",
    "profile_field_preference",
    "profile_usage_snapshot",
)
OLD_PROFILE_TABLES = ("user_profile", "education", "experience", "project", "skill", "award")
PREVIOUS_REVISION = "0063_profile_fact_field_pref"


def _read_manifest(archive: Path) -> dict:
    with zipfile.ZipFile(archive) as handle:
        return json.loads(handle.read(MANIFEST_MEMBER))


def _database_bytes(archive: Path) -> bytes:
    with zipfile.ZipFile(archive) as handle:
        return handle.read(DATABASE_MEMBER)


def _rebuild_archive(source: Path, destination: Path, replacements: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(destination, "w") as target:
        for info in src.infolist():
            target.writestr(info, replacements.get(info.filename, src.read(info.filename)))
    return destination


def _downgrade_to_0063(database_path: Path) -> None:
    """把备份里的库退回"0064 之前"：删掉新表、revision 写回 0063（模拟旧版本导出的包）。"""
    connection = sqlite3.connect(database_path)
    try:
        with connection:
            for name in NEW_PROFILE_TABLES:
                connection.execute(f'DROP TABLE IF EXISTS "{name}"')
            connection.execute("DELETE FROM alembic_version")
            connection.execute("INSERT INTO alembic_version VALUES (?)", (PREVIOUS_REVISION,))
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        connection.close()


def _table_counts(database_path: Path, tables: tuple[str, ...]) -> dict[str, int]:
    connection = sqlite3.connect(database_path)
    try:
        return {
            name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            for name in tables
        }
    finally:
        connection.close()


def test_new_profile_tables_are_covered_by_the_backup_manifest(tmp_path, db_session):
    """新表进了清单、行数随包走；三盏红灯的表覆盖/资产类别两条继续成立。"""
    upsert_entry(db_session, "basic_info", values={"basic_info.name": "张三"})
    db_session.add(UserProfile(name="旧姓名"))
    db_session.flush()
    profile = db_session.query(UserProfile).first()
    db_session.add(Education(profile_id=profile.id, school="旧学校"))
    db_session.commit()

    archive = create_backup_archive(database.engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    tables = manifest["tables"]

    assert set(tables) == set(application_tables())
    assert set(NEW_PROFILE_TABLES) <= set(tables)
    assert tables["profile_entry"] == 1  # 新模型内容确实随包走
    assert tables["user_profile"] == 1 and tables["education"] == 1  # 旧表继续随包走（R-48）
    # 另两盏红灯的静态不变量（行为用例见 test_backup_coverage.py）。
    assert set(asset_categories.ASSET_CATEGORIES) == set(COVERED_DIRECTORIES)
    assert not (COVERED_DIRECTORIES & RUNTIME_ONLY)
    assert manifest["uncovered_count"] == len(manifest["uncovered"])


def test_frozen_legacy_format_sample_upgrades_with_empty_new_tables(tmp_path):
    """仓库冻结的历史格式样本必须仍可导入；迁移补出的新表是空的、旧表结构齐全。"""
    fixture = FIXTURE_DIR / "format-6.zip"
    assert fixture.is_file(), "缺少格式样本包，请跑 scripts/make_backup_format_fixtures.py"

    preview = inspect_archive(fixture, database.engine, tmp_path / "staging")
    counts = preview["database"]["tables"]
    declared = preview["manifest"]["tables"]

    for name in NEW_PROFILE_TABLES:
        assert counts[name] == 0, f"旧格式样本导入后新表 {name} 不是空的"
    for name in OLD_PROFILE_TABLES:
        assert name in counts, f"旧表 {name} 在升级后不存在"
        assert counts[name] == declared.get(name, 0), f"旧表 {name} 行数与清单不一致"
    # 迁移完成后候选库落在当前 head（旧包不会因为没有 0064 被拒收）。
    assert preview["manifest"]["format"] == 6


def test_old_backup_keeps_legacy_rows_and_triggers_upgrade_status(tmp_path, db_session):
    """停在 0063 的旧备份：导入成功、新表为空、旧表数据完整、升级状态命中。"""
    db_session.add(UserProfile(name="旧姓名", phone="13800000000", summary="旧总结"))
    db_session.flush()
    profile = db_session.query(UserProfile).first()
    db_session.add(Education(profile_id=profile.id, school="旧学校", major="软件工程"))
    db_session.commit()

    archive = create_backup_archive(database.engine, tmp_path / "staging")
    manifest = _read_manifest(archive)
    old_database = tmp_path / "old-0063.db"
    old_database.write_bytes(_database_bytes(archive))
    _downgrade_to_0063(old_database)

    manifest["alembic_revision"] = PREVIOUS_REVISION
    for name in NEW_PROFILE_TABLES:
        manifest["tables"].pop(name, None)
    old_archive = _rebuild_archive(
        archive,
        tmp_path / "old-0063.zip",
        {
            DATABASE_MEMBER: old_database.read_bytes(),
            MANIFEST_MEMBER: json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
        },
    )

    # 预热"旧表存在性"缓存：导入会迁移/重建 schema，完成后必须失效重算。
    with Session(database.engine) as warm:
        assert legacy_status.has_legacy_data(warm) is True
    assert legacy_status._TABLE_CACHE

    result = import_dataset(old_archive, "旧版本资料包", database.engine, tmp_path / "import")
    assert legacy_status._TABLE_CACHE == {}, "导入完成路径没有让升级检测的表缓存失效"
    imported = dataset_database_file(result["id"])
    # 导入落盘的是包里原始库；真正使用前由切换数据集跑迁移（这里显式跑一遍）。
    imported_engine = build_engine(database_url_for(imported))
    run_database_migrations(imported_engine, backup=False)
    try:
        counts = _table_counts(imported, (*NEW_PROFILE_TABLES, *OLD_PROFILE_TABLES))
        for name in NEW_PROFILE_TABLES:
            assert counts[name] == 0, f"旧备份导入后新表 {name} 不应有数据"
        assert counts["user_profile"] == 1 and counts["education"] == 1
        # 旧数据内容原样保留（不是只保留行数）。
        connection = sqlite3.connect(imported)
        try:
            school = connection.execute("SELECT school FROM education").fetchone()[0]
            user_name = connection.execute("SELECT name FROM user_profile").fetchone()[0]
        finally:
            connection.close()
        assert (user_name, school) == ("旧姓名", "旧学校")

        # R-47 升级检测：旧表有数据 + 新模型为空 → 必须提示（不得静默显示空资料页）。
        with Session(imported_engine) as session:
            has_legacy, new_has_entries = load_workspace_upgrade_status(session)
    finally:
        imported_engine.dispose()
    assert (has_legacy, new_has_entries) == (True, False)


def test_import_survives_table_cache_invalidation_failure(tmp_path, monkeypatch):
    """缓存失效是锦上添花：即使它坏了，旧格式备份导入也不能被挡住。"""

    def boom() -> None:
        raise RuntimeError("cache down")

    monkeypatch.setattr(legacy_status, "invalidate_table_cache", boom)

    preview = inspect_archive(FIXTURE_DIR / "format-6.zip", database.engine, tmp_path / "staging")
    assert preview["database"]["tables"]["profile_entry"] == 0


def test_new_model_write_makes_upgrade_status_disappear():
    """新模型一旦有实际内容，升级提示自然消失（R-47 的"后半个布尔"）。"""
    with Session(database.engine) as session:
        upsert_entry(session, "basic_info", values={"basic_info.name": "新姓名"})
        has_legacy, new_has_entries = load_workspace_upgrade_status(session)
    assert new_has_entries is True
    assert has_legacy is False

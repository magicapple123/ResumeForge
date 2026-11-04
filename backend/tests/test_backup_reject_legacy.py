# SPDX-License-Identifier: Apache-2.0
"""T05：2.0 不导入 1.x 备份包——迁移之前就用候选库的 app_schema_epoch 拒收。

判据：inspect_archive / 随包数据集校验抛 BackupError 且文案含「1.0.2」与「不导入」；
候选库的 alembic_version 在拒收后仍是 0046_search_fts（没有被迁移改写）；2.0 自己
导出的包照常通过。
"""

import zipfile
from pathlib import Path

import pytest
from alembic import command
from app import database
from app.config import get_settings
from app.database_migrations import build_alembic_config
from app.services.data_backup import create_backup_archive, inspect_archive
from app.services.data_backup.import_archive import (
    _check_candidate_epoch,
    _read_candidate_revision,
)
from app.services.data_backup.manifest import current_head_revision
from app.services.data_backup.paths import DATABASE_MEMBER, ExtraDatabase
from app.services.datasets import import_dataset
from tests.migration_refs import LEGACY_1X_REVISION

LEGACY_FIXTURE = Path(__file__).parent / "fixtures" / "legacy-1x" / "backup-1.0.2.zip"
EXTRA_DATASET_ID = "0123456789abcdef"


def _point_settings_at(monkeypatch, database_file: Path) -> None:
    monkeypatch.setattr(get_settings(), "database_url", f"sqlite:///{database_file.as_posix()}")


def _baseline_library(tmp_path: Path) -> tuple[Path, Path]:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    database_file = data_dir / "resume_forge.db"
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        command.upgrade(build_alembic_config(engine), "head")
    finally:
        engine.dispose()
    return data_dir, database_file


def _extract_legacy_database(destination: Path) -> Path:
    with zipfile.ZipFile(LEGACY_FIXTURE) as archive:
        destination.write_bytes(archive.read(DATABASE_MEMBER))
    return destination


def test_inspect_archive_rejects_1x_package(tmp_path) -> None:
    _data_dir, database_file = _baseline_library(tmp_path)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        with pytest.raises(Exception) as excinfo:
            inspect_archive(LEGACY_FIXTURE, engine, tmp_path / "staging")
    finally:
        engine.dispose()
    message = str(excinfo.value)
    assert "1.0.2" in message
    assert "不导入" in message


def test_candidate_epoch_check_does_not_touch_revision(tmp_path) -> None:
    candidate = _extract_legacy_database(tmp_path / "candidate.db")
    assert _read_candidate_revision(candidate) == LEGACY_1X_REVISION
    with pytest.raises(Exception) as excinfo:
        _check_candidate_epoch(candidate)
    assert "1.0.2" in str(excinfo.value)
    assert _read_candidate_revision(candidate) == LEGACY_1X_REVISION, "拒收必须是迁移前的只读判定"


def test_2_0_package_is_accepted(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _baseline_library(tmp_path)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        archive_path = create_backup_archive(engine, tmp_path / "export")
        preview = inspect_archive(archive_path, engine, tmp_path / "staging")
        expected_revision = current_head_revision(engine)
        assert preview["database"]["alembic_revision"] == expected_revision
        manifest = preview["manifest"]
        assert isinstance(manifest["format"], int)
    finally:
        engine.dispose()


def test_flat_package_with_legacy_extra_dataset_names_the_dataset(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _baseline_library(tmp_path)
    _point_settings_at(monkeypatch, database_file)
    legacy_db = _extract_legacy_database(tmp_path / "legacy-extra.db")
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        archive_path = create_backup_archive(
            engine,
            tmp_path / "export",
            extra_databases=[
                ExtraDatabase(
                    dataset_id=EXTRA_DATASET_ID,
                    name="旧数据集",
                    source=legacy_db,
                )
            ],
        )
        with pytest.raises(Exception) as excinfo:
            import_dataset(archive_path, "整包", engine, tmp_path / "staging")
    finally:
        engine.dispose()
    message = str(excinfo.value)
    assert "旧数据集" in message, "拒收文案要点出是哪一份随包数据集"
    assert "1.0.2" in message


def test_nested_collection_isolates_legacy_dataset(tmp_path, monkeypatch) -> None:
    from app.services.data_backup.collection_export import create_collection_archive

    data_dir, database_file = _baseline_library(tmp_path)
    _point_settings_at(monkeypatch, database_file)
    legacy_db = _extract_legacy_database(tmp_path / "legacy-extra.db")
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        archive_path = create_collection_archive(
            engine,
            tmp_path / "collection",
            extras=[
                ExtraDatabase(
                    dataset_id=EXTRA_DATASET_ID,
                    name="旧数据集",
                    source=legacy_db,
                )
            ],
        )
        result = import_dataset(archive_path, "整包", engine, tmp_path / "staging")
    finally:
        engine.dispose()
    failed = result.get("failed") or []
    assert [item["name"] for item in failed] == ["旧数据集"]
    assert "1.0.2" in failed[0]["error"]
    assert result["summary"]["restored"] >= 1, "同包里合法的 2.0 主数据集仍应恢复"

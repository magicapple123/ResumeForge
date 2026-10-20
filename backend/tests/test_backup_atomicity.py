"""Real publication faults, stable export snapshots and legacy safety regressions."""

import json
import os
import sqlite3
import zipfile
from pathlib import Path

import pytest
from app import database, dataset_registry
from app.models.job import Job
from app.services import datasets
from app.services.data_backup import BackupError, create_backup_archive
from app.services.data_backup import export as exporter
from app.services.data_backup.import_archive import _best_effort_checkpoint, restore_user_files
from tests.backup_asset_fixtures import _add_main_user_file


@pytest.mark.parametrize("fail_at", [2, 3])
def test_real_later_asset_publish_failure_rolls_back_every_new_file(
    db_session, tmp_path, monkeypatch, fail_at
):
    for index in range(1, 4):
        _add_main_user_file(db_session, f"atomic-{index}.bin", bytes([index]) * 31)
    archive = create_backup_archive(database.engine, tmp_path / "export")
    destination = tmp_path / "restore"
    destination.mkdir()
    original = destination / "unrelated.bin"
    original.write_bytes(b"keep this synthetic original")
    monkeypatch.setattr(datasets, "datasets_directory", lambda: destination)
    monkeypatch.setattr(dataset_registry, "datasets_directory", lambda: destination)
    real_rename, real_link = os.rename, os.link
    published = []

    def inject(operation):
        def wrapped(source, target, *args, **kwargs):
            if Path(target).parent == destination / "user_files":
                published.append(Path(target).name)
                if len(published) == fail_at:
                    raise OSError("synthetic disk-full at actual publication")
            return operation(source, target, *args, **kwargs)

        return wrapped

    monkeypatch.setattr(os, "rename", inject(real_rename))
    monkeypatch.setattr(os, "link", inject(real_link))
    with pytest.raises(dataset_registry.DatasetError, match="附件发布失败"):
        datasets.import_dataset(archive, "synthetic", database.engine, tmp_path / "import")
    assert len(published) >= fail_at
    assert original.read_bytes() == b"keep this synthetic original"
    assert not list(destination.rglob("*.db"))
    assert not list(destination.rglob("atomic-*.bin"))
    assert not list(destination.glob("*.json"))


def test_export_names_remain_unique_with_a_frozen_clock(db_session, tmp_path, monkeypatch):
    class Clock:
        @staticmethod
        def now():
            from datetime import datetime

            return datetime(2026, 10, 14, 12, 0, 0)

    monkeypatch.setattr(exporter, "datetime", Clock)
    first = create_backup_archive(database.engine, tmp_path / "export")
    first_bytes = first.read_bytes()
    db_session.add(Job(title="Synthetic second export", company="Fictional"))
    db_session.commit()
    second = create_backup_archive(database.engine, tmp_path / "export")
    assert first != second
    assert first.read_bytes() == first_bytes


def test_export_manifest_counts_the_archived_snapshot(db_session, tmp_path, monkeypatch):
    db_session.add(Job(title="Snapshot row", company="Fictional"))
    db_session.commit()
    snapshotter = exporter.backup_sqlite_database

    def change_live_database_after_snapshot(*args, **kwargs):
        snapshot = snapshotter(*args, **kwargs)
        db_session.add(Job(title="Live row after snapshot", company="Fictional"))
        db_session.commit()
        return snapshot

    monkeypatch.setattr(exporter, "backup_sqlite_database", change_live_database_after_snapshot)
    path = create_backup_archive(database.engine, tmp_path / "export")
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        archived_db = tmp_path / "archived.db"
        archived_db.write_bytes(archive.read("resume_forge.db"))
    connection = sqlite3.connect(archived_db)
    try:
        count = connection.execute("SELECT COUNT(*) FROM job").fetchone()[0]
    finally:
        connection.close()
    assert count == 1
    assert manifest["tables"]["job"] == count


def test_asset_change_between_hashing_and_zip_write_rejects_export(
    db_session, tmp_path, monkeypatch
):
    _add_main_user_file(db_session, "changing.bin", b"stable synthetic bytes")
    build = exporter.build_asset_manifest

    def change_after_manifest(snapshot, root, **kwargs):
        manifest = build(snapshot, root, **kwargs)
        (root / "user_files" / "changing.bin").write_bytes(b"changed synthetic bytes")
        return manifest

    monkeypatch.setattr(exporter, "build_asset_manifest", change_after_manifest)
    with pytest.raises(BackupError, match="附件.*变化"):
        create_backup_archive(database.engine, tmp_path / "export")


@pytest.mark.parametrize("name", ["C:relative.bin", "CON.txt", "file.bin:stream"])
def test_legacy_assets_reject_windows_names_before_any_target_write(tmp_path, name):
    pack = tmp_path / "legacy.zip"
    with zipfile.ZipFile(pack, "w") as archive:
        archive.writestr(f"user_files/{name}", b"synthetic")
    destination = tmp_path / "target"
    with pytest.raises(BackupError):
        restore_user_files(pack, destination)
    assert not destination.exists() or not list(destination.iterdir())


def test_checkpoint_failure_is_not_allowed_to_publish_a_candidate(tmp_path, monkeypatch):
    class Connection:
        def execute(self, _sql):
            return self

        def fetchone(self):
            return (1, 10, 3)  # busy: not all committed WAL pages are checkpointed

        def close(self):
            pass

    monkeypatch.setattr(sqlite3, "connect", lambda *args, **kwargs: Connection())
    with pytest.raises(BackupError, match="WAL"):
        _best_effort_checkpoint(tmp_path / "synthetic.db")


def test_archive_quota_rejects_a_small_highly_compressed_member(tmp_path, monkeypatch):
    from app.services.data_backup import archive_guard

    pack = tmp_path / "budget.zip"
    with zipfile.ZipFile(pack, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("user_files/synthetic.bin", b"a" * 4097)
    monkeypatch.setattr(archive_guard, "archive_byte_limit", lambda: 4096)
    with pytest.raises(BackupError, match="预算"):
        restore_user_files(pack, tmp_path / "target")


def test_archive_duplicate_and_case_alias_rejected_before_writing(tmp_path):
    pack = tmp_path / "duplicate.zip"
    with zipfile.ZipFile(pack, "w") as archive:
        archive.writestr("user_files/Case.bin", b"one")
        archive.writestr("user_files/case.bin", b"two")
    with pytest.raises(BackupError, match="重复"):
        restore_user_files(pack, tmp_path / "target")

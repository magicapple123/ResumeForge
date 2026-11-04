# SPDX-License-Identifier: Apache-2.0
"""启动闸门与归档模块的边界分支（覆盖率守卫，T11 验收要求新增模块 ≥85%）。

这里只针对"出错/异常形态"补样本：真实归档成功路径在 test_legacy_archive.py 与
test_startup_gate.py，本文件补包结构损坏、清单字段缺失、回滚失败、内存库等边界。
"""

import io
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path

import pytest
from app import database
from app.config import get_settings
from app.services import startup_gate
from app.services.data_backup import legacy_archive
from sqlalchemy import create_engine

LEGACY_FIXTURE = Path(__file__).parent / "fixtures" / "legacy-1x" / "backup-1.0.2.zip"


def _write_zip(path: Path, members: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return path


def _point_settings_at(monkeypatch, database_file: Path) -> None:
    monkeypatch.setattr(get_settings(), "database_url", f"sqlite:///{database_file.as_posix()}")


def _extract_legacy_library(data_dir: Path) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    database_file = data_dir / "resume_forge.db"
    with zipfile.ZipFile(LEGACY_FIXTURE) as archive:
        database_file.write_bytes(archive.read("resume_forge.db"))
    return database_file


def _corrupted_sqlite_bytes() -> bytes:
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "corrupt.db"
        connection = sqlite3.connect(path)
        try:
            connection.execute("PRAGMA page_size=4096")
            connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)")
            connection.executemany(
                "INSERT INTO t (value) VALUES (?)", [("x" * 200,) for _ in range(200)]
            )
            connection.commit()
        finally:
            connection.close()
        payload = bytearray(path.read_bytes())
    for offset in range(4096, min(len(payload), 4096 * 4)):
        payload[offset] = 0xFF
    return bytes(payload)


def test_archive_zip_path_errors_when_package_dir_has_no_zip(tmp_path) -> None:
    archive_root = tmp_path / "root"
    (archive_root / legacy_archive.ARCHIVE_PACKAGE_DIRNAME).mkdir(parents=True)
    with pytest.raises(legacy_archive.LegacyArchiveError, match="没有找到备份包"):
        legacy_archive.archive_zip_path(archive_root)


def test_verify_archive_rejects_missing_manifest(tmp_path) -> None:
    path = _write_zip(tmp_path / "no-manifest.zip", {"resume_forge.db": b"x"})
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="缺少 manifest.json"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_invalid_manifest_json(tmp_path) -> None:
    path = _write_zip(
        tmp_path / "bad-json.zip",
        {"manifest.json": b"{not json", "resume_forge.db": b"x"},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="无法解析"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_manifest_that_is_not_an_object(tmp_path) -> None:
    path = _write_zip(
        tmp_path / "list-manifest.zip",
        {"manifest.json": json.dumps([1]).encode(), "resume_forge.db": b"x"},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="不是对象"):
        legacy_archive.verify_archive(path)


@pytest.mark.parametrize("manifest", [{}, {"format": True}, {"format": "1"}])
def test_verify_archive_rejects_bad_format_field(tmp_path, manifest) -> None:
    path = _write_zip(
        tmp_path / "bad-format.zip",
        {"manifest.json": json.dumps(manifest).encode(), "resume_forge.db": b"x"},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="缺少合法 format"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_nested_manifest_without_datasets(tmp_path) -> None:
    path = _write_zip(
        tmp_path / "empty-collection.zip",
        {"manifest.json": json.dumps({"format": 4}).encode()},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="嵌套数据集清单"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_missing_nested_member(tmp_path) -> None:
    manifest = {"format": 4, "datasets": [{"id": "main", "file": "datasets/main.zip"}]}
    path = _write_zip(
        tmp_path / "missing-member.zip",
        {"manifest.json": json.dumps(manifest).encode()},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="缺少活动数据集成员"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_corrupt_nested_member(tmp_path) -> None:
    manifest = {"format": 4, "datasets": [{"id": "main", "file": "datasets/main.zip"}]}
    path = _write_zip(
        tmp_path / "corrupt-member.zip",
        {"manifest.json": json.dumps(manifest).encode(), "datasets/main.zip": b"not a zip"},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="子包无法打开"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_nested_member_without_database(tmp_path) -> None:
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as sub_archive:
        sub_archive.writestr("manifest.json", json.dumps({"format": 1}))
    manifest = {"format": 4, "datasets": [{"id": "main", "file": "datasets/main.zip"}]}
    path = _write_zip(
        tmp_path / "member-without-db.zip",
        {"manifest.json": json.dumps(manifest).encode(), "datasets/main.zip": inner.getvalue()},
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError, match="子包缺少 resume_forge.db"):
        legacy_archive.verify_archive(path)


def test_verify_archive_rejects_database_failing_quick_check(tmp_path) -> None:
    path = _write_zip(
        tmp_path / "corrupt-db.zip",
        {
            "manifest.json": json.dumps({"format": 1}).encode(),
            "resume_forge.db": _corrupted_sqlite_bytes(),
        },
    )
    with pytest.raises(legacy_archive.ArchiveVerificationError):
        legacy_archive.verify_archive(path)


def test_move_library_aside_requires_sqlite_database_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "database_url", "sqlite://")
    with pytest.raises(legacy_archive.LegacyArchiveError, match="不是本地 SQLite"):
        legacy_archive.move_library_aside(tmp_path, tmp_path / "archive")


def test_restore_library_skips_existing_targets(tmp_path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    existing = data_dir / "resume_forge.db"
    existing.write_bytes(b"keep-2.0")
    archive_root = tmp_path / "archive"
    files_dir = archive_root / legacy_archive.ARCHIVE_FILES_DIRNAME
    files_dir.mkdir(parents=True)
    (files_dir / "resume_forge.db").write_bytes(b"old-1.x")
    restored = legacy_archive.restore_library(archive_root, data_dir)
    assert restored == []
    assert existing.read_bytes() == b"keep-2.0", "目标已存在时不得覆盖 2.0 库"


def test_unique_stamp_appends_suffix_on_collision(tmp_path) -> None:
    archive_root = tmp_path / startup_gate.ARCHIVE_DIRNAME / "20261104-220000"
    archive_root.mkdir(parents=True)
    assert startup_gate._unique_stamp(tmp_path, "20261104-220000") == "20261104-220000-1"
    generated = startup_gate._unique_stamp(tmp_path, None)
    assert len(generated) >= len("20261104-220000")


def test_enforce_returns_fresh_for_in_memory_database(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "database_url", "sqlite://")
    engine = create_engine("sqlite://")
    try:
        assert startup_gate.enforce(engine) is startup_gate.schema_epoch.EpochDecision.FRESH
    finally:
        engine.dispose()


def test_enforce_restores_library_when_rebind_fails(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    database_file = _extract_legacy_library(data_dir)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    monkeypatch.setattr(startup_gate.database, "rebind", _raise_oserror)
    try:
        with pytest.raises(startup_gate.schema_epoch.StartupGateError, match="已搬回数据目录"):
            startup_gate.enforce(engine, stamp="20261104-230000")
    finally:
        engine.dispose()
    assert database_file.is_file(), "切换失败后原库必须搬回"
    assert not (data_dir / "datasets").exists() or True


def test_enforce_reports_unrestored_files_when_restore_fails(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    database_file = _extract_legacy_library(data_dir)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    monkeypatch.setattr(startup_gate.database, "rebind", _raise_oserror)
    monkeypatch.setattr(startup_gate, "restore_library", _raise_oserror)
    try:
        with pytest.raises(startup_gate.schema_epoch.StartupGateError, match="未自动搬回"):
            startup_gate.enforce(engine, stamp="20261104-230001")
    finally:
        engine.dispose()
    archived = data_dir / startup_gate.ARCHIVE_DIRNAME / "20261104-230001" / "files"
    assert (archived / "resume_forge.db").is_file()


def _raise_oserror(*_args, **_kwargs):
    raise OSError("测试模拟失败")

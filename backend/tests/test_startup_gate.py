# SPDX-License-Identifier: Apache-2.0
"""startup_gate 测试：五支判定在启动链上的执行结果。

重点不是"函数返回了什么"，而是可观察的库状态：REFUSE 时库文件字节/mtime 不变；
归档失败时旧库与数据目录零移动；ARCHIVE 成功后旧库在归档目录里、新库是合法 2.0 空库。
"""

import sqlite3
import zipfile
from pathlib import Path

import pytest
from alembic import command
from app import database
from app.config import get_settings
from app.database_migrations import build_alembic_config, run_database_migrations
from app.services import schema_epoch, startup_gate
from app.services.data_backup.legacy_archive import (
    ARCHIVE_FILES_DIRNAME,
    ARCHIVE_README_NAME,
    archive_zip_path,
    verify_archive,
)
from app.services.data_backup.paths import DATABASE_MEMBER
from tests.migration_refs import BASELINE_REVISION

LEGACY_FIXTURE = Path(__file__).parent / "fixtures" / "legacy-1x" / "backup-1.0.2.zip"


def _point_settings_at(monkeypatch, database_file: Path) -> None:
    monkeypatch.setattr(get_settings(), "database_url", f"sqlite:///{database_file.as_posix()}")


def _legacy_library(tmp_path: Path) -> tuple[Path, Path]:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    database_file = data_dir / "resume_forge.db"
    with zipfile.ZipFile(LEGACY_FIXTURE) as archive:
        database_file.write_bytes(archive.read(DATABASE_MEMBER))
    return data_dir, database_file


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


def _state(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def test_enforce_fresh_does_not_archive(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database_file = data_dir / "resume_forge.db"
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        assert startup_gate.enforce(engine) is schema_epoch.EpochDecision.FRESH
        assert not (data_dir / "legacy-archive").exists()
    finally:
        engine.dispose()


def test_enforce_upgrade_passes_through(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _baseline_library(tmp_path)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        assert startup_gate.enforce(engine) is schema_epoch.EpochDecision.UPGRADE
        assert not (data_dir / "legacy-archive").exists()
    finally:
        engine.dispose()


def test_enforce_refuses_too_new_without_byte_changes(tmp_path, monkeypatch) -> None:
    _data_dir, database_file = _baseline_library(tmp_path)
    with sqlite3.connect(database_file) as connection:
        connection.execute("UPDATE app_schema_epoch SET epoch = 3")
        connection.commit()
    before = _state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        with pytest.raises(schema_epoch.StartupGateError, match="更新版本"):
            startup_gate.enforce(engine)
    finally:
        engine.dispose()
    assert _state(database_file) == before, "拒绝启动必须零写入"
    assert not (database_file.parent / "legacy-archive").exists()


def test_enforce_refuses_unknown_revision_without_byte_changes(tmp_path, monkeypatch) -> None:
    _data_dir, database_file = _baseline_library(tmp_path)
    with sqlite3.connect(database_file) as connection:
        connection.execute("UPDATE alembic_version SET version_num = 'deadbeef'")
        connection.commit()
    before = _state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        with pytest.raises(schema_epoch.StartupGateError, match="无法识别"):
            startup_gate.enforce(engine)
    finally:
        engine.dispose()
    assert _state(database_file) == before
    assert not (database_file.parent / "legacy-archive").exists()


def test_enforce_archives_legacy_and_reopens_empty_2_0_database(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _legacy_library(tmp_path)
    (data_dir / "datasets").mkdir()
    (data_dir / "active.json").write_text('{"dataset_id": "main"}', encoding="utf-8")
    user_files = data_dir / "user_files"
    user_files.mkdir()
    (user_files / "kept.bin").write_bytes(b"keep")
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        result = startup_gate.enforce(engine, stamp="20261104-220000")
        assert result is schema_epoch.EpochDecision.FRESH

        archive_root = data_dir / "legacy-archive" / "20261104-220000"
        assert (archive_root / ARCHIVE_README_NAME).is_file()
        verify_archive(archive_zip_path(archive_root))
        archived_database = archive_root / ARCHIVE_FILES_DIRNAME / "resume_forge.db"
        assert archived_database.is_file()
        with sqlite3.connect(archived_database) as connection:
            assert connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert (archive_root / ARCHIVE_FILES_DIRNAME / "datasets").is_dir()
        assert (archive_root / ARCHIVE_FILES_DIRNAME / "active.json").is_file()
        assert (user_files / "kept.bin").is_file(), "assets 目录不随旧库移动"

        # 新空库 = 同一路径 rebind 后由迁移一次建全（lifespan 里 enforce 之后就是它）。
        assert not database_file.exists(), "移走旧库后、迁移前同一路径不应有旧文件"
        run_database_migrations(database.engine)
        with sqlite3.connect(database_file) as connection:
            assert connection.execute("SELECT epoch FROM app_schema_epoch").fetchall() == [(2,)]
            assert (
                connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
                == BASELINE_REVISION
            )
            for table in ("profile_entry", "resume_record", "user_profile", "education"):
                assert connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == 0
    finally:
        engine.dispose()


def test_enforce_archive_failure_does_not_move_anything(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _legacy_library(tmp_path)
    (data_dir / "datasets").mkdir()
    before = _state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:

        def fail_archive(*_args, **_kwargs):
            raise OSError("磁盘已满（测试模拟）")

        monkeypatch.setattr(startup_gate, "archive_pre_2_0_library", fail_archive)
        with pytest.raises(schema_epoch.StartupGateError, match="无法为旧版本资料库建立归档"):
            startup_gate.enforce(engine)
    finally:
        engine.dispose()
    assert _state(database_file) == before, "归档失败时旧库一个字节都不能动"
    assert (data_dir / "datasets").is_dir(), "归档失败时不移动任何目录"
    assert not (data_dir / "legacy-archive").exists()


def test_enforce_verification_failure_does_not_move_old_files(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _legacy_library(tmp_path)
    before = _state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:

        def fail_verify(*_args, **_kwargs):
            raise OSError("校验失败（测试模拟）")

        monkeypatch.setattr(startup_gate, "verify_archive", fail_verify)
        with pytest.raises(schema_epoch.StartupGateError, match="无法为旧版本资料库建立归档"):
            startup_gate.enforce(engine)
    finally:
        engine.dispose()
    assert _state(database_file) == before, "校验失败时不执行任何移动"
    assert database_file.is_file()
    assert not (data_dir / "legacy-archive" / "20261104-220000" / ARCHIVE_FILES_DIRNAME).exists()

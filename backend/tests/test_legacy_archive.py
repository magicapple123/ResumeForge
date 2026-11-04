# SPDX-License-Identifier: Apache-2.0
"""legacy_archive 测试：真实 1.0.2 库成分包 → 校验可打开 → 移走旧文件可回滚。

样本来自 backend/tests/fixtures/legacy-1x/backup-1.0.2.zip（v1.0.2 真实导出的空库，
46 张应用表、revision=0046_search_fts）；不另外存一份二进制库。
"""

import io
import json
import shutil
import zipfile
from pathlib import Path

import pytest
from app import database
from app.services.data_backup.legacy_archive import (
    ARCHIVE_FILES_DIRNAME,
    ARCHIVE_README_NAME,
    ArchiveVerificationError,
    archive_pre_2_0_library,
    archive_zip_path,
    move_library_aside,
    restore_library,
    verify_archive,
)
from app.services.data_backup.paths import DATABASE_MEMBER, MANIFEST_MEMBER

LEGACY_FIXTURE = Path(__file__).parent / "fixtures" / "legacy-1x" / "backup-1.0.2.zip"


def _legacy_library(data_dir: Path) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    database_file = data_dir / "resume_forge.db"
    with zipfile.ZipFile(LEGACY_FIXTURE) as archive:
        database_file.write_bytes(archive.read(DATABASE_MEMBER))
    return database_file


def _point_settings_at(monkeypatch, database_file: Path) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "database_url", f"sqlite:///{database_file.as_posix()}")


def test_verify_archive_accepts_flat_1x_package() -> None:
    """扁平格式（format 1）的老包也能通过校验：归档校验不假设只有嵌套整包。"""
    verify_archive(LEGACY_FIXTURE)


def test_verify_archive_rejects_corrupt_package(tmp_path: Path) -> None:
    broken = tmp_path / "broken.zip"
    broken.write_bytes(b"this is not a zip file")
    with pytest.raises(ArchiveVerificationError) as excinfo:
        verify_archive(broken)
    assert str(broken) in str(excinfo.value)


def test_archive_pre_2_0_library_creates_verifiable_nested_package(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    database_file = _legacy_library(data_dir)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        archive_root = archive_pre_2_0_library(engine, data_dir, "20261104-000000")
        zip_path = archive_zip_path(archive_root)
        assert zip_path.is_file()
        readme_text = (archive_root / ARCHIVE_README_NAME).read_text(encoding="utf-8")
        assert "files/" in readme_text
        assert "1.0.2" in readme_text
        assert "datasets/" in readme_text
        assert "请用 ResumeForge 1.0.2 恢复" not in readme_text, (
            "归档说明不得把用户引向导入这个 zip（1.0.2 读不了嵌套整包）"
        )
        verify_archive(zip_path)

        with zipfile.ZipFile(zip_path) as archive:
            names = set(archive.namelist())
            manifest = json.loads(archive.read(MANIFEST_MEMBER))
            assert isinstance(manifest["format"], int)
            entries = manifest.get("datasets")
            assert isinstance(entries, list) and entries
            main_entry = next(item for item in entries if item["id"] == "main")
            with zipfile.ZipFile(io.BytesIO(archive.read(main_entry["file"]))) as sub_archive:
                assert DATABASE_MEMBER in sub_archive.namelist()
            # 全局模型配置/字体只在真的有内容时才写成员（空环境不写，格式号也不虚升）；
            # 归档校验不依赖它们，这里只确认 README 与嵌套结构齐全。
            assert "README.txt" in names
    finally:
        engine.dispose()


def test_move_library_aside_moves_db_pointer_and_datasets_only(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    database_file = _legacy_library(data_dir)
    (data_dir / "active.json").write_text('{"dataset_id": "main"}', encoding="utf-8")
    (data_dir / "datasets").mkdir()
    (data_dir / "datasets" / "keep.txt").write_text("dataset", encoding="utf-8")
    user_files = data_dir / "user_files"
    user_files.mkdir()
    (user_files / "kept.bin").write_bytes(b"keep")
    archive_root = tmp_path / "archive"
    archive_root.mkdir()

    moved = move_library_aside(data_dir, archive_root, database_file=database_file)

    assert {path.name for path in moved} == {"resume_forge.db", "active.json", "datasets"}
    files_dir = archive_root / ARCHIVE_FILES_DIRNAME
    assert (files_dir / "resume_forge.db").is_file()
    assert (files_dir / "datasets" / "keep.txt").is_file()
    assert not database_file.exists()
    assert not (data_dir / "datasets").exists()
    assert (user_files / "kept.bin").is_file(), "资产目录留在原处，回滚只需搬回 files/"

    restore_library(archive_root, data_dir)
    assert database_file.is_file()
    assert (data_dir / "datasets" / "keep.txt").is_file()


def test_move_library_aside_rolls_back_partial_move(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    database_file = _legacy_library(data_dir)
    (data_dir / "active.json").write_text('{"dataset_id": "main"}', encoding="utf-8")
    (data_dir / "datasets").mkdir()
    archive_root = tmp_path / "archive"
    archive_root.mkdir()

    real_move = shutil.move

    def flaky_move(source, target):
        if Path(source).name == "datasets":
            raise OSError("磁盘已满（测试模拟）")
        return real_move(source, target)

    monkeypatch.setattr(shutil, "move", flaky_move)
    with pytest.raises(OSError):
        move_library_aside(data_dir, archive_root, database_file=database_file)

    assert database_file.is_file(), "部分移动失败必须把已移动的库搬回原处"
    assert (data_dir / "active.json").is_file()
    assert (data_dir / "datasets").is_dir()


def test_verify_archive_quick_checks_database(tmp_path: Path) -> None:
    """包内 db 不是合法 SQLite 时必须拒绝（防止把坏包当成可回滚的备份）。"""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    fake_zip = tmp_path / "fake.zip"
    with zipfile.ZipFile(fake_zip, "w") as archive:
        archive.writestr(MANIFEST_MEMBER, json.dumps({"format": 1}))
        archive.writestr(DATABASE_MEMBER, b"not a sqlite database")
    with pytest.raises(ArchiveVerificationError) as excinfo:
        verify_archive(fake_zip)
    assert str(fake_zip) in str(excinfo.value)

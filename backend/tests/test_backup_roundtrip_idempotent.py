# SPDX-License-Identifier: Apache-2.0
"""升级矩阵场景⑥：备份往返幂等（导出 → 导入为新数据集 → 再导出）。

判据：两次导出的清单除导出时刻/数据目录扫描段外逐字段一致；导入后的库与导出源库
逐表行数、内容指纹一致；恢复后的 app_schema_epoch.epoch == 2。

为什么比较时排除 uncovered 段：它是"导出时数据目录里还有哪些顶层项没进包"的上下文
信息，不是数据库内容；第一次导出源库在数据目录根、第二次导出的是 datasets/<id>.db，
两者所在目录本来就不同。其余字段（含 tables 行数）必须完全一致。
"""

import json
import sqlite3
import zipfile
from pathlib import Path

from app import database
from app.config import get_settings
from app.database_migrations import run_database_migrations
from app.dataset_registry import dataset_database_file
from app.models import Job, ResumeRecord
from app.services.data_backup import create_backup_archive
from app.services.data_backup.paths import MANIFEST_MEMBER
from app.services.datasets import import_dataset
from sqlalchemy.orm import Session
from tests.upgrade_matrix_support import snapshot_state

_VOLATILE_MANIFEST_KEYS = (
    "exported_at",
    "uncovered",
    "uncovered_count",
    "uncovered_truncated",
)


def _point_settings_at(monkeypatch, database_file: Path) -> None:
    monkeypatch.setattr(get_settings(), "database_url", f"sqlite:///{database_file.as_posix()}")


def _read_manifest(archive_path: Path) -> dict:
    with zipfile.ZipFile(archive_path) as archive:
        return json.loads(archive.read(MANIFEST_MEMBER))


def _comparable_manifest(archive_path: Path) -> dict:
    manifest = _read_manifest(archive_path)
    for key in _VOLATILE_MANIFEST_KEYS:
        manifest.pop(key, None)
    return manifest


def test_export_import_export_is_idempotent(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database_file = data_dir / "resume_forge.db"
    _point_settings_at(monkeypatch, database_file)

    engine = database.build_engine(database.database_url_for(database_file))
    try:
        assert run_database_migrations(engine) is None
        with Session(engine) as session:
            session.add(Job(title="算法工程师", company="示例公司"))
            session.add(ResumeRecord(title="示例简历", content={"blocks": []}))
            session.commit()

        first_archive = create_backup_archive(engine, tmp_path / "export-1")
        imported = import_dataset(
            first_archive,
            "往返数据集",
            engine,
            tmp_path / "staging",
        )
        dataset_file = dataset_database_file(str(imported["id"]))
        imported_engine = database.build_engine(database.database_url_for(dataset_file))
        try:
            second_archive = create_backup_archive(imported_engine, tmp_path / "export-2")
        finally:
            imported_engine.dispose()
    finally:
        engine.dispose()

    assert dataset_file.is_file(), "导入应生成一份独立的数据集库"
    assert snapshot_state(dataset_file) == snapshot_state(database_file), (
        "导出→导入后的库与源库逐表行数与内容指纹必须一致"
    )
    with sqlite3.connect(dataset_file) as connection:
        assert connection.execute("SELECT epoch FROM app_schema_epoch").fetchall() == [(2,)]

    assert _comparable_manifest(second_archive) == _comparable_manifest(first_archive), (
        "两次导出的清单除时间戳/导出目录上下文外必须逐字段一致"
    )

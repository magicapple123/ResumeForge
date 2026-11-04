# SPDX-License-Identifier: Apache-2.0
"""2.0 升级矩阵场景 ①②③：全新安装 / epoch=2 库 / 更新或不可识别的库。

判据全部是可观察量：表集合、alembic_version、epoch 行数、逐表行数与内容指纹、
文件字节数/mtime。所有样本只写临时目录。

关于场景②的退化（单基线形态的决定性事实）：2.0 迁移链只有 0001_baseline_v2 一条，
因此"revision 落后于 head 的 2.x 库"在真实数据里不存在——任何在链上的 revision 都
等于 head。这条场景因此钉住真正有意义的不变量：epoch=2 的库通过闸门、迁移是 no-op、
数据逐表行数/指纹完全不变。
"""

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from app import database
from app.config import get_settings
from app.database_migrations import (
    application_tables,
    build_alembic_config,
    run_database_migrations,
)
from app.models import Job, ResumeRecord
from app.services import schema_epoch, search_fts, startup_gate
from app.services.data_backup.legacy_archive import ARCHIVE_DIRNAME
from sqlalchemy.orm import Session
from tests.upgrade_matrix_support import snapshot_state

_FTS_DERIVED_TABLES = {
    "knowledge_fts",
    "knowledge_fts_data",
    "knowledge_fts_idx",
    "knowledge_fts_docsize",
    "knowledge_fts_config",
} | {
    f"search_fts_{base}{suffix}"
    for base in search_fts.SEARCH_FTS_SPECS
    for suffix in ("", "_data", "_idx", "_docsize", "_config")
}


def _head_revision() -> str:
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
    )
    return str(ScriptDirectory.from_config(config).get_current_head())


def _point_settings_at(monkeypatch, database_file: Path) -> None:
    monkeypatch.setattr(get_settings(), "database_url", f"sqlite:///{database_file.as_posix()}")


def _new_data_dir(tmp_path: Path) -> tuple[Path, Path]:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    return data_dir, data_dir / "resume_forge.db"


def _baseline_database(data_dir: Path, database_file: Path) -> None:
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        command.upgrade(build_alembic_config(engine), "head")
    finally:
        engine.dispose()


def _file_state(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def test_scenario_fresh_install_creates_full_2_0_schema(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _new_data_dir(tmp_path)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        assert startup_gate.enforce(engine) is schema_epoch.EpochDecision.FRESH
        assert not (data_dir / ARCHIVE_DIRNAME).exists(), "全新安装不应产生归档目录"
        run_database_migrations(engine)
    finally:
        engine.dispose()

    with sqlite3.connect(database_file) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        epoch_rows = connection.execute("SELECT epoch FROM app_schema_epoch").fetchall()
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    assert epoch_rows == [(2,)]
    assert revision == _head_revision()
    expected = set(application_tables()) | {"alembic_version"} | _FTS_DERIVED_TABLES
    assert tables == expected


def test_scenario_existing_2_0_library_upgrades_without_data_change(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _new_data_dir(tmp_path)
    _baseline_database(data_dir, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        with Session(engine) as session:
            session.add(Job(title="算法工程师", company="示例公司"))
            session.add(ResumeRecord(title="示例简历", content={"blocks": []}))
            session.commit()
    finally:
        engine.dispose()

    before = snapshot_state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        assert startup_gate.enforce(engine) is schema_epoch.EpochDecision.UPGRADE
        assert run_database_migrations(engine) is None
    finally:
        engine.dispose()

    assert snapshot_state(database_file) == before, (
        "epoch=2 库的迁移必须是 no-op，逐表行数与内容不变"
    )
    with sqlite3.connect(database_file) as connection:
        assert connection.execute("SELECT epoch FROM app_schema_epoch").fetchall() == [(2,)]
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            _head_revision()
        )
    assert not (data_dir / ARCHIVE_DIRNAME).exists()


def test_scenario_newer_epoch_is_refused_with_zero_writes(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _new_data_dir(tmp_path)
    _baseline_database(data_dir, database_file)
    with sqlite3.connect(database_file) as connection:
        connection.execute("UPDATE app_schema_epoch SET epoch = 3")
        connection.commit()
    before_state = snapshot_state(database_file)
    before_file = _file_state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        with pytest.raises(schema_epoch.StartupGateError, match="更新版本"):
            startup_gate.enforce(engine)
    finally:
        engine.dispose()
    assert _file_state(database_file) == before_file
    assert snapshot_state(database_file) == before_state
    assert not (data_dir / ARCHIVE_DIRNAME).exists(), "拒绝启动不得新增任何目录"


def test_scenario_unknown_revision_is_refused_with_zero_writes(tmp_path, monkeypatch) -> None:
    data_dir, database_file = _new_data_dir(tmp_path)
    _baseline_database(data_dir, database_file)
    with sqlite3.connect(database_file) as connection:
        connection.execute("UPDATE alembic_version SET version_num = 'deadbeef'")
        connection.commit()
    before_state = snapshot_state(database_file)
    before_file = _file_state(database_file)
    _point_settings_at(monkeypatch, database_file)
    engine = database.build_engine(database.database_url_for(database_file))
    try:
        with pytest.raises(schema_epoch.StartupGateError, match="无法识别"):
            startup_gate.enforce(engine)
    finally:
        engine.dispose()
    assert _file_state(database_file) == before_file
    assert snapshot_state(database_file) == before_state
    assert not (data_dir / ARCHIVE_DIRNAME).exists()

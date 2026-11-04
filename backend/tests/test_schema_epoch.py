# SPDX-License-Identifier: Apache-2.0
"""2.0 数据库版本闸门测试：五支判定、只读性、以及执行器收缩后的边界。

判定的判据必须能被第三个人独立观察：新建什么库、返回哪个 EpochDecision、判定前后
文件字节/大小/mtime 有没有变。所有样本都只用临时目录，不碰 backend/data。
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from app.database_migrations import build_alembic_config, run_database_migrations
from app.services import schema_epoch
from app.services.schema_epoch import EpochDecision, decide
from sqlalchemy import create_engine, text


def _head_revision() -> str:
    """当前迁移链 head，从 Alembic 实际读（不写死 revision 字符串）。"""
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
    )
    return str(ScriptDirectory.from_config(config).get_current_head())


def _baseline_engine(tmp_path: Path, name: str = "baseline.db"):
    """造一个真实的 2.0 库（走基线迁移，不是 create_all）。"""
    engine = create_engine(f"sqlite:///{(tmp_path / name).as_posix()}")
    command.upgrade(build_alembic_config(engine), "head")
    return engine


def _file_state(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def test_decide_fresh_for_missing_database(tmp_path):
    database = tmp_path / "missing.db"
    assert decide(database) is EpochDecision.FRESH
    assert not database.exists(), "只读判定不得创建库文件"


def test_decide_fresh_for_zero_byte_database(tmp_path):
    database = tmp_path / "empty.db"
    database.write_bytes(b"")
    before = _file_state(database)
    assert decide(database) is EpochDecision.FRESH
    assert _file_state(database) == before
    assert database.read_bytes() == b""


def test_decide_upgrade_for_baseline_database(tmp_path):
    engine = _baseline_engine(tmp_path)
    try:
        database = Path(str(engine.url.database))
        before = _file_state(database)
        assert decide(database) is EpochDecision.UPGRADE
        assert _file_state(database) == before
    finally:
        engine.dispose()


def test_decide_archives_pre_2_0_library(tmp_path):
    database = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE education (id INTEGER PRIMARY KEY, school TEXT)"
            )
            connection.exec_driver_sql("INSERT INTO education (school) VALUES ('示例大学')")
    finally:
        engine.dispose()
    before = _file_state(database)
    assert decide(database) is EpochDecision.ARCHIVE_AND_RESET
    assert _file_state(database) == before


def test_decide_refuses_too_new_epoch(tmp_path):
    engine = _baseline_engine(tmp_path, "too-new.db")
    try:
        database = Path(str(engine.url.database))
        with engine.begin() as connection:
            connection.execute(text("UPDATE app_schema_epoch SET epoch = 3"))
        before = _file_state(database)
        assert decide(database) is EpochDecision.REFUSE_TOO_NEW
        assert _file_state(database) == before
    finally:
        engine.dispose()


def test_decide_refuses_unknown_revision(tmp_path):
    engine = _baseline_engine(tmp_path, "unknown-revision.db")
    try:
        database = Path(str(engine.url.database))
        with engine.begin() as connection:
            connection.execute(text("UPDATE alembic_version SET version_num = 'deadbeef'"))
        before = _file_state(database)
        assert decide(database) is EpochDecision.REFUSE_UNKNOWN
        assert _file_state(database) == before
    finally:
        engine.dispose()


def test_decide_refuses_epoch_table_without_row(tmp_path):
    """表在但没行是未知状态：既不归档（可能是 2.0 库被改坏），也不迁移（写下去更糟）。"""
    engine = _baseline_engine(tmp_path, "epoch-without-row.db")
    try:
        database = Path(str(engine.url.database))
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM app_schema_epoch"))
        assert decide(database) is EpochDecision.REFUSE_UNKNOWN
    finally:
        engine.dispose()


def test_decide_refuses_versioned_database_without_epoch_table(tmp_path):
    """没有业务表却有 alembic_version：半降级/残缺库，不猜成 FRESH 去迁移。"""
    database = tmp_path / "version-only.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
            )
            connection.exec_driver_sql("INSERT INTO alembic_version VALUES ('0046_search_fts')")
    finally:
        engine.dispose()
    assert decide(database) is EpochDecision.REFUSE_UNKNOWN


def test_read_epoch_and_revision_are_readonly_for_missing_file(tmp_path):
    database = tmp_path / "nothing.db"
    assert schema_epoch.read_epoch(database) is None
    assert schema_epoch.read_revision(database) is None
    assert not database.exists()


def test_read_epoch_and_revision_for_baseline_database(tmp_path):
    engine = _baseline_engine(tmp_path, "read-values.db")
    try:
        database = Path(str(engine.url.database))
        assert schema_epoch.read_epoch(database) == 2
        assert schema_epoch.read_revision(database) == _head_revision()
    finally:
        engine.dispose()


def test_epoch_table_is_not_user_data(tmp_path):
    from app.database_migrations import (
        _APPLICATION_TABLES,
        _USER_DATA_TABLES,
        _database_has_user_data,
    )

    engine = _baseline_engine(tmp_path, "epoch-not-user-data.db")
    try:
        assert "app_schema_epoch" in _APPLICATION_TABLES
        assert "app_schema_epoch" not in _USER_DATA_TABLES
        assert _database_has_user_data(engine) is False, "epoch 播种行不应触发迁移前快照"
    finally:
        engine.dispose()


def test_refusal_error_contains_database_and_log_path(tmp_path):
    database = tmp_path / "too-new.db"
    error = schema_epoch.refusal_error(EpochDecision.REFUSE_TOO_NEW, database)
    assert isinstance(error, schema_epoch.StartupGateError)
    message = str(error)
    assert "更新版本" in message
    assert str(database) in message
    assert str(schema_epoch.LOG_FILE) in message


def test_runner_refuses_unversioned_database_with_business_tables(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'unversioned.db').as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE education (id INTEGER PRIMARY KEY)")
        with pytest.raises(RuntimeError, match="启动闸门"):
            run_database_migrations(engine)
    finally:
        engine.dispose()

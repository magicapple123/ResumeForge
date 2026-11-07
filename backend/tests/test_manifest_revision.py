# SPDX-License-Identifier: Apache-2.0
"""备份清单的 revision 必须记录快照库的实际值，而不是代码 head（T01 回归守卫）。

平时的导出里"代码 head"与"库里实际应用的 revision"相等，所以写哪个都看不出来；
2.0 启动归档 1.x 库时两者天然不同（代码已是 2.0 基线、库还停在 1.x），一旦写错，
导入侧「清单 vs 实际库」校验会把这个归档包永远拒收。
"""

import sqlite3
from pathlib import Path

from alembic import command
from app.database_migrations import build_alembic_config
from app.services.data_backup.manifest import build_manifest, current_head_revision
from sqlalchemy import create_engine
from tests.migration_refs import head_revision

_OLD_LIBRARY_REVISION = "0075_profile_section_job_filter"


def _memory_bind():
    """build_manifest 在给了 snapshot 时不读 bind 的库；用内存引擎证明这一点。"""
    return create_engine("sqlite://")


def _write_version_database(path: Path, revision: str | None) -> Path:
    with sqlite3.connect(path) as connection:
        if revision is None:
            connection.execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")
        else:
            connection.execute(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
            )
            connection.execute("INSERT INTO alembic_version (version_num) VALUES (?)", (revision,))
    return path


def test_manifest_uses_snapshot_database_revision(tmp_path) -> None:
    """归档旧库场景：清单必须写包内库的 0075，而不是代码 head 的 0001_baseline_v2。"""
    snapshot = _write_version_database(tmp_path / "old-library.db", _OLD_LIBRARY_REVISION)
    bind = _memory_bind()
    try:
        manifest = build_manifest(bind, snapshot=snapshot)
    finally:
        bind.dispose()
    assert manifest["alembic_revision"] == _OLD_LIBRARY_REVISION


def test_manifest_revision_is_none_when_snapshot_has_no_version_table(tmp_path) -> None:
    """没有 alembic_version 表的快照返回 None（不抛异常，也不创建/修改文件）。"""
    snapshot = _write_version_database(tmp_path / "unversioned.db", None)
    bind = _memory_bind()
    try:
        manifest = build_manifest(bind, snapshot=snapshot)
    finally:
        bind.dispose()
    assert manifest["alembic_revision"] is None


def test_manifest_without_snapshot_keeps_code_head(tmp_path) -> None:
    """没有 snapshot 的调用点保持原语义：仍写代码 head。"""
    bind = _memory_bind()
    try:
        expected = current_head_revision(bind)
        manifest = build_manifest(bind)
    finally:
        bind.dispose()
    assert manifest["alembic_revision"] == expected


def test_current_2_0_library_snapshot_reports_current_head_revision(tmp_path) -> None:
    """回归确认：当前版本的库导出的包，外层清单的 revision 是真实迁移 head。"""
    database_file = tmp_path / "resume_forge.db"
    engine = create_engine(f"sqlite:///{database_file.as_posix()}")
    try:
        command.upgrade(build_alembic_config(engine), "head")
    finally:
        engine.dispose()
    bind = _memory_bind()
    try:
        manifest = build_manifest(bind, snapshot=database_file)
    finally:
        bind.dispose()
    assert manifest["alembic_revision"] == head_revision()

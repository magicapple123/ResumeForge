"""备份导入校验：解包、版本核对、迁移与表结构校验（职责⑤）。

安全语义（zip-slip 防护、fail-closed manifest、校验顺序）整函数搬运零改动。
"""
from __future__ import annotations

import json
import logging
import secrets
import shutil
import sqlite3
import zipfile

from contextlib import closing
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from ...database_migrations import _APPLICATION_TABLES, run_database_migrations

from .manifest import _revision_chain, _table_counts
from .paths import (
    ARCHIVE_DATASETS_DIRNAME,
    BACKUP_FORMAT_VERSION,
    BackupError,
    DATABASE_MEMBER,
    MANIFEST_MEMBER,
)

logger = logging.getLogger(__name__)


def extract_database(archive_path: Path, destination: Path) -> Path:
    """把压缩包里的数据库成员写到 destination 并返回该路径。"""
    return extract_member(archive_path, DATABASE_MEMBER, destination)


def _remove_sqlite_sidecars(path: Path) -> None:
    """删除一个 SQLite 库文件的 WAL / 回滚日志边车文件（主文件不动）。

    生产引擎开启 WAL 后，候选库在迁移、校验期间会在旁边产生 ``-wal`` / ``-shm``
    边车；只读连接关闭时无法清理它们，会残留在 staging 目录里越积越多。
    """
    for suffix in ("-wal", "-shm", "-journal"):
        Path(f"{path}{suffix}").unlink(missing_ok=True)


def _best_effort_checkpoint(path: Path) -> None:
    """对候选库做一次尽力而为的 WAL checkpoint，把 -wal 里的已提交帧写回主文件。

    SQLite 只在「最后一个连接干净关闭」时才自动 checkpoint；校验链路上若存在
    未经干净关闭的连接（inspect 用例暴露的边车残留正说明这类路径存在），``-wal``
    里可能有尚未落回主文件的数据。**保留候选库**之前必须先补一次 checkpoint，
    否则随后删边车就是静默丢数据。失败（文件损坏、被锁等）一律吞掉：这只影响
    垃圾文件残留，不该阻断用户的恢复流程。
    """
    try:
        with closing(sqlite3.connect(path)) as connection:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except sqlite3.Error:
        logger.warning("候选库 %s 的 WAL checkpoint 未完成，按原样保留", path.name)


def _remove_candidate_files(path: Path) -> None:
    """删除候选库主文件及其全部边车文件；确保在引擎 dispose / 连接关闭之后调用。"""
    _remove_sqlite_sidecars(path)
    path.unlink(missing_ok=True)


def extract_member(archive_path: Path, member: str, destination: Path) -> Path:
    """把压缩包里指定的成员写到 destination 并返回该路径。

    用 ``ZipFile.open`` 逐块写出，不经过 ``extractall``，从结构上排除了 zip-slip；
    调用方仍需自行校验 ``member`` 是不是自己期望的那一个。
    """
    with zipfile.ZipFile(archive_path) as archive:
        with archive.open(member) as source, destination.open("wb") as target:
            shutil.copyfileobj(source, target)
    return destination


def declared_datasets(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """清单里声明的"其余数据集"。格式 1 的包没有这一段，返回空列表。"""
    entries = manifest.get("datasets")
    if not isinstance(entries, list):
        return []
    return [item for item in entries if isinstance(item, dict)]


def _assert_member_is_a_dataset(entry: dict[str, Any]) -> str:
    """校验清单里那条记录指向的成员路径**确实落在 datasets/ 之下且是 .db**。

    包内的路径是可以被构造的：一个改过的备份包可以在这里写 ``../../`` 或指向主数据库
    成员，让导入过程把别的东西当成数据集写盘。因此路径只认
    ``datasets/<合法的 id>.db`` 这一种形状，别的一律拒收。
    """
    member = str(entry.get("file") or "")
    prefix = f"{ARCHIVE_DATASETS_DIRNAME}/"
    if not member.startswith(prefix) or not member.endswith(".db"):
        raise BackupError(f"备份包里有一份数据集的路径不合法（{member or '空'}），已停止导入")
    stem = member[len(prefix) : -len(".db")]
    if not stem or "/" in stem or "\\" in stem or stem.startswith("."):
        raise BackupError(f"备份包里有一份数据集的路径不合法（{member}），已停止导入")
    return member


def inspect_extra_dataset(
    archive_path: Path, entry: dict[str, Any], bind: Engine, staging_dir: Path
) -> Path:
    """解出包里的一份"其余数据集"并做与主库同样的校验，返回临时文件路径。

    校验链与活动数据集**完全一致**（先核对 revision、再迁移、最后查表结构）：随包带走的
    那几份也是用户的数据，不能因为"它是附带的"就降低标准。调用方负责把它落盘并在用完后
    删除临时文件。
    """
    member = _assert_member_is_a_dataset(entry)
    staging_dir.mkdir(parents=True, exist_ok=True)
    candidate = staging_dir / f"dataset-{secrets.token_hex(8)}.db"
    try:
        extract_member(archive_path, member, candidate)
        # 顺序不能调换：先按原始 revision 核对版本，再迁移，最后才校验表结构。
        _check_candidate_revision(candidate, bind, {"alembic_revision": None})
        _upgrade_candidate(candidate)
        _database_info(candidate, bind)
    except BaseException:
        _remove_candidate_files(candidate)
        raise
    return candidate


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, Any]:
    try:
        manifest = json.loads(archive.read(MANIFEST_MEMBER))
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise BackupError("备份包的元信息已损坏，无法读取") from exc
    if not isinstance(manifest, dict):
        raise BackupError("备份包的元信息已损坏，无法读取")
    format_version = manifest.get("format")
    # 只拒收"比当前代码更新"的格式。这里曾是 `!=`，等于把每一次导出格式升级都变成
    # 用户历史备份的全部失效——用户升级一次应用后就再也导不回旧包了。
    if not isinstance(format_version, int) or isinstance(format_version, bool) or format_version < 1:
        raise BackupError("备份包格式不受支持，可能来自其它版本的 ResumeForge")
    if format_version > BACKUP_FORMAT_VERSION:
        raise BackupError(
            "备份来自更新版本的 ResumeForge，当前版本无法恢复；请先升级应用再导入"
        )
    # fail-closed：清单必须**显式**声明密钥是否在包里，缺失或乱值一律拒收——将来格式
    # 再变更时，不会静默放行一个自己读不懂的声明。true 表示用户导出时勾选了"包含
    # API Key"（格式 3）：密钥按本机存储形态随包走，恢复后解不开（换机器/换用户）时
    # 应用按未配置处理，由用户重填；不认识这个选项的老版本会在上面的格式校验处拒收。
    if manifest.get("api_key_included") not in (True, False):
        raise BackupError("备份包的元信息未声明密钥状态，为安全起见已拒绝恢复")
    return manifest


def _read_candidate_revision(database: Path) -> str | None:
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "alembic_version" not in tables:
            return None
        row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        return row[0] if row else None


def _check_candidate_revision(database: Path, bind: Engine, manifest: dict[str, Any]) -> None:
    """迁移**之前**核对版本：既挡住来自更新版本的备份，也挡住被改过清单的包。

    这一步必须排在 ``_upgrade_candidate`` 前面。迁移会把候选库的 revision 改写成当前
    head，之后再比就永远对不上——一份完全合法的旧备份会被判成"清单与实际内容不一致"
    而拒收，等于把新增数据表这件事重新变成一次不兼容改动。
    """
    revision = _read_candidate_revision(database)
    if revision is not None and revision not in _revision_chain(bind):
        raise BackupError(
            "备份来自更新版本的 ResumeForge，当前版本无法恢复；请先升级应用再导入"
        )
    declared = manifest.get("alembic_revision")
    if declared and revision and declared != revision:
        raise BackupError("备份包的清单与实际数据库内容不一致，已拒绝恢复")


def _upgrade_candidate(database: Path) -> None:
    """把解出来的候选库升到当前 head，再交给表结构校验。

    旧版本导出的备份不含后来新增的表，而校验要求表集合与代码一致——不先迁移的话，
    一份完全合法的旧备份会被判成"不是 ResumeForge 的备份"而拒收。切换数据集的路径
    本来就会重跑迁移，这里保持一致。

    迁移前不生成备份：候选库只是压缩包解出来的一次性副本，原始压缩包还在手上，
    而预迁移备份会落在 restore 目录里越积越多。
    """
    from ...database import build_engine, database_url_for

    engine = build_engine(database_url_for(database))
    try:
        run_database_migrations(engine, backup=False)
    finally:
        engine.dispose()


def _database_info(database: Path, bind: Engine) -> dict[str, Any]:
    """校验解出来的数据库，返回其中的 revision 与各表行数。

    版本与清单的一致性由 ``_check_candidate_revision`` 在迁移前核对过了；走到这里
    候选库已经在当前 head 上，再比一次只会是永远成立的空检查。
    """
    with closing(sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)) as connection:
        try:
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise BackupError("备份包中的数据库未通过完整性校验")
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        except sqlite3.DatabaseError as exc:
            raise BackupError("备份包中的数据库已损坏") from exc

        missing = [name for name in _APPLICATION_TABLES if name not in tables]
        if missing:
            raise BackupError(
                f"备份包中的数据库缺少数据表（{missing[0]} 等），可能不是 ResumeForge 的备份"
            )
        # sqlite_sequence 由 SQLite 的 AUTOINCREMENT 隐式维护，不是业务表。
        unexpected = sorted(tables - set(_APPLICATION_TABLES) - {"alembic_version", "sqlite_sequence"})
        if unexpected:
            raise BackupError(
                f"备份包中含有当前版本不认识的数据表（{unexpected[0]}），"
                "可能来自更新版本的 ResumeForge；请先升级应用再导入"
            )

        revision = None
        if "alembic_version" in tables:
            row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
            revision = row[0] if row else None

        counts = {
            name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            for name in _APPLICATION_TABLES
        }
    return {"alembic_revision": revision, "tables": counts}


def inspect_archive(archive_path: Path, bind: Engine, staging_dir: Path) -> dict[str, Any]:
    """只读校验备份包并返回预览信息，不触碰当前数据库。"""
    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise BackupError("备份文件不是有效的压缩包") from exc

    with archive:
        names = set(archive.namelist())
        if DATABASE_MEMBER not in names or MANIFEST_MEMBER not in names:
            raise BackupError("备份包缺少必要内容，可能不是 ResumeForge 的备份")
        manifest = _read_manifest(archive)

    staging_dir.mkdir(parents=True, exist_ok=True)
    candidate = staging_dir / f"inspect-{secrets.token_hex(8)}.db"
    try:
        extract_database(archive_path, candidate)
        # 顺序不能调换：先按原始 revision 核对版本，再迁移，最后才校验表结构。
        _check_candidate_revision(candidate, bind, manifest)
        _upgrade_candidate(candidate)
        info = _database_info(candidate, bind)
    finally:
        _remove_candidate_files(candidate)

    return {
        "manifest": manifest,
        "database": info,
        "current_tables": _table_counts(bind),
    }


# SPDX-License-Identifier: Apache-2.0
"""pre-2.0 资料库的整包归档：导出 → 校验 → 移走旧文件（不负责重开空库）。

为什么归档必须先于建空库（顺序不可逆）：resume_forge.db 是数据目录里的唯一主库路径。
先建空库会把它覆盖掉，之后再归档读到的只会是空库；反过来先归档，最坏结果是"归档成功
但没建库"——原始数据仍在归档目录里，随时可逆。所以本模块把"导出 + 校验 + 移动"做成
只往前走的三步，任何一步失败都由调用方（startup_gate）停下启动、不执行后续移动。

职责边界：
- 判定在 schema_epoch.decide()（纯只读）；
- 建空库（database.rebind 到同一路径）在 startup_gate.enforce()；
- 迁移在 database_migrations.run_database_migrations()。
本模块只做归档本身，且导出直接复用 datasets_admin.export_all_datasets：它内部就是
create_collection_archive，天然带 user_files/、referral_images/、export_archive/、
global_llm.json 与 global_assets.json；另写一份拷贝逻辑只会漏掉后续新增的资产类别。
"""

from __future__ import annotations

import io
import json
import logging
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from datetime import datetime
from pathlib import Path

from sqlalchemy.engine import Engine

from .paths import DATABASE_MEMBER, MANIFEST_MEMBER

logger = logging.getLogger(__name__)

ARCHIVE_DIRNAME = "legacy-archive"
ARCHIVE_PACKAGE_DIRNAME = "package"
ARCHIVE_FILES_DIRNAME = "files"
ARCHIVE_README_NAME = "ARCHIVE-README.txt"


class LegacyArchiveError(RuntimeError):
    """归档阶段（导出/校验/移动）失败；消息可直接展示给用户。"""


class ArchiveVerificationError(LegacyArchiveError):
    """归档包无法证明可打开/可恢复。调用方据此拒绝继续启动。"""


def archive_pre_2_0_library(bind: Engine, data_dir: Path, stamp: str) -> Path:
    """把旧资料库导出为归档包，返回归档根目录（data_dir/legacy-archive/<stamp>）。

    导出失败时异常原样抛给调用方；此时只可能有半成品目录，旧库文件一个都没动。
    """
    from ...services.datasets_admin import export_all_datasets

    archive_root = data_dir / ARCHIVE_DIRNAME / stamp
    package_dir = archive_root / ARCHIVE_PACKAGE_DIRNAME
    archive_root.mkdir(parents=True, exist_ok=False)
    archive_path = export_all_datasets(
        bind,
        staging_dir=package_dir,
        include_api_keys=False,
        include_global_llm=True,
    )
    _write_archive_readme(archive_root, archive_path)
    return archive_root


def archive_zip_path(archive_root: Path) -> Path:
    """归档根目录里的包路径（export_all_datasets 每次生成一个 zip）。"""
    package_dir = archive_root / ARCHIVE_PACKAGE_DIRNAME
    candidates = sorted(package_dir.glob("*.zip")) if package_dir.is_dir() else []
    if not candidates:
        raise LegacyArchiveError(f"归档目录里没有找到备份包：{package_dir}")
    return candidates[-1]


def verify_archive(zip_path: Path) -> None:
    """证明归档包能打开、清单合法、包内活动库通过 PRAGMA quick_check。

    失败抛 ArchiveVerificationError（含 zip 绝对路径与失败原因）。这是"移走旧库文件"
    之前的最后一道闸：包都打不开就把原库搬走，等于用一份坏备份换掉唯一可用的数据。
    """
    zip_path = Path(zip_path)
    try:
        archive = zipfile.ZipFile(zip_path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise ArchiveVerificationError(f"归档包无法打开：{zip_path}（{exc}）") from exc
    with archive:
        try:
            corrupt = archive.testzip()
            if corrupt is not None:
                raise ArchiveVerificationError(f"归档包内有损坏成员（{corrupt}）：{zip_path}")
            manifest = _read_manifest(archive, zip_path)
            database_bytes = _active_database_bytes(archive, manifest, zip_path)
        except zipfile.BadZipFile as exc:
            raise ArchiveVerificationError(f"归档包结构损坏：{zip_path}（{exc}）") from exc
    _assert_database_opens(database_bytes, zip_path)


def _read_manifest(archive: zipfile.ZipFile, zip_path: Path) -> dict:
    try:
        raw = archive.read(MANIFEST_MEMBER)
    except KeyError as exc:
        raise ArchiveVerificationError(f"归档包缺少 {MANIFEST_MEMBER}：{zip_path}") from exc
    try:
        manifest = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ArchiveVerificationError(f"归档包清单无法解析：{zip_path}（{exc}）") from exc
    if not isinstance(manifest, dict):
        raise ArchiveVerificationError(f"归档包清单不是对象：{zip_path}")
    format_version = manifest.get("format")
    if not isinstance(format_version, int) or isinstance(format_version, bool):
        raise ArchiveVerificationError(f"归档包清单缺少合法 format：{zip_path}")
    return manifest


def _active_database_bytes(archive: zipfile.ZipFile, manifest: dict, zip_path: Path) -> bytes:
    """取出包内活动数据集库的字节：扁平格式直接读，嵌套整包进子包读。"""
    names = set(archive.namelist())
    if DATABASE_MEMBER in names:
        return archive.read(DATABASE_MEMBER)
    entries = manifest.get("datasets")
    if not isinstance(entries, list) or not entries:
        raise ArchiveVerificationError(f"归档包既没有扁平库成员，也没有嵌套数据集清单：{zip_path}")
    main_entry = next(
        (entry for entry in entries if isinstance(entry, dict) and entry.get("id") == "main"),
        None,
    )
    entry = main_entry or next((item for item in entries if isinstance(item, dict)), None)
    member = str(entry.get("file") or "") if isinstance(entry, dict) else ""
    if not member or member not in names:
        raise ArchiveVerificationError(f"归档包缺少活动数据集成员：{zip_path}")
    try:
        with zipfile.ZipFile(io.BytesIO(archive.read(member))) as sub_archive:
            if sub_archive.testzip() is not None:
                raise ArchiveVerificationError(f"归档包的活动数据集子包损坏：{zip_path}/{member}")
            if DATABASE_MEMBER not in sub_archive.namelist():
                raise ArchiveVerificationError(
                    f"活动数据集子包缺少 {DATABASE_MEMBER}：{zip_path}/{member}"
                )
            return sub_archive.read(DATABASE_MEMBER)
    except zipfile.BadZipFile as exc:
        raise ArchiveVerificationError(
            f"活动数据集子包无法打开：{zip_path}/{member}（{exc}）"
        ) from exc


def _assert_database_opens(database_bytes: bytes, zip_path: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="rf-legacy-archive-") as temporary:
        database_file = Path(temporary) / "resume_forge.db"
        database_file.write_bytes(database_bytes)
        try:
            with closing(
                sqlite3.connect(f"{database_file.as_uri()}?mode=ro", uri=True)
            ) as connection:
                row = connection.execute("PRAGMA quick_check").fetchone()
        except sqlite3.Error as exc:
            raise ArchiveVerificationError(f"归档包内数据库无法打开：{zip_path}（{exc}）") from exc
    result = row[0] if row else None
    if result != "ok":
        raise ArchiveVerificationError(
            f"归档包内数据库完整性检查未通过：{zip_path}（{result or '无结果'}）"
        )


def move_library_aside(
    data_dir: Path, destination: Path, *, database_file: Path | None = None
) -> list[Path]:
    """把旧库文件、数据集指针与 datasets/ 移到归档目录的 files/ 下，返回已移动的源路径。

    不移动 user_files/、referral_images/、fonts/、export_archive/：它们已经随包导出，
    新空库不引用它们；留在原处让回滚只是把 files/ 搬回去，不必再从 zip 解一遍。
    失败时把已移动的文件搬回原处（宁可保持原状，也不要留下半个资料库）。
    """
    db_path = Path(database_file) if database_file is not None else _configured_database_file()
    files_dir = destination / ARCHIVE_FILES_DIRNAME
    files_dir.mkdir(parents=True, exist_ok=True)
    sources = [
        db_path,
        _sidecar(db_path, "-wal"),
        _sidecar(db_path, "-shm"),
        data_dir / "active.json",
        data_dir / "datasets",
    ]
    moved: list[tuple[Path, Path]] = []
    try:
        for source in sources:
            if not (source.exists() or source.is_symlink()):
                continue
            target = files_dir / source.name
            shutil.move(str(source), str(target))
            moved.append((source, target))
    except OSError:
        _rollback_moves(moved)
        raise
    return [source for source, _target in moved]


def restore_library(archive_root: Path, data_dir: Path) -> list[Path]:
    """把 files/ 下的文件搬回数据目录（回滚/手工恢复用；目标已存在则跳过并记警告）。"""
    files_dir = archive_root / ARCHIVE_FILES_DIRNAME
    restored: list[Path] = []
    if not files_dir.is_dir():
        return restored
    for child in sorted(files_dir.iterdir(), key=lambda item: item.name):
        target = data_dir / child.name
        if target.exists():
            logger.warning("恢复归档时目标已存在，已跳过 path=%s", target)
            continue
        shutil.move(str(child), str(target))
        restored.append(target)
    return restored


def _configured_database_file() -> Path:
    from ...dataset_registry import DatasetError, configured_database_file

    try:
        return configured_database_file()
    except DatasetError as exc:
        raise LegacyArchiveError("当前数据库不是本地 SQLite 文件，无法建立归档") from exc


def _sidecar(database_file: Path, suffix: str) -> Path:
    return database_file.with_name(database_file.name + suffix)


def _rollback_moves(moved: list[tuple[Path, Path]]) -> None:
    for source, target in reversed(moved):
        try:
            shutil.move(str(target), str(source))
        except OSError:
            logger.exception("回滚归档移动失败，文件仍在归档目录 path=%s", target)


def _write_archive_readme(archive_root: Path, archive_path: Path) -> None:
    created = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "ResumeForge 1.x 资料库归档",
        "",
        f"归档时间：{created}",
        f"归档包：{archive_path.name}",
        f"归档目录：{archive_root}",
        "",
        "这是什么：升级到 ResumeForge 2.0 之前，旧版本资料库（含全部数据集、",
        "user_files/、referral_images/、字体与全局模型配置）的完整备份包。",
        "2.0 使用全新空库，不导入这里的旧数据；这份归档是回退与手工取数的唯一凭据。",
        "",
        "如何回退：",
        "1. 关闭 ResumeForge 2.0；",
        "2. 把本目录 files/ 下的 resume_forge.db、active.json、datasets/ 搬回数据目录",
        "   （覆盖同名文件前先另存一份 2.0 库）；",
        "3. 用 ResumeForge 1.0.2 打开该数据目录。",
        "",
        "注意：",
        "- 归档包是嵌套整包，2.0 导入侧会以「来自 1.x」明确拒收；",
        "  需要其中的数据时请用 ResumeForge 1.0.2 恢复，或从包内 resume_forge.db 手工提取。",
        "- 不要删除本目录；它不会随之后的自动备份再次进包，也不会被 2.0 改动。",
    ]
    readme = archive_root / ARCHIVE_README_NAME
    readme.write_text("\n".join(lines) + "\n", encoding="utf-8")


__all__ = [
    "ARCHIVE_DIRNAME",
    "ARCHIVE_FILES_DIRNAME",
    "ARCHIVE_PACKAGE_DIRNAME",
    "ARCHIVE_README_NAME",
    "ArchiveVerificationError",
    "LegacyArchiveError",
    "archive_pre_2_0_library",
    "archive_zip_path",
    "move_library_aside",
    "restore_library",
    "verify_archive",
]

"""备份导出：生成压缩包（职责④）。

附件（``user_files``/``referral_images``）**按数据库内容收集引用后装包**（PR-15）：
不再整目录拷贝——多份导入数据集共用同一个磁盘目录，整目录装包会把别的数据集的
文件一起带走（跨数据集隐私泄漏）。每份库的引用清单与逐文件 SHA-256 记在包内
``asset_manifest`` 段（见 ``asset_manifest.py``），恢复后逐文件复核。
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import zipfile
from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError

from ...database_migrations import backup_sqlite_database, snapshot_sqlite_file
from ...dataset_registry import DatasetError, read_active_dataset_id, read_metadata
from .api_keys import _assert_no_plaintext_key, _plaintext_api_keys_in, _strip_api_keys
from .asset_manifest import ASSET_CATEGORIES, build_asset_manifest
from .asset_safety import safe_asset_path
from .global_config import build_global_llm_payload, write_global_llm_member
from .manifest import build_manifest
from .paths import (
    ARCHIVE_REFERRAL_IMAGES_PREFIX,
    ARCHIVE_USER_FILES_PREFIX,
    DATABASE_MEMBER,
    MANIFEST_MEMBER,
    BackupError,
    ExtraDatabase,
    database_path,
    dataset_asset_prefix,
)


def create_backup_archive(
    bind: Engine,
    staging_dir: Path,
    *,
    extra_databases: Sequence[ExtraDatabase] = (),
    include_api_keys: bool = False,
    include_global_llm: bool = False,
) -> Path:
    """生成导出用的压缩包并返回其路径；调用方负责在响应结束后删除。

    ``extra_databases`` 非空时会把那些数据集一并装进包里。``include_api_keys`` 是用户
    **显式勾选**的选项：勾选时密钥按本机存储形态原样带走（Windows 上是 DPAPI 密文，
    绑定当前用户与机器；换环境恢复解不开时应用按"未配置"处理，不会半途报错），而不是
    解密成明文——备份包是用户可能长期保存或转发的东西，这次导出不该新造出一份明文密钥。

    **格式号是要紧的**（见 ``build_manifest``）：带全局模型配置标 5、含密钥标 3、
    带其余数据集标 2，都是让老版本遇到读不懂的包时明确拒收（"请先升级应用再导入"），
    而不是安静地误读。``include_global_llm`` 默认 False：只有"用户可见的顶层导出"才带上，
    嵌套整包的子包不能各带一份（配置是跨数据集的，属于外层）。
    """
    active_parent = database_path(bind).parent  # 内存库等无文件情况在此给出明确错误
    staging_dir.mkdir(parents=True, exist_ok=True)

    snapshot = backup_sqlite_database(bind, output_dir=staging_dir)
    if snapshot is None:
        raise BackupError("无法创建数据库快照，请确认数据目录可写", status_code=500)

    archive_path = (
        staging_dir
        / f"resumeforge-backup-{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(8)}.zip"
    )
    extras: list[tuple[ExtraDatabase, Path]] = []
    try:
        # **每一份数据库各剥离一次密钥**：把不同数据集的明文 Key 收集到一起再统一校验，
        # 是为了让"包内任何位置都不该出现明文密钥"成为一条可断言的性质，而不是逐份靠自觉。
        # 用户勾选包含密钥时跳过剥离与最终闸——这正是该选项的语义。
        secrets_to_find: list[str] = []
        if not include_api_keys:
            secrets_to_find = _plaintext_api_keys_in(snapshot)
            _strip_api_keys(snapshot)
        for item in extra_databases:
            if not item.source.exists():
                raise BackupError(
                    f"数据集「{item.name}」的文件已不存在，无法一并导出；"
                    "请先在列表里把它移除或改名后重试",
                    status_code=404,
                )
            copy = staging_dir / f"{secrets.token_hex(8)}.db"
            snapshot_sqlite_file(item.source, copy)
            if not include_api_keys:
                secrets_to_find.extend(_plaintext_api_keys_in(copy))
                _strip_api_keys(copy)
            # 资产清单**按这份库自己的内容**收集，引用根是源库所在目录（不是快照副本
            # 的位置）：多份数据集共享同一磁盘目录时，只有被这份库登记过的文件才进包。
            item = replace(
                item,
                asset_manifest=build_asset_manifest(
                    copy, item.source.parent, known_missing=_import_missing(item.dataset_id)
                ),
            )
            extras.append((item, copy))
        if not include_api_keys:
            _assert_no_plaintext_key(snapshot, secrets_to_find)
            for _, copy in extras:
                _assert_no_plaintext_key(copy, secrets_to_find)

        active_asset_manifest = build_asset_manifest(
            snapshot, active_parent, known_missing=_import_missing(read_active_dataset_id())
        )
        global_payload = (
            build_global_llm_payload(include_api_keys=include_api_keys)
            if include_global_llm
            else None
        )
        global_count = len(global_payload["profiles"]) if global_payload is not None else None
        manifest = build_manifest(
            bind,
            datasets=[item.manifest_entry(copy.stat().st_size) for item, copy in extras],
            api_key_included=include_api_keys,
            asset_manifest=active_asset_manifest,
            snapshot=snapshot,
            global_llm_profiles=global_count,
        )
        with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot, DATABASE_MEMBER)
            _write_assets(
                archive,
                active_parent,
                active_asset_manifest,
                {
                    "user_files": ARCHIVE_USER_FILES_PREFIX,
                    "referral_images": ARCHIVE_REFERRAL_IMAGES_PREFIX,
                },
            )
            for item, copy in extras:
                archive.write(copy, item.member)
                archive.writestr(
                    item.metadata_member,
                    json.dumps({"name": item.name, **item.metadata}, ensure_ascii=False, indent=2),
                )
                _write_assets(
                    archive,
                    item.source.parent,
                    item.asset_manifest,
                    {
                        category: dataset_asset_prefix(item.dataset_id, category)
                        for category in ASSET_CATEGORIES
                    },
                )
            written = write_global_llm_member(archive, global_payload)
            if written != (global_count or 0):  # pragma: no cover - 不可达的防御
                raise BackupError("全局模型配置写入失败，已停止导出", status_code=500)
            archive.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))
    except BackupError:
        archive_path.unlink(missing_ok=True)
        raise
    except (OSError, sqlite3.Error, SQLAlchemyError) as exc:
        archive_path.unlink(missing_ok=True)
        raise BackupError(f"生成备份文件失败：{exc}", status_code=500) from exc
    finally:
        snapshot.unlink(missing_ok=True)
        for _, copy in extras:
            copy.unlink(missing_ok=True)
    return archive_path


def _import_missing(dataset_id: str) -> dict[str, set[str]]:
    """数据集**导入时**就已缺失的附件名单（来自其元数据里的原始包清单）。

    这些文件在导入那一刻就不在，不是后来丢的；导出时把它们与"新缺失"分开记，
    界面才不会每次都报"备份不完整"（H2）。
    """
    try:
        metadata = read_metadata(dataset_id)
    except (DatasetError, OSError):
        return {}
    manifest = metadata.get("manifest")
    section = manifest.get("asset_manifest") if isinstance(manifest, dict) else None
    if not isinstance(section, dict):
        return {}
    known: dict[str, set[str]] = {}
    for category in ASSET_CATEGORIES:
        names = section.get(f"{category}_missing")
        if isinstance(names, list):
            known[category] = {name for name in names if isinstance(name, str)}
    return known


def _write_assets(
    archive: zipfile.ZipFile,
    assets_root: Path,
    asset_manifest: dict | None,
    prefixes: dict[str, str],
) -> int:
    """把清单声明且磁盘上确实存在的附件装进包里，返回装包的文件数。

    只装清单里的文件：清单是按库内容收集的引用集合，因此目录里没被引用的文件
    （包括**其他数据集**落在同一目录里的文件）天然不会进包。清单里声明了但磁盘
    上已不存在的文件记在 ``<category>_missing`` 段随包走，恢复侧能如实告知用户。
    """
    written = 0
    for category, prefix in prefixes.items():
        for entry in (asset_manifest or {}).get(category) or []:
            source = safe_asset_path(assets_root / category, entry["name"])
            digest, size = hashlib.sha256(), 0
            try:
                with (
                    source.open("rb") as handle,
                    archive.open(f"{prefix}{entry['name']}", "w") as out,
                ):
                    for chunk in iter(lambda: handle.read(1 << 20), b""):
                        size += len(chunk)
                        if size > entry["size_bytes"]:
                            raise BackupError("备份导出期间附件发生变化，已停止导出，请重试")
                        digest.update(chunk)
                        out.write(chunk)
            except OSError as exc:
                raise BackupError("备份导出期间附件不可读取，已停止导出，请重试") from exc
            if size != entry["size_bytes"] or digest.hexdigest() != entry["sha256"]:
                raise BackupError("备份导出期间附件发生变化，已停止导出，请重试")
            written += 1
    return written

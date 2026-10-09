"""备份导出：生成压缩包（职责④）。"""

from __future__ import annotations

import json
import secrets
import sqlite3
import zipfile
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from sqlalchemy import Engine

from ...database_migrations import backup_sqlite_database, snapshot_sqlite_file
from .api_keys import _assert_no_plaintext_key, _plaintext_api_keys_in, _strip_api_keys
from .manifest import build_manifest
from .paths import (
    ARCHIVE_REFERRAL_IMAGES_PREFIX,
    DATABASE_MEMBER,
    MANIFEST_MEMBER,
    BackupError,
    ExtraDatabase,
    database_path,
)


def create_backup_archive(
    bind: Engine,
    staging_dir: Path,
    *,
    extra_databases: Sequence[ExtraDatabase] = (),
    include_api_keys: bool = False,
) -> Path:
    """生成导出用的压缩包并返回其路径；调用方负责在响应结束后删除。

    ``extra_databases`` 非空时会把那些数据集一并装进包里。``include_api_keys`` 是用户
    **显式勾选**的选项：勾选时密钥按本机存储形态原样带走（Windows 上是 DPAPI 密文，
    绑定当前用户与机器；换环境恢复解不开时应用按"未配置"处理，不会半途报错），而不是
    解密成明文——备份包是用户可能长期保存或转发的东西，这次导出不该新造出一份明文密钥。

    **格式号是要紧的**（见 ``build_manifest``）：含密钥标 3、带其余数据集标 2，都是让
    老版本遇到读不懂的包时明确拒收（"请先升级应用再导入"），而不是安静地误读。
    """
    database_path(bind)  # 内存库等无文件情况在此给出明确错误
    staging_dir.mkdir(parents=True, exist_ok=True)

    snapshot = backup_sqlite_database(bind, output_dir=staging_dir)
    if snapshot is None:
        raise BackupError("无法创建数据库快照，请确认数据目录可写", status_code=500)

    archive_path = staging_dir / f"resumeforge-backup-{datetime.now():%Y%m%d-%H%M%S}.zip"
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
            extras.append((item, copy))
        if not include_api_keys:
            _assert_no_plaintext_key(snapshot, secrets_to_find)
            for _, copy in extras:
                _assert_no_plaintext_key(copy, secrets_to_find)

        manifest = build_manifest(
            bind,
            datasets=[
                item.manifest_entry(copy.stat().st_size) for item, copy in extras
            ],
            api_key_included=include_api_keys,
        )
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot, DATABASE_MEMBER)
            _write_referral_images(archive, database_path(bind).parent)
            for item, copy in extras:
                archive.write(copy, item.member)
                archive.writestr(
                    item.metadata_member,
                    json.dumps(
                        {"name": item.name, **item.metadata}, ensure_ascii=False, indent=2
                    ),
                )
            archive.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))
    except (OSError, sqlite3.Error) as exc:
        archive_path.unlink(missing_ok=True)
        raise BackupError(f"生成备份文件失败：{exc}", status_code=500) from exc
    finally:
        snapshot.unlink(missing_ok=True)
        for _, copy in extras:
            copy.unlink(missing_ok=True)
    return archive_path


def _write_referral_images(archive: zipfile.ZipFile, database_parent: Path) -> int:
    """把库同目录的内推备注图片装进备份包，返回装包的文件数。

    这些图片是主库级磁盘资产（路径存在 referral 表里，内容此前不进包）——换机器
    恢复后会整体丢失。目录不存在（从没传过内推图）就什么都不装；成员名统一为
    ``referral_images/<文件名>``，manifest 格式不动，老版本读到多余成员会忽略，
    而它们的清单校验只看主库成员与 manifest，不受影响。
    """
    directory = database_parent / ARCHIVE_REFERRAL_IMAGES_PREFIX.rstrip("/")
    if not directory.is_dir():
        return 0
    written = 0
    for image in sorted(directory.iterdir()):
        if image.is_file():
            archive.write(image, f"{ARCHIVE_REFERRAL_IMAGES_PREFIX}{image.name}")
            written += 1
    return written


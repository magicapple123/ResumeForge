# SPDX-License-Identifier: Apache-2.0
"""Bounded ZIP extraction and strict asset-manifest validation (including extra datasets)."""

from __future__ import annotations

import hashlib
import re
import zipfile
from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import Any, BinaryIO
from weakref import WeakKeyDictionary

from ...config import get_settings
from .asset_categories import ASSET_CATEGORIES
from .asset_safety import asset_name_key, safe_asset_name
from .paths import BackupError

MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 20_000
_HASH = re.compile(r"[0-9a-fA-F]{64}\Z")
# 资产类别只有一份定义（``asset_categories``）：这里再手写一遍就等于给自己留一个
# "加类别忘了改这里，导入时清单段被静默忽略"的坑。
_CATEGORIES = ASSET_CATEGORIES
_CHUNK_BYTES = 1 << 20
_VALIDATED_READERS: WeakKeyDictionary[zipfile.ZipFile, int] = WeakKeyDictionary()


def archive_byte_limit() -> int:
    return int(getattr(get_settings(), "max_backup_uncompressed_mb", 4096)) * 1024 * 1024


def validate_archive(archive: zipfile.ZipFile) -> None:
    limit = archive_byte_limit()
    if archive.mode == "r" and _VALIDATED_READERS.get(archive) == limit:
        return
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_MEMBERS:
        raise BackupError("备份包成员数量超过恢复预算，已停止导入")
    seen: set[str] = set()
    total = 0
    for info in infos:
        name = info.filename
        parts = PurePosixPath(name).parts
        if (
            not parts
            or name.startswith("/")
            or "\\" in name
            or any(part in (".", "..") for part in name.rstrip("/").split("/"))
        ):
            raise BackupError("备份包包含不合法的成员路径，已停止导入")
        for part in parts:
            safe_asset_name(part)
        key = "/".join(asset_name_key(part) for part in parts)
        if key in seen or info.flag_bits & 1:
            raise BackupError("备份包包含重复或加密成员，已停止导入")
        seen.add(key)
        total += info.file_size
        if info.file_size < 0 or total > limit:
            raise BackupError("备份包解压体积超过恢复预算，已停止导入")
    if (
        "manifest.json" in archive.namelist()
        and archive.getinfo("manifest.json").file_size > MAX_MANIFEST_BYTES
    ):
        raise BackupError("备份包清单过大，已停止导入")
    if archive.mode == "r":
        # A read-only ZipFile has an immutable central directory for this handle.
        # Re-opening a changed package always validates again; a weak key avoids leaks.
        _VALIDATED_READERS[archive] = limit


def validate_asset_section(section: Mapping[str, Any]) -> None:
    if type(section.get("manifest_version")) is not int or section.get("manifest_version") != 1:
        raise BackupError("备份包的资产清单版本不受支持，请先升级应用再导入")
    for category in _CATEGORIES:
        entries = section.get(category, [])
        if not isinstance(entries, list):
            raise BackupError("备份包的资产清单字段格式不合法，已停止导入")
        seen: set[str] = set()
        for entry in entries:
            if not isinstance(entry, Mapping):
                raise BackupError("备份包的资产清单条目格式不合法，已停止导入")
            name = safe_asset_name(entry.get("name"), category)
            size, digest = entry.get("size_bytes"), entry.get("sha256")
            if (
                type(size) is not int
                or size < 0
                or size > archive_byte_limit()
                or not isinstance(digest, str)
                or not _HASH.fullmatch(digest)
            ):
                raise BackupError("备份包的资产清单缺少合法的大小或 SHA-256，已停止导入")
            key = asset_name_key(name)
            if key in seen:
                raise BackupError("备份包的资产清单包含重复或别名文件，已停止导入")
            seen.add(key)
        for suffix in ("missing", "mismatched"):
            values = section.get(f"{category}_{suffix}", [])
            if not isinstance(values, list):
                raise BackupError("备份包的附件告警字段格式不合法，已停止导入")
            for name in values:
                safe_asset_name(name, category)


def validate_manifest_assets(manifest: Mapping[str, Any]) -> None:
    tables = manifest.get("tables", {})
    if not isinstance(tables, Mapping) or any(
        not isinstance(table, str) or type(count) is not int or count < 0
        for table, count in tables.items()
    ):
        raise BackupError("备份包的数据库计数字段格式不合法，已停止导入")
    datasets = manifest.get("datasets", [])
    if not isinstance(datasets, list) or any(not isinstance(entry, Mapping) for entry in datasets):
        raise BackupError("备份包的数据集清单格式不合法，已停止导入")
    seen_datasets: set[str] = set()
    for entry in datasets:
        dataset_id = entry.get("id")
        if (
            not isinstance(dataset_id, str)
            or not re.fullmatch(r"(?:main|[0-9a-f]{16})", dataset_id)
            or entry.get("file") != f"datasets/{dataset_id}.db"
            or type(entry.get("size_bytes")) is not int
            or entry["size_bytes"] < 0
            or entry["size_bytes"] > archive_byte_limit()
        ):
            raise BackupError("备份包的数据集成员路径不合法或大小字段无效，已停止导入")
        if dataset_id in seen_datasets:
            raise BackupError("备份包包含重复的数据集清单段，已停止导入")
        seen_datasets.add(dataset_id)
    for container in (manifest, *datasets):
        section = container.get("asset_manifest")
        if section is not None:
            if not isinstance(section, Mapping):
                raise BackupError("备份包的资产清单格式不合法，已停止导入")
            validate_asset_section(section)


def copy_archive_member(archive: zipfile.ZipFile, member: str, target: BinaryIO) -> tuple[int, str]:
    """Validate metadata first and enforce the live byte budget while reading (CRC included)."""
    validate_archive(archive)
    info = archive.getinfo(member)
    digest, size = hashlib.sha256(), 0
    with archive.open(info) as source:
        for chunk in iter(lambda: source.read(_CHUNK_BYTES), b""):
            size += len(chunk)
            if size > info.file_size or size > archive_byte_limit():
                raise BackupError("备份包成员解压体积超过声明或恢复预算，已停止导入")
            target.write(chunk)
            digest.update(chunk)
    if size != info.file_size:
        raise BackupError("备份包成员内容不完整，已停止导入")
    return size, digest.hexdigest()

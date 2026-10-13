"""备份包的**资产清单**（PR-15）：按数据库内容收集附件引用，逐文件可校验。

此前备份导出把"数据库同目录的 ``user_files/``、``referral_images/`` **整目录**"
装进包。这有两个问题：多份导入数据集共用 ``data/datasets/user_files``，整目录
装包会把**别的数据集**的文件一起带走（跨数据集隐私泄漏）；而"导出全部数据集"
时随包数据集根本不带附件（导入库位置的资产被整包漏掉）。

这里改为**按引用收集**：读数据库里真正登记过资产引用的表（``user_file.disk_name``
登记"我的文件"落盘副本；``referral.note_images`` 登记 ``referral_images/<文件名>``
相对路径），只把被引用到的文件装包，并对每份文件记录大小与 SHA-256——导入恢复后
逐文件复核，缺文件/hash 不符都**显式列入问题清单**，绝不静默成功。

清单格式（``manifest.json`` 里的 ``asset_manifest`` 段，随包数据集在其条目内同名字段）::

    {
        "manifest_version": 1,
        "user_files":       [{"name": ..., "size_bytes": ..., "sha256": ...}],
        "referral_images":  [...],
        "user_files_missing": ["磁盘上已找不到的被引用文件"]   # 仅在有时出现
    }

包内成员名：活动数据集沿用老位置（``user_files/``、``referral_images/``，老版本
可读）；随包数据集用 ``datasets/<id>/<category>/<name>``（命名空间隔离）。旧备份
包没有这一段——导入侧回退到旧的"遍历扁平成员"逻辑，向后兼容。
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import sqlite3
import zipfile
from collections.abc import Mapping
from contextlib import closing
from pathlib import Path
from typing import Any

from .paths import BackupError

logger = logging.getLogger(__name__)

# 资产清单的格式号：结构变化时递增，老代码遇到更大的号必须明确拒收（fail-closed），
# 不能安静地按自己认识的形状误读。
ASSET_MANIFEST_VERSION = 1

# 资产类别：目录名同时是磁盘目录名（相对数据库所在目录）与清单/包内前缀。
ASSET_CATEGORIES = ("user_files", "referral_images")

_HASH_CHUNK = 1 << 20  # 1 MB：大附件逐块读，不整份载入内存


def file_digest(path: Path) -> tuple[int, str]:
    """流式计算（字节数, sha256），不把整份文件读进内存。"""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_HASH_CHUNK), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def _json_string_list(value: Any) -> list[str]:
    if not isinstance(value, str) or not value:
        return []
    try:
        parsed = json.loads(value)
    except ValueError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, str)]


def _referral_image_name(entry: str) -> str | None:
    """``referral_images/<文件名>`` → ``<文件名>``；形状不对（含穿越/反斜杠）返回 None。"""
    prefix = "referral_images/"
    if not entry.startswith(prefix):
        return None
    name = entry[len(prefix) :]
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    return name


def collect_referenced_names(database: Path) -> dict[str, set[str]]:
    """从一份数据库（只读连接）收集它**实际引用**的资产文件名，按类别分组。

    表或列不存在（极老的库/非业务库）按"没有引用"处理——备份工具不该因为读到
    一个空库而失败。
    """
    referenced: dict[str, set[str]] = {category: set() for category in ASSET_CATEGORIES}
    try:
        connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        return referenced
    with closing(connection):
        try:
            rows = connection.execute("SELECT disk_name FROM user_file").fetchall()
        except sqlite3.Error:
            rows = []
        for row in rows:
            name = row[0] if row else None
            if isinstance(name, str) and name and "/" not in name and "\\" not in name:
                referenced["user_files"].add(name)
        try:
            rows = connection.execute("SELECT note_images FROM referral").fetchall()
        except sqlite3.Error:
            rows = []
        for row in rows:
            for entry in _json_string_list(row[0] if row else None):
                name = _referral_image_name(entry)
                if name:
                    referenced["referral_images"].add(name)
    return referenced


def build_asset_manifest(database: Path, assets_root: Path) -> dict[str, Any]:
    """为一份数据库生成资产清单：只收该库引用到的文件，逐文件记 size + sha256。

    ``assets_root`` 是磁盘资产的根（该数据库所在目录；类别目录在其下）。库引用了
    但磁盘上已不存在的文件记入 ``<category>_missing``——导出时如实记录，恢复时
    用户能看到"这份备份本来就不完整"，而不是以为附件都齐了。
    """
    referenced = collect_referenced_names(database)
    manifest: dict[str, Any] = {"manifest_version": ASSET_MANIFEST_VERSION}
    for category in ASSET_CATEGORIES:
        entries: list[dict[str, Any]] = []
        missing: list[str] = []
        directory = assets_root / category
        for name in sorted(referenced[category]):
            file_path = directory / name
            try:
                size, digest = file_digest(file_path)
            except OSError:
                missing.append(name)
                continue
            entries.append({"name": name, "size_bytes": size, "sha256": digest})
        manifest[category] = entries
        if missing:
            manifest[f"{category}_missing"] = missing
    return manifest


def _assert_safe_asset_name(name: Any, category: str) -> str:
    """清单条目里的文件名只认单段安全名字：挡住构造出来的路径穿越。"""
    if not isinstance(name, str) or not name or "/" in name or "\\" in name or name.startswith("."):
        raise BackupError(f"备份包的资产清单里 {category} 有一个不合法的文件名，已停止恢复")
    return name


def restore_assets_from_manifest(
    archive_path: Path,
    asset_manifest: Mapping[str, Any],
    *,
    prefixes: Mapping[str, str],
    destinations: Mapping[str, Path],
) -> tuple[dict[str, int], list[str]]:
    """按清单把附件恢复到目标目录，逐文件复核 sha256，返回（恢复数, 问题清单）。

    ``prefixes``/``destinations`` 按 ``ASSET_CATEGORIES`` 里的类别给出口径：前缀是
    包内成员前缀（活动数据集 ``user_files/``，随包数据集 ``datasets/<id>/user_files/``），
    目标是磁盘目录。目标已存在的同名文件**会被包内内容覆盖**——落盘名按内容指纹生成，
    同名即同内容，覆盖是安全的；万一不同（被篡改的包），覆盖恰好是恢复动作，且 hash
    复核会把原状态记录进问题清单。
    """
    restored: dict[str, int] = {category: 0 for category in ASSET_CATEGORIES}
    issues: list[str] = []
    with zipfile.ZipFile(archive_path) as archive:
        members = set(archive.namelist())
        for category in ASSET_CATEGORIES:
            prefix = prefixes[category]
            destination = destinations[category]
            for entry in asset_manifest.get(category) or []:
                if not isinstance(entry, dict):
                    issues.append(f"{category}：资产清单里有一条无法识别的条目")
                    continue
                name = _assert_safe_asset_name(entry.get("name"), category)
                member = f"{prefix}{name}"
                if member not in members:
                    issues.append(f"{category}/{name}：备份包中缺少该附件")
                    continue
                destination.mkdir(parents=True, exist_ok=True)
                target = destination / name
                with archive.open(member) as source, target.open("wb") as target_file:
                    shutil.copyfileobj(source, target_file)
                restored[category] += 1
                # 写完**实际读回来**复核：恢复成功必须以磁盘上的字节为准，不凭"写没报错"。
                issues.extend(_verify_one(target, category, name, entry))
    return restored, issues


def _verify_one(path: Path, category: str, name: str, entry: Mapping[str, Any]) -> list[str]:
    """复核一份恢复出来的文件：大小与 sha256 与清单一致；不一致显式报问题。"""
    try:
        size, digest = file_digest(path)
    except OSError as exc:
        return [f"{category}/{name}：恢复后无法读取（{exc}）"]
    expected_size = entry.get("size_bytes")
    if isinstance(expected_size, int) and size != expected_size:
        return [f"{category}/{name}：恢复后大小不符（期望 {expected_size}，实际 {size}）"]
    expected_digest = entry.get("sha256")
    if isinstance(expected_digest, str) and digest != expected_digest:
        return [f"{category}/{name}：内容校验不一致（SHA-256 与清单不符）"]
    return []


def verify_restored_assets(
    asset_manifest: Mapping[str, Any], destinations: Mapping[str, Path]
) -> list[str]:
    """对**已恢复**的资产目录整体复核一遍清单：文件在、大小对、hash 对。

    这是"恢复到新目录后实际读取验证"的独立入口：不依赖恢复过程的内存状态，
    直接以磁盘现状对照清单，供导入流程在收尾时调用。
    """
    issues: list[str] = []
    for category in ASSET_CATEGORIES:
        destination = destinations[category]
        for entry in asset_manifest.get(category) or []:
            if not isinstance(entry, dict):
                continue
            try:
                name = _assert_safe_asset_name(entry.get("name"), category)
            except BackupError:
                issues.append(f"{category}：资产清单里有一条不合法的文件名")
                continue
            issues.extend(_verify_one(destination / name, category, name, entry))
    return issues


def verify_database_rows(database: Path, expected_counts: Mapping[str, Any]) -> list[str]:
    """恢复后按清单复核数据库关键行数；表缺失或行数不符都列入问题清单。

    行数是导出时刻的一致性快照（清单 ``tables`` 段）。导入会把候选库迁移到当前
    head——迁移只加表/加列、不搬业务行，所以既有表的行数在恢复后应当分毫不差；
    对不上就说明包被改过或恢复过程出了问题，必须让用户看见。
    """
    issues: list[str] = []
    if not expected_counts:
        return issues
    try:
        connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        return [f"恢复后的数据库无法打开（{exc}）"]
    with closing(connection):
        try:
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
        except sqlite3.DatabaseError as exc:
            return [f"恢复后的数据库无法读取表清单（{exc}）"]
        for table, expected in expected_counts.items():
            if table not in tables:
                issues.append(f"表 {table} 在恢复后的数据库中不存在")
                continue
            try:
                actual = connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            except sqlite3.DatabaseError as exc:
                issues.append(f"表 {table} 无法统计行数（{exc}）")
                continue
            if actual != expected:
                issues.append(f"表 {table} 行数不符（期望 {expected}，实际 {actual}）")
    return issues


__all__ = [
    "ASSET_CATEGORIES",
    "ASSET_MANIFEST_VERSION",
    "build_asset_manifest",
    "collect_referenced_names",
    "file_digest",
    "restore_assets_from_manifest",
    "verify_database_rows",
    "verify_restored_assets",
]

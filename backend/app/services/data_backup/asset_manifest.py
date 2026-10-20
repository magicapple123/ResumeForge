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
import sqlite3
from collections.abc import Mapping
from contextlib import closing
from pathlib import Path
from typing import Any

from .asset_safety import safe_asset_name, safe_asset_path

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
            if isinstance(name, str) and name:
                referenced["user_files"].add(safe_asset_name(name, "user_files"))
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


def _recorded_user_file_digests(database: Path) -> dict[str, str]:
    """读回 ``user_file`` 登记的 ``disk_name -> sha256``（RR-03）。

    清单里已经记了"导出时磁盘上的字节哈希"；把数据库登记的哈希也读出来，就能区分
    "文件不见了"（missing）与"文件还在但内容已经不是它登记的那一份"（mismatched）——
    后者意味着磁盘被外力改过，导出的备份不该被当成完整备份。
    """
    digests: dict[str, str] = {}
    try:
        connection = sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True)
    except sqlite3.Error:
        return digests
    with closing(connection):
        try:
            rows = connection.execute("SELECT disk_name, sha256 FROM user_file").fetchall()
        except sqlite3.Error:
            return digests
        for row in rows:
            name, digest = row if row else (None, None)
            if isinstance(name, str) and name and isinstance(digest, str) and digest:
                digests[name] = digest
    return digests


def build_asset_manifest(
    database: Path,
    assets_root: Path,
    *,
    known_missing: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """为一份数据库生成资产清单：只收该库引用到的文件，逐文件记 size + sha256。

    ``assets_root`` 是磁盘资产的根（该数据库所在目录；类别目录在其下）。库引用了
    但磁盘上已不存在的文件记入 ``<category>_missing``——导出时如实记录，恢复时
    用户能看到"这份备份本来就不完整"，而不是以为附件都齐了。

    ``user_file`` 登记过哈希的资产再比一次实际字节：对不上进 ``<category>_mismatched``
    （RR-03：导出侧的"完整备份"标签要以此为准，不能只报"没缺文件"）。

    ``known_missing``（H2）是数据集**导入时**就已缺失的名单。它们现在仍然缺，但
    不该被算成"这次导出丢了文件"——记到 ``<category>_missing_at_import``，只做说明，
    不触发 ``X-Backup-Incomplete``。
    """
    referenced = collect_referenced_names(database)
    recorded = _recorded_user_file_digests(database)
    already_missing = {
        category: {
            name for name in (known_missing or {}).get(category, []) if isinstance(name, str)
        }
        for category in ASSET_CATEGORIES
    }
    manifest: dict[str, Any] = {"manifest_version": ASSET_MANIFEST_VERSION}
    for category in ASSET_CATEGORIES:
        entries: list[dict[str, Any]] = []
        missing: list[str] = []
        missing_at_import: list[str] = []
        mismatched: list[str] = []
        directory = assets_root / category
        for name in sorted(referenced[category]):
            file_path = safe_asset_path(directory, name)
            try:
                size, digest = file_digest(file_path)
            except OSError:
                if name in already_missing[category]:
                    missing_at_import.append(name)
                else:
                    missing.append(name)
                continue
            entries.append({"name": name, "size_bytes": size, "sha256": digest})
            expected = recorded.get(name)
            if expected and expected != digest:
                mismatched.append(name)
        manifest[category] = entries
        if missing:
            manifest[f"{category}_missing"] = missing
        if missing_at_import:
            manifest[f"{category}_missing_at_import"] = missing_at_import
        if mismatched:
            manifest[f"{category}_mismatched"] = mismatched
    return manifest


def _assert_safe_asset_name(name: Any, category: str) -> str:
    """清单条目里的文件名只认单段安全名字：挡住构造出来的路径穿越。"""
    return safe_asset_name(name, category)


def _manifest_sections(manifest: Mapping[str, Any] | None) -> list[tuple[str, Mapping[str, Any]]]:
    """主段 + 每个随包数据集段的 (标签, 清单)；顺序稳定，便于计数与展示对齐。"""
    if not isinstance(manifest, Mapping):
        return []
    sections: list[tuple[str, Any]] = [("", manifest.get("asset_manifest"))]
    datasets = manifest.get("datasets")
    if isinstance(datasets, list):
        for entry in datasets:
            if isinstance(entry, dict):
                sections.append(
                    (str(entry.get("name") or "随包数据集"), entry.get("asset_manifest"))
                )
    return [(label, section) for label, section in sections if isinstance(section, Mapping)]


def manifest_asset_counts(manifest: Mapping[str, Any] | None) -> dict[str, int]:
    """附件告警的**计数**（H2）：新缺失 / 哈希不符 / 导入时就缺。

    导出响应头是 ASCII，只能放数字；前端按这三个数分开写文案，不再把"导入时就缺"
    也笼统说成"备份不完整"。
    """
    counts = {"missing": 0, "mismatched": 0, "missing_at_import": 0}
    for _label, section in _manifest_sections(manifest):
        for category in ASSET_CATEGORIES:
            for key, bucket in (
                ("missing", "missing"),
                ("mismatched", "mismatched"),
                ("missing_at_import", "missing_at_import"),
            ):
                names = section.get(f"{category}_{key}")
                if isinstance(names, list):
                    counts[bucket] += sum(1 for name in names if isinstance(name, str))
    return counts


def manifest_asset_notes(manifest: Mapping[str, Any] | None) -> list[str]:
    """只做说明、不算"不完整"的条目：导入时就已缺失的附件。"""
    notes: list[str] = []
    for label, section in _manifest_sections(manifest):
        prefix = f"{label}：" if label else ""
        for category in ASSET_CATEGORIES:
            names = [
                name
                for name in section.get(f"{category}_missing_at_import") or []
                if isinstance(name, str)
            ]
            if names:
                notes.append(
                    f"{prefix}该数据集导入时就缺 {len(names)} 个被引用的附件（"
                    + "、".join(names[:3])
                    + ("…" if len(names) > 3 else "")
                    + "），已在包内清单注明"
                )
    return notes


def manifest_asset_warnings(manifest: Mapping[str, Any] | None) -> list[str]:
    """汇总一份备份清单里的附件告警（主段 + 每个随包数据集段）。

    两种告警都属于"这份备份不完整"，导出方与导入方都要如实说出口：

    - ``<category>_missing``：导出时这个被引用的附件在磁盘上已经找不到了；
    - ``<category>_mismatched``：文件还在，但内容与数据库登记的 SHA-256 不符
      （磁盘被外力改过），装进包的其实是"当前磁盘上的那一份"。

    导出侧用它在响应头里标出"这份包不完整"，导入侧用它提示用户别把它当成完整备份。
    """
    warnings: list[str] = []
    for label, section in _manifest_sections(manifest):
        prefix = f"{label}：" if label else ""
        for category in ASSET_CATEGORIES:
            missing = [
                name for name in section.get(f"{category}_missing") or [] if isinstance(name, str)
            ]
            mismatched = [
                name
                for name in section.get(f"{category}_mismatched") or []
                if isinstance(name, str)
            ]
            if missing:
                warnings.append(
                    f"{prefix}备份导出时就缺少 {len(missing)} 个被引用的附件（"
                    + "、".join(missing[:3])
                    + ("…" if len(missing) > 3 else "")
                    + "），这份备份不完整"
                )
            if mismatched:
                warnings.append(
                    f"{prefix}{len(mismatched)} 个附件的内容与数据库登记的哈希不符（"
                    + "、".join(mismatched[:3])
                    + ("…" if len(mismatched) > 3 else "")
                    + "），备份里装的是当前磁盘上的字节"
                )
    return warnings


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
                quoted_table = str(table).replace('"', '""')
                actual = connection.execute(f'SELECT COUNT(*) FROM "{quoted_table}"').fetchone()[0]
            except sqlite3.DatabaseError as exc:
                issues.append(f"表 {table} 无法统计行数（{exc}）")
                continue
            if actual != expected:
                issues.append(f"表 {table} 行数不符（期望 {expected}，实际 {actual}）")
    return issues


# 恢复侧（先验后发布、冲突检测）在 ``asset_restore.py``：它 import 本模块的
# ``ASSET_CATEGORIES`` / ``file_digest`` / ``_assert_safe_asset_name``，所以**这里
# 不能反向 re-export**（会形成循环导入）。调用方直接 ``from .asset_restore import ...``。


__all__ = [
    "ASSET_CATEGORIES",
    "ASSET_MANIFEST_VERSION",
    "build_asset_manifest",
    "collect_referenced_names",
    "file_digest",
    "manifest_asset_counts",
    "manifest_asset_notes",
    "manifest_asset_warnings",
    "verify_database_rows",
]

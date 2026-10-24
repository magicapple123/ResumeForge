# SPDX-License-Identifier: Apache-2.0
"""资产恢复的**先验后发布**实现（RR-03）。

与 ``asset_manifest.py``（导出侧：按引用收集、逐文件记哈希）相对，这里管导入侧：

1. :class:`AssetRestorePlan` 只读预检（成员存在性 / 大小 / SHA-256 / 文件名合法性）
   并把通过的字节写进私有暂存，**目标目录一个字节都不写**；
2. 与本机现状做冲突检测：同名同内容算"已满足"，同名不同内容**绝不覆盖**；
3. :meth:`AssetRestorePlan.publish` 在调用方决定继续之后逐文件原子占用新文件名，
   已存在的目标绝不替换；:meth:`discard` 清掉本次私有暂存。

设计取舍见 ``docs/adr/ADR-0005-backup-restore-verify-before-publish.md``；
模块从 ``asset_manifest.py`` 拆出只是为了回到单文件行数预算，行为与拆分前一致。
"""

from __future__ import annotations

import logging
import shutil
import zipfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .archive_guard import copy_archive_member, validate_archive, validate_asset_section
from .asset_manifest import ASSET_CATEGORIES, _assert_safe_asset_name, file_digest
from .asset_safety import asset_name_key, publish_new_file, safe_asset_path
from .paths import BackupError

logger = logging.getLogger(__name__)

_HASH_CHUNK = 1 << 20  # 1 MB：大附件逐块读，不整份载入内存


def _stream_member_to_file(archive: zipfile.ZipFile, member: str, staged: Path) -> tuple[int, str]:
    """把包内成员流式写进暂存文件，同时算出（字节数, sha256）——不解压完再读一遍。"""
    safe_asset_path(staged.parent, staged.name)
    staged.parent.mkdir(parents=True, exist_ok=True)
    with staged.open("xb") as target:
        return copy_archive_member(archive, member, target)


@dataclass
class _StagedAsset:
    """一份已通过校验、等待发布的附件（**还没写进目标目录**）。"""

    category: str
    name: str
    staged_path: Path
    destination: Path
    sha256: str
    section: str


class AssetRestorePlan:
    """一次导入的资产计划：**先只读预检 + 私有暂存，全部通过后才发布**（RR-03）。

    修复前的顺序是"打开目标文件直接写、写完再复核"：包里的字节先落到共享的
    ``user_files`` / ``referral_images`` 目录，核对失败时本机同名附件已经被覆写，
    而且主库与其余数据集在附件校验**之前**就已发布。现在把顺序倒过来：

    1. :meth:`add_section` 只读包内成员，边写暂存边算 sha256，与清单逐项核对——
       成员缺失、大小/哈希不符、文件名不合法都记为**完整性问题**；
    2. 同一遍里与本机现状做冲突检测：同名同内容算"已满足"，同名不同内容**绝不覆盖**，
       记为冲突并保留本机文件；包内跨段同名但内容不同同样记为冲突；
    3. :meth:`publish` 只在调用方确认继续之后执行，逐文件原子、不覆盖地发布
       （暂存目录与目标同处一个文件系统）；
    4. :meth:`discard` 永远清掉暂存目录：验证失败的字节不会留在磁盘上。

    ``integrity_issues`` 非空表示**这份包本身有问题**，调用方应当拒绝导入；
    ``conflicts`` 非空表示本机现状与包不一致，默认同样拒绝（由用户显式选择"跳过
    有问题的附件继续导入"时才继续），但无论如何都不会覆盖本机文件。
    """

    def __init__(self, staging_dir: Path) -> None:
        self.staging_dir = staging_dir
        # 段序号：暂存目录名只用它，**绝不**用调用方给的 label——label 里可能带
        # 备份包提供的名字（`datasets[].name` 未做校验），拼进路径就是一个
        # 用 `../` 写到暂存目录外的路径穿越（评审复现）。
        self._section_index = 0
        self.integrity_issues: list[str] = []
        self.conflicts: list[str] = []
        # 已存在且内容一致的资产：无需写入，但算"已满足"。
        self.satisfied: dict[str, int] = {category: 0 for category in ASSET_CATEGORIES}
        self._files: list[_StagedAsset] = []
        self._claimed: dict[tuple[str, str], tuple[str, str]] = {}
        self._published: list[tuple[Path, tuple[int, int], str]] = []

    def add_section(
        self,
        archive_path: Path,
        section: Mapping[str, Any] | None,
        *,
        prefixes: Mapping[str, str],
        destinations: Mapping[str, Path],
        label: str,
    ) -> None:
        """只读校验一个资产清单段并把通过的文件暂存起来；不碰目标目录。"""
        if not isinstance(section, Mapping):
            return
        validate_asset_section(section)
        self._section_index += 1
        section_dir = f"section-{self._section_index}"
        with zipfile.ZipFile(archive_path) as archive:
            validate_archive(archive)
            members = set(archive.namelist())
            for category in ASSET_CATEGORIES:
                # 旧包/旧调用方可能只提供既有两类的前缀与目的地（0059 新增
                # export_archive 后，缺省类别按"没有该段"处理，保持旧包可导入）。
                prefix = prefixes.get(category)
                destination = destinations.get(category)
                if prefix is None or destination is None:
                    continue
                for entry in section.get(category) or []:
                    if not isinstance(entry, dict):
                        self.integrity_issues.append(
                            f"{label} {category}：资产清单里有一条无法识别的条目"
                        )
                        continue
                    self._stage_entry(
                        archive, members, entry, category, prefix, destination, label, section_dir
                    )

    def add_legacy_section(
        self,
        archive_path: Path,
        *,
        prefixes: Mapping[str, str],
        destinations: Mapping[str, Path],
        label: str,
    ) -> None:
        """Stage old packages safely; ZIP CRC/size replace their unavailable producer hash.

        Compute a SHA-256 during staging so publication and rollback still verify bytes.
        No claim is made that an old package has an authenticated original-content digest.
        """
        self._section_index += 1
        with zipfile.ZipFile(archive_path) as archive:
            validate_archive(archive)
            members = set(archive.namelist())
            for category, prefix in prefixes.items():
                for info in archive.infolist():
                    if not info.filename.startswith(prefix) or info.is_dir():
                        continue
                    name = info.filename[len(prefix) :]
                    if "/" in name:
                        continue  # Legacy assets are flat; nested unrelated members are not assets.
                    self._stage_entry(
                        archive,
                        members,
                        {"name": name, "size_bytes": info.file_size},
                        category,
                        prefix,
                        destinations[category],
                        label,
                        f"section-{self._section_index}",
                    )

    def _stage_entry(
        self,
        archive: zipfile.ZipFile,
        members: set[str],
        entry: Mapping[str, Any],
        category: str,
        prefix: str,
        destination: Path,
        label: str,
        section_dir: str,
    ) -> None:
        try:
            name = _assert_safe_asset_name(entry.get("name"), category)
        except BackupError:
            self.integrity_issues.append(f"{label} 附件名不合法，已跳过")
            return
        member = f"{prefix}{name}"
        if member not in members:
            self.integrity_issues.append(f"{label} {category}/{name}：备份包中缺少该附件")
            return
        staged = safe_asset_path(self.staging_dir / section_dir / category, name)
        try:
            size, digest = _stream_member_to_file(archive, member, staged)
        except (OSError, zipfile.BadZipFile) as exc:
            logger.warning("附件 %s/%s 读出失败：%s", category, name, exc)
            self.integrity_issues.append(
                f"{label} {category}/{name}：附件无法从备份包读出，详情见服务端日志"
            )
            return

        expected_size = entry.get("size_bytes")
        expected_digest = entry.get("sha256")
        if isinstance(expected_size, int) and size != expected_size:
            staged.unlink(missing_ok=True)
            self.integrity_issues.append(
                f"{label} {category}/{name}：包内大小与清单不符（清单 {expected_size}，实际 {size}）"
            )
            return
        if isinstance(expected_digest, str) and digest != expected_digest.lower():
            staged.unlink(missing_ok=True)
            self.integrity_issues.append(
                f"{label} {category}/{name}：包内内容与清单的 SHA-256 不符（备份包已损坏或被改过）"
            )
            return

        target = safe_asset_path(destination, name)
        if target.exists():
            try:
                _, existing = file_digest(target)
            except OSError as exc:
                staged.unlink(missing_ok=True)
                logger.warning("本机同名附件 %s/%s 读取失败：%s", category, name, exc)
                self.conflicts.append(
                    f"{label} {category}/{name}：本机同名文件无法读取，详情见服务端日志"
                )
                return
            if existing == digest:
                # 本机已经是这一份内容：无需写入，也不算冲突。
                staged.unlink(missing_ok=True)
                self.satisfied[category] += 1
                return
            staged.unlink(missing_ok=True)
            self.conflicts.append(
                f"{label} {category}/{name}：本机已有同名但内容不同的附件，已保留本机文件（绝不覆盖）"
            )
            return

        key = (str(destination.absolute()), asset_name_key(name))
        claimed = self._claimed.get(key)
        if claimed is not None:
            claimed_section, claimed_digest = claimed
            staged.unlink(missing_ok=True)
            if claimed_digest != digest:
                self.conflicts.append(
                    f"{category}/{name}：备份包里有两份同名但内容不同的附件"
                    f"（{claimed_section} 与 {label}），只保留先出现的那一份"
                )
            return
        self._claimed[key] = (label, digest)
        self._files.append(
            _StagedAsset(
                category=category,
                name=name,
                staged_path=staged,
                destination=destination,
                sha256=digest,
                section=label,
            )
        )

    def blocking_issues(self) -> list[str]:
        """默认拒绝导入的理由（完整性问题 + 冲突），按出现顺序合并。"""
        return [*self.integrity_issues, *self.conflicts]

    def publish(self) -> tuple[dict[str, int], list[str]]:
        """把暂存文件原子发布到目标目录；返回（发布数, 问题清单）。

        再次检查目标：从预检到发布的这段时间里可能有人写进同名文件。内容一致就
        丢弃暂存（已满足），不一致就保留本机文件并把冲突报出来——任何情况下都
        不做覆盖式写入。
        """
        restored: dict[str, int] = {category: 0 for category in ASSET_CATEGORIES}
        issues: list[str] = []
        for item in self._files:
            target = safe_asset_path(item.destination, item.name)
            try:
                if target.exists():
                    _, existing = file_digest(target)
                    if existing == item.sha256:
                        item.staged_path.unlink(missing_ok=True)
                        restored[item.category] += 1
                        continue
                    item.staged_path.unlink(missing_ok=True)
                    issues.append(
                        f"{item.section} {item.category}/{item.name}："
                        "发布前发现本机同名文件内容不同，已保留本机文件（未覆盖）"
                    )
                    continue
                item.destination.mkdir(parents=True, exist_ok=True)
                source_info = item.staged_path.stat(follow_symlinks=False)
                try:
                    publish_new_file(item.staged_path, target)
                except FileExistsError:
                    # Another writer won the atomic destination claim after our existence check.
                    _, existing = file_digest(safe_asset_path(item.destination, item.name))
                    if existing != item.sha256:
                        issues.append(
                            f"{item.section} {item.category}/{item.name}：发布时发生同名冲突，已保留本机文件"
                        )
                        continue
                    restored[item.category] += 1
                    continue
                self._published.append(
                    (target, (source_info.st_dev, source_info.st_ino), item.sha256)
                )
                restored[item.category] += 1
            except OSError as exc:
                logger.warning("附件 %s/%s 发布失败：%s", item.category, item.name, exc)
                issues.append(
                    f"{item.section} {item.category}/{item.name}：附件发布失败，详情见服务端日志"
                )
        return restored, issues

    def rollback(self) -> None:
        """Withdraw only the files this plan published; never touch a different writer's bytes."""
        quarantine = self.staging_dir / "rollback"
        for index, (target, identity, digest) in enumerate(reversed(self._published)):
            try:
                info = target.stat(follow_symlinks=False)
                if (info.st_dev, info.st_ino) != identity or file_digest(target)[1] != digest:
                    logger.warning("附件回滚保留已被其它写入方修改的文件")
                    continue
                safe_asset_path(target.parent, target.name)
                quarantine.mkdir(parents=True, exist_ok=True)
                target.rename(quarantine / f"{index}-{target.name}")
            except FileNotFoundError:
                pass
            except (OSError, BackupError):
                logger.warning("附件回滚未完成，已保留可恢复文件", exc_info=True)
        self._published.clear()

    def merged_counts(self, restored: Mapping[str, int]) -> dict[str, int]:
        """发布数 + "本机已有一致文件"数：返回给用户的恢复口径。"""
        return {
            category: restored.get(category, 0) + self.satisfied[category]
            for category in ASSET_CATEGORIES
        }

    def discard(self) -> None:
        """清掉暂存目录（幂等）。失败只记日志：残留的是我们自己的临时文件。"""
        try:
            shutil.rmtree(self.staging_dir, ignore_errors=True)
        except OSError:  # pragma: no cover - rmtree(ignore_errors) 已吞掉
            logger.warning("资产暂存目录未能清理：%s", self.staging_dir)


def restore_assets_from_manifest(
    archive_path: Path,
    asset_manifest: Mapping[str, Any],
    *,
    prefixes: Mapping[str, str],
    destinations: Mapping[str, Path],
    staging_dir: Path,
) -> tuple[dict[str, int], list[str]]:
    """按清单恢复一个资产段：（先预检 + 暂存，再发布）的便捷封装。

    完整性问题与冲突都会进入返回的问题清单——调用方必须先检查"这次调用有没有产出
    问题"，有问题时**不得**把它当成恢复成功（导入链路用的是 :class:`AssetRestorePlan`，
    它在发布前就拿到了这些问题）。
    """
    plan = AssetRestorePlan(staging_dir)
    try:
        plan.add_section(
            archive_path,
            asset_manifest,
            prefixes=prefixes,
            destinations=destinations,
            label="活动数据集",
        )
        restored, issues = plan.publish()
        return plan.merged_counts(restored), [*plan.blocking_issues(), *issues]
    finally:
        plan.discard()


def _verify_one(path: Path, category: str, name: str, entry: Mapping[str, Any]) -> list[str]:
    """复核一份恢复出来的文件：大小与 sha256 与清单一致；不一致显式报问题。"""
    try:
        size, digest = file_digest(path)
    except OSError as exc:
        logger.warning("附件 %s/%s 恢复后读取失败：%s", category, name, exc)
        return [f"{category}/{name}：恢复后无法读取，详情见服务端日志"]
    expected_size = entry.get("size_bytes")
    if isinstance(expected_size, int) and size != expected_size:
        return [f"{category}/{name}：恢复后大小不符（期望 {expected_size}，实际 {size}）"]
    expected_digest = entry.get("sha256")
    if isinstance(expected_digest, str) and digest != expected_digest.lower():
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
    validate_asset_section(asset_manifest)
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
            try:
                path = safe_asset_path(destination, name)
                issues.extend(_verify_one(path, category, name, entry))
            except BackupError:
                issues.append(f"{category}/{name}：恢复后的附件路径不安全")
    return issues


__all__ = [
    "AssetRestorePlan",
    "restore_assets_from_manifest",
    "verify_restored_assets",
]

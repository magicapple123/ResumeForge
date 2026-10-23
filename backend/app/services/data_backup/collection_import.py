# SPDX-License-Identifier: Apache-2.0
"""嵌套整包导入（R16，格式 4）。

外层包只负责分发：逐份核对子包的**存在 + 大小 + SHA-256**，通过后解出来交给既有的
:func:`app.services.datasets.import_dataset` ——子包就是一份普通单数据集包，校验链
（清单、版本、表结构、附件）与直接导入一份备份完全一致。

隔离语义：一份子包坏了只把它记进 ``failed``，同包里其它份照常恢复；只有**全部**都
失败才整体报错（此时仍没写入任何数据）。递归只允许一层：子包本身又是格式 4 时直接
记错，不再往下拆。
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import shutil
import zipfile
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .archive_guard import validate_archive
from .paths import (
    BACKUP_FORMAT_GLOBAL_ASSETS,
    BACKUP_FORMAT_GLOBAL_CONFIG,
    BACKUP_FORMAT_NESTED_COLLECTION,
    MANIFEST_MEMBER,
    BackupError,
)

logger = logging.getLogger(__name__)

_COLLECTION_TYPE = "collection"
_CHUNK_BYTES = 1 << 20
_ID_RE = re.compile(r"(?:main|[0-9a-f]{16})")
_HASH_RE = re.compile(r"[0-9a-f]{64}")
_COLLECTION_FORMATS = (
    BACKUP_FORMAT_NESTED_COLLECTION,
    BACKUP_FORMAT_GLOBAL_CONFIG,
    BACKUP_FORMAT_GLOBAL_ASSETS,
)


def is_nested_collection(archive_path: Path) -> bool:
    """判断上传的包是不是格式 4 的嵌套整包。

    读不出清单或格式号不是 4 时返回 False：交给既有单数据集路径去报"缺少必要内容"
    之类的具体错误，而不是在这里猜。
    """
    try:
        with zipfile.ZipFile(archive_path) as archive:
            manifest = json.loads(archive.read(MANIFEST_MEMBER))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return False
    # 5 = 带全局模型配置、6 = 再带上字体：结构与 4 完全一致，只是多了全局成员。
    # **必须同时看 type**：单数据集包带上全局配置/字体后也是 5/6，只看格式号会把
    # 它误判成整包，然后在"缺少 datasets"上报一句与事实无关的错。
    return (
        isinstance(manifest, dict)
        and manifest.get("format") in _COLLECTION_FORMATS
        and manifest.get("type") == _COLLECTION_TYPE
        and isinstance(manifest.get("datasets"), list)
    )


def _read_collection_manifest(archive: zipfile.ZipFile) -> dict[str, Any]:
    validate_archive(archive)
    try:
        manifest = json.loads(archive.read(MANIFEST_MEMBER))
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise BackupError("整包备份的元信息已损坏，无法读取") from exc
    if (
        not isinstance(manifest, dict)
        or manifest.get("format") not in _COLLECTION_FORMATS
        or manifest.get("type") != _COLLECTION_TYPE
    ):
        raise BackupError("整包备份的元信息不受支持，可能来自其它版本的 ResumeForge")
    entries = manifest.get("datasets")
    if not isinstance(entries, list) or not entries:
        raise BackupError("整包备份里没有声明任何数据集，无法恢复")
    return manifest


def _validate_entry(raw: Any) -> dict[str, Any]:
    """校验清单条目：成员路径只认 ``datasets/<合法 id>.zip``，校验字段必须齐全。

    ``sha256`` 是**后来才补进清单**的字段（见 ``collection_export._build_member``）。
    更早导出的整包没有它：那种包视为"无校验"照常导入，**不能拒收**——用户手上那份
    备份是他唯一的一份数据，因为"我们后来加了个字段"就拒绝恢复是不可接受的。
    但**写在清单里的** ``sha256`` 必须是合法摘要：拼错/截断的摘要与"没有摘要"是两件事，
    前者只能说明包被改坏了。``size_bytes`` 从第一个版本就有，继续要求存在。
    """
    if not isinstance(raw, dict):
        raise BackupError("整包备份的数据集清单格式不合法，已停止导入")
    dataset_id = raw.get("id")
    if (
        not isinstance(dataset_id, str)
        or not _ID_RE.fullmatch(dataset_id)
        or raw.get("file") != f"datasets/{dataset_id}.zip"
        or type(raw.get("size_bytes")) is not int
        or raw["size_bytes"] < 0
    ):
        raise BackupError("整包备份的数据集成员路径或校验字段不合法，已停止导入")
    digest = raw.get("sha256")
    if digest is None or digest == "":
        # 老包：没有摘要 → None 表示"这一份不做内容校验"。
        digest = None
    elif not isinstance(digest, str) or not _HASH_RE.fullmatch(digest):
        raise BackupError("整包备份的数据集校验字段不合法，已停止导入")
    return {**raw, "sha256": digest}


def _extract_member(archive: zipfile.ZipFile, entry: dict[str, Any], destination: Path) -> None:
    """把一份子包写到 destination，并核对大小与 SHA-256（不符即删掉半成品）。

    ``entry["sha256"]`` 为 ``None`` 时（更早版本导出的、清单里还没有摘要字段的整包）
    只核大小、不核内容，并把这件事记一条日志：静默跳过与"验过了"对排障是两回事。
    """
    try:
        info = archive.getinfo(entry["file"])
    except KeyError as exc:
        raise BackupError("包内缺少这份数据集的子包") from exc
    if info.file_size != entry["size_bytes"]:
        raise BackupError(
            f"子包大小与清单不符（清单 {entry['size_bytes']} 字节，实际 {info.file_size} 字节）"
        )
    digest, size = hashlib.sha256(), 0
    try:
        with archive.open(info) as source, destination.open("xb") as target:
            for chunk in iter(lambda: source.read(_CHUNK_BYTES), b""):
                size += len(chunk)
                digest.update(chunk)
                target.write(chunk)
    except (zipfile.BadZipFile, OSError) as exc:
        destination.unlink(missing_ok=True)
        raise BackupError("子包已损坏，无法读取") from exc
    expected = entry["sha256"]
    if size != entry["size_bytes"]:
        destination.unlink(missing_ok=True)
        raise BackupError(
            f"子包解出的字节数与清单不符（清单 {entry['size_bytes']} 字节，实际 {size} 字节）"
        )
    if expected is None:
        logger.info(
            "整包导入：子包 %s 的清单没有 SHA-256（更早版本导出的包），只核大小", entry["id"]
        )
        return
    if digest.hexdigest() != expected:
        destination.unlink(missing_ok=True)
        raise BackupError("子包内容与清单的 SHA-256 不符（文件可能已损坏或被改动）")


def import_collection(
    archive_path: Path,
    name: str,
    bind: Engine,
    staging_dir: Path,
    *,
    allow_partial_assets: bool = False,
) -> dict[str, Any]:
    """逐份恢复嵌套整包里的数据集；单份失败只记录，不牵连其它份。

    返回形状（**列表与计数分开，字段同名但不是同一种类型**）：

    - 顶层 ``restored`` / ``skipped`` / ``failed`` 是**条目列表**：恢复成功项、有意
      跳过项、失败项（``{id, name, error}``，可直接展示）。
    - ``summary`` 里同名的三个键是**计数**（``int``），与对应列表的 ``len()`` 相等。
      调用方要展示明细读列表，要报总数读 ``summary``。
    - 另带旧界面兼容字段：``id``/``name``（主数据集）、``restored_datasets``
      （其余成功项）、``api_key_included``、``backup_asset_warnings``/``asset_issues``
      /``assets_incomplete``。
    """
    # 局部 import：``services.datasets`` 在模块级 import 本模块（分流用），
    # 双向模块级引用会成环。
    from ..datasets import import_dataset

    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise BackupError("备份文件不是有效的压缩包") from exc

    work = staging_dir / f"collection-{secrets.token_hex(8)}"
    work.mkdir(parents=True, exist_ok=True)
    restored: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    try:
        with archive:
            manifest = _read_collection_manifest(archive)
            # 清单本身不合法就整体拒收（此时还没写任何数据）；单个子包坏掉才走隔离。
            entries = [_validate_entry(raw) for raw in manifest["datasets"]]
            if len({item["id"] for item in entries}) != len(entries):
                raise BackupError("整包备份的清单重复声明了同一份数据集，已停止导入")
            names = set(archive.namelist())
            for entry in entries:
                dataset_name = str(entry.get("name") or entry["id"])
                try:
                    sub_zip = work / f"{entry['id']}.zip"
                    if entry["file"] not in names:
                        raise BackupError("包内缺少这份数据集的子包")
                    _extract_member(archive, entry, sub_zip)
                    if is_nested_collection(sub_zip):
                        raise BackupError("不支持嵌套的嵌套（子包本身仍是一份整包）")
                    result = import_dataset(
                        sub_zip,
                        dataset_name,
                        bind,
                        staging_dir,
                        allow_partial_assets=allow_partial_assets,
                    )
                except Exception as exc:  # noqa: BLE001 - 单份失败不牵连同包其它份
                    failed.append({"id": entry["id"], "name": dataset_name, "error": str(exc)})
                    logger.warning("整包导入：数据集 %s 恢复失败：%s", entry["id"], exc)
                    continue
                restored.append(
                    {
                        "source_id": entry["id"],
                        "id": result.get("id"),
                        "name": result.get("name") or dataset_name,
                        "result": result,
                    }
                )
    finally:
        shutil.rmtree(work, ignore_errors=True)

    summary = {"restored": len(restored), "skipped": 0, "failed": len(failed)}
    if not restored:
        detail = "；".join(f"{item['name']}：{item['error']}" for item in failed)
        raise BackupError(
            "整包备份中的数据集全部恢复失败，未写入任何数据："
            + (detail or "包内没有可恢复的数据集")
        )
    # "主数据集"= 导出时正在使用的那一份（清单里的 active_id；老整包没有这个字段时
    # 退回 id == "main"，再退回第一份成功的）。界面只说一个名字，指错人会让人以为
    # 自己当时在用的那份没恢复。
    preferred = manifest.get("active_id")
    main_item = None
    if isinstance(preferred, str):
        main_item = next(
            (item for item in restored if item["source_id"] == preferred),
            None,
        )
    if main_item is None:
        main_item = next((item for item in restored if item["source_id"] == "main"), restored[0])
    # 子包各自如实上报的附件问题合并到这里：整包的成功与否由各子包决定，界面只有
    # 这一个通道能知道"其中某一份恢复得不完整"。
    warnings = [
        warning
        for item in restored
        for warning in (item["result"].get("backup_asset_warnings") or [])
    ]
    issues = [issue for item in restored for issue in (item["result"].get("asset_issues") or [])]
    return {
        # 兼容既有界面的单数据集结果形状：id/name 指向主数据集，其余成功项放
        # restored_datasets（元素只需 id/name），这样"已导入数据集「X」"不会显示 undefined。
        "id": main_item.get("id") or "",
        "name": main_item.get("name") or name.strip() or "整包备份",
        "restored_datasets": [
            {"id": item.get("id") or "", "name": item.get("name") or ""}
            for item in restored
            if item is not main_item
        ],
        "api_key_included": any(
            entry.get("api_key_included") is True for entry in manifest["datasets"]
        ),
        "backup_asset_warnings": warnings,
        "asset_issues": issues,
        "assets_incomplete": bool(warnings or issues),
        "restored": restored,
        # 目前没有任何"有意跳过"的条目：清单里的每一份不是 restored 就是 failed。
        # 保留这个键是为了给调用方一个稳定的返回形状。
        "skipped": [],
        "failed": failed,
        "summary": summary,
    }

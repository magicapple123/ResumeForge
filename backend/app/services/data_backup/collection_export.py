"""嵌套整包导出（R16，格式 4）。

外层 zip **只装每份数据集自己的完整单数据集包**：``datasets/main.zip`` 与
``datasets/<id>.zip``，每份都由 :func:`create_backup_archive` 生成（格式 1 或 3，
语义完全不变）。子包名**始终等于数据集的注册表 id**（``main`` = 主数据库）：激活的
可能是一份导入的数据集，此时主数据只是"其余数据集"之一，按 id 命名才不会撞名。
外层额外带 ``manifest.json``（逐份记 sha256/大小/版本）与 ``README.txt``（固定文案，
不接受用户输入）。

为什么不把各份库平铺进一个包（格式 2 的做法）：单数据集包的校验链（清单、库、附件、
密钥策略）已经完整且被测试钉死，逐份复用它是"一处逻辑一份实现"；外层只做分发与
完整性核对，不重复解释包内字段。
"""

from __future__ import annotations

import json
import secrets
import shutil
import sqlite3
import zipfile
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from sqlalchemy import Engine

from ... import database
from ...config import get_settings
from ...dataset_registry import (
    MAIN_DATASET_ID,
    MAIN_DATASET_NAME,
    read_active_dataset_id,
    read_metadata,
)
from .asset_manifest import file_digest
from .export import create_backup_archive
from .paths import (
    ARCHIVE_DATASETS_DIRNAME,
    BACKUP_FORMAT_NESTED_COLLECTION,
    MANIFEST_MEMBER,
    README_MEMBER,
    BackupError,
    ExtraDatabase,
)

COLLECTION_TYPE = "collection"


def create_collection_archive(
    bind: Engine,
    staging_dir: Path,
    *,
    extras: Sequence[ExtraDatabase] = (),
    include_api_keys: bool = False,
) -> Path:
    """生成格式 4 的嵌套整包并返回路径；调用方负责在响应结束后删除。

    活动数据集与 ``extras`` 里的每一份各生成一份**完整单数据集包**；外层只负责
    装包与逐份记录 sha256（导入侧据此隔离"坏的那一份"，不牵连同包里的其它份）。
    """
    staging_dir.mkdir(parents=True, exist_ok=True)
    work = staging_dir / f"collection-{secrets.token_hex(8)}"
    work.mkdir(parents=True, exist_ok=True)
    archive_path = (
        staging_dir
        / f"resumeforge-collection-{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(8)}.zip"
    )
    built: list[tuple[dict, Path]] = []
    try:
        active_id = read_active_dataset_id()
        active_name = (
            MAIN_DATASET_NAME
            if active_id == MAIN_DATASET_ID
            else str(read_metadata(active_id).get("name") or active_id)
        )
        built.append(_build_member(bind, active_id, active_name, work, include_api_keys))
        for item in extras:
            if not item.source.exists():
                raise BackupError(
                    f"数据集「{item.name}」的文件已不存在，无法一并导出；"
                    "请先在列表里把它移除或改名后重试",
                    status_code=404,
                )
            # 非活动数据集：临时引擎取一致快照，用完立即释放（Windows 文件句柄）。
            temporary = database.build_engine(database.database_url_for(item.source))
            try:
                built.append(
                    _build_member(temporary, item.dataset_id, item.name, work, include_api_keys)
                )
            finally:
                temporary.dispose()
        manifest = _collection_manifest(built, active_id)
        with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False, indent=2))
            archive.writestr(README_MEMBER, _readme(manifest))
            for entry, sub_archive in built:
                archive.write(sub_archive, entry["file"])
    except BackupError:
        archive_path.unlink(missing_ok=True)
        raise
    except (OSError, sqlite3.Error, ValueError, zipfile.BadZipFile) as exc:
        archive_path.unlink(missing_ok=True)
        raise BackupError(f"生成整包备份失败：{exc}", status_code=500) from exc
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return archive_path


def _build_member(
    bind: Engine, dataset_id: str, name: str, work: Path, include_api_keys: bool
) -> tuple[dict, Path]:
    """生成一份子包，返回（外层清单条目, 子包路径）。"""
    sub_dir = work / f"sub-{dataset_id}"
    sub_dir.mkdir(parents=True, exist_ok=True)
    sub_archive = create_backup_archive(bind, sub_dir, include_api_keys=include_api_keys)
    size, digest = file_digest(sub_archive)
    sub_manifest = _read_sub_manifest(sub_archive)
    entry: dict = {
        "id": dataset_id,
        "name": name,
        "file": f"{ARCHIVE_DATASETS_DIRNAME}/{dataset_id}.zip",
        "sha256": digest,
        "size_bytes": size,
        "app_version": sub_manifest.get("app_version"),
        "alembic_revision": sub_manifest.get("alembic_revision"),
        "api_key_included": sub_manifest.get("api_key_included") is True,
    }
    # 子包里的附件告警随外层清单一起走：导出接口只能从外层清单读告警（响应头），
    # 少了这一段，一份"导出时就缺附件"的整包会被界面说成完整备份。
    if isinstance(sub_manifest.get("asset_manifest"), dict):
        entry["asset_manifest"] = sub_manifest["asset_manifest"]
    return entry, sub_archive


def _read_sub_manifest(sub_archive: Path) -> dict:
    try:
        with zipfile.ZipFile(sub_archive) as archive:
            manifest = json.loads(archive.read(MANIFEST_MEMBER))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
        raise BackupError("整包备份的子包清单不可读，已停止导出", status_code=500) from exc
    if not isinstance(manifest, dict):
        raise BackupError("整包备份的子包清单不可读，已停止导出", status_code=500)
    return manifest


def _collection_manifest(built: Sequence[tuple[dict, Path]], active_id: str) -> dict:
    settings = get_settings()
    return {
        "format": BACKUP_FORMAT_NESTED_COLLECTION,
        "type": COLLECTION_TYPE,
        "app": settings.app_name,
        "app_version": settings.app_version,
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        # 导出时正在使用的那一份：激活的可能不是主数据，界面说"已导入数据集「X」"时
        # 要指用户当时在用的那份（导入侧优先按它挑"主数据集"）。
        "active_id": active_id,
        "datasets": [entry for entry, _ in built],
    }


def _format_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{max(size, 0) / 1024:.1f} KB"


def _readme(manifest: dict) -> str:
    """服务端固定生成的说明文件（不含任何用户输入）。"""
    entries = manifest.get("datasets") or []
    lines = [
        "ResumeForge 数据备份（整包）",
        "=" * 40,
        "",
        f"导出时间：{manifest.get('exported_at')}",
        f"应用版本：{manifest.get('app')} {manifest.get('app_version')}",
        f"包含数据集：{len(entries)} 份",
        "",
        "一、包含的数据集",
    ]
    for entry in entries:
        lines.append(
            f"  - {entry.get('name')}（{entry.get('file')}，{_format_size(entry.get('size_bytes') or 0)}）"
        )
    lines += [
        "",
        "二、如何导入",
        "  1. 打开 ResumeForge，进入「设置 → 数据管理」；",
        "  2. 点「导入备份」并选择本压缩包（整个 zip，不要解压）；",
        "  3. 导入会把每一份数据集恢复成**新的数据集**，不会覆盖你现有的数据；",
        "  4. 恢复后可在数据集列表里切换到其中任意一份。",
        "",
        f"  需要 ResumeForge {manifest.get('app_version')} 或更新版本；"
        "更早的版本无法读取这种整包结构。",
        "",
        "三、关于 API Key",
    ]
    if any(entry.get("api_key_included") for entry in entries):
        lines += [
            "  本包**包含 API Key**（导出时勾选了「包含密钥」）：",
            "  - Windows：密钥是绑定原电脑与原用户的加密密文，换电脑后无法解密，",
            "    导入后按「未配置」处理，请重新填写；",
            "  - macOS/Linux：密钥以明文随包，请妥善保管，或在迁移完成后立即删除本文件。",
        ]
    else:
        lines += [
            "  本包**不包含 API Key**：导入后需要在「设置 → 模型」里重新填写密钥。",
        ]
    lines += [
        "",
        "四、提示",
        "  - 压缩包里每份数据集都是独立的完整备份，可以单独取出导入；",
        "  - 若某一份在传输中损坏，导入时会跳过它并明确列出，其余数据集仍会恢复；",
        "  - 本文件由应用自动生成，不需要手动编辑。",
        "",
    ]
    return "\n".join(lines)

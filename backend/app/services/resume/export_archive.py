# SPDX-License-Identifier: Apache-2.0
"""W19 交付原件归档：export_archive/ 资产目录 + resume_export_artifact 行。

- 字节落数据集资产目录 export_archive/（ASSET_CATEGORIES 已登记，进备份）；
- disk_name = sha256 前缀 + 白名单扩展名，**只由服务端侧的值构成**（用户文件名仅存
  DB 展示列，不进路径）；
- 显式删除（先删文件再删行），永不自动清理；每个简历上限 20 份，超限拒绝新增；
- 隐私：不写正文日志、导出响应头不带路径；删除前校验路径在 export_archive/ 内。
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.resume_export import (
    EXPORT_ARTIFACT_BUNDLE,
    EXPORT_ARTIFACT_RENDERED,
    MAX_ARTIFACTS_PER_RESUME,
    ResumeExportArtifact,
)
from ..data_backup.asset_categories import ASSET_CATEGORIES
from .document_provenance import canonical_fingerprint
from .resume_delivery import canonical_content_sha256

logger = logging.getLogger(__name__)
ARCHIVE_DIRNAME = "export_archive"


def _assert_category_registered() -> None:
    if ARCHIVE_DIRNAME not in ASSET_CATEGORIES:  # pragma: no cover - 结构守卫
        raise RuntimeError("export_archive 未登记为备份资产类别")


def archive_root(bind: Any) -> Path:
    from ..data_backup.paths import database_path

    return Path(database_path(bind)).parent / ARCHIVE_DIRNAME


def _safe_disk_name(content: bytes, export_format: str) -> str:
    """磁盘名只由**服务端侧**的值构成：内容 sha256 前缀 + 白名单扩展名。

    用户文件名（可能含任意字符）只存 DB 的 ``filename`` 列做展示，不进任何路径——
    路径构造点与用户输入没有拼接关系，path-injection 没有可追踪的污点流；扩展名
    对 ``export_format`` 走 ``[a-z0-9]{1,8}`` 白名单，其余一律 ``bin``。内容寻址
    （同一份字节 + 同一格式 → 同一个盘上文件）由 sha256 保证，去重语义不变。
    """
    digest = hashlib.sha256(content).hexdigest()[:16]
    normalized = export_format.strip().lower()
    ext = normalized if re.fullmatch(r"[a-z0-9]{1,8}", normalized) else "bin"
    return f"{digest}.{ext}"


def _archive_target(root: Path, disk_name: str) -> Path:
    """把服务端生成的磁盘名收敛到归档根目录内，返回可安全落盘的绝对路径。

    路径注入的防线不能只靠"``root in target.parents``"：CodeQL 的 path-injection 查询
    只认两类收敛点——``os.path.abspath`` 这类**归一化**，与 ``str.startswith`` 这类按
    根目录前缀的**安全检查**（同一写法见 ``data_backup/asset_safety.safe_asset_path``）。
    这里先归一化消掉 ``..``，再要求结果以「根目录 + 分隔符」开头（顺带挡掉
    「base-sibling」这种同前缀目录），不通过就拒绝。``disk_name`` 上游仍由 sha256 +
    白名单扩展名生成，这里是第二道防线而不是唯一一道。
    """
    base = os.path.abspath(root)
    target = os.path.abspath(os.path.join(base, disk_name))
    if not target.startswith(os.path.join(base, "")):
        raise ValueError("归档路径不安全")
    return Path(target)


def list_artifacts(db: Session, resume_id: int) -> list[ResumeExportArtifact]:
    return list(
        db.execute(
            select(ResumeExportArtifact)
            .where(ResumeExportArtifact.resume_id == resume_id)
            .order_by(ResumeExportArtifact.id.desc())
        )
        .scalars()
        .all()
    )


def save_artifact(
    db: Session,
    *,
    record: ResumeRecord,
    content: bytes,
    filename: str,
    export_format: str,
    media_type: str = "",
    kind: str = EXPORT_ARTIFACT_RENDERED,
    delivery_id: int | None = None,
    resource_manifest: dict[str, Any] | None = None,
    max_artifacts: int = MAX_ARTIFACTS_PER_RESUME,
) -> ResumeExportArtifact:
    """把一次导出的字节归档；超限时拒绝新增（提示用户删旧，不自动清理）。"""
    _assert_category_registered()
    total = db.execute(
        select(ResumeExportArtifact.id).where(ResumeExportArtifact.resume_id == record.id)
    ).all()
    if len(total) >= max(1, min(int(max_artifacts), MAX_ARTIFACTS_PER_RESUME)):
        raise ValueError("归档数量已达上限，请先删除旧原件再归档")
    root = archive_root(db.get_bind())
    root.mkdir(parents=True, exist_ok=True)
    disk_name = _safe_disk_name(content, export_format)
    target = _archive_target(root, disk_name)
    temporary = target.with_suffix(target.suffix + ".partial")
    temporary.write_bytes(content)
    temporary.replace(target)
    artifact = ResumeExportArtifact(
        delivery_id=delivery_id,
        resume_id=record.id,
        kind=kind if kind == EXPORT_ARTIFACT_BUNDLE else EXPORT_ARTIFACT_RENDERED,
        export_format=export_format,
        filename=filename[:256],
        media_type=media_type[:128],
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        disk_name=disk_name,
        resource_manifest=resource_manifest or {},
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    logger.info("交付原件已归档 resume=%s format=%s", record.id, export_format)
    return artifact


def delete_artifact(db: Session, resume_id: int, artifact_id: int) -> bool:
    """删除一条归档：先删行，**最后一条引用该文件时才删盘**。

    磁盘名是「sha256 前缀 + 文件名」（内容寻址）：同一份字节的两次导出会指向同一个
    文件。若删一条行就 unlink，另一条仍存在的归档会变成"有行无文件"的悬空记录——
    用户看到的列表还在，点开却 404。所以只有盘上文件不再被任何行引用时才真正删除。
    """
    artifact = db.get(ResumeExportArtifact, artifact_id)
    if artifact is None or artifact.resume_id != resume_id:
        return False
    root = archive_root(db.get_bind())
    target = _archive_target(root, artifact.disk_name)
    disk_name = artifact.disk_name
    db.delete(artifact)
    db.flush()
    still_referenced = db.execute(
        select(ResumeExportArtifact.id).where(ResumeExportArtifact.disk_name == disk_name)
    ).first()
    if still_referenced is None:
        target.unlink(missing_ok=True)
    db.commit()
    return True


def artifact_brief(artifact: ResumeExportArtifact) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "resume_id": artifact.resume_id,
        "delivery_id": artifact.delivery_id,
        "kind": artifact.kind,
        "export_format": artifact.export_format,
        "filename": artifact.filename,
        "media_type": artifact.media_type,
        "size_bytes": artifact.size_bytes,
        "sha256": artifact.sha256,
        "created_at": artifact.created_at,
    }


__all__ = [
    "ARCHIVE_DIRNAME",
    "artifact_brief",
    "archive_root",
    "canonical_content_sha256",
    "canonical_fingerprint",
    "delete_artifact",
    "list_artifacts",
    "save_artifact",
]

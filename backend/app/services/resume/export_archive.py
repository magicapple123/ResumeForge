# SPDX-License-Identifier: Apache-2.0
"""W19 交付原件归档：export_archive/ 资产目录 + resume_export_artifact 行。

- 字节落数据集资产目录 export_archive/（ASSET_CATEGORIES 已登记，进备份）；
- disk_name = sha256 前缀 + 安全化文件名，**不使用**用户命名模板直接做磁盘名；
- 显式删除（先删文件再删行），永不自动清理；每个简历上限 20 份，超限拒绝新增；
- 隐私：不写正文日志、导出响应头不带路径；删除前校验路径在 export_archive/ 内。
"""

from __future__ import annotations

import hashlib
import logging
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
from ..data_backup.asset_safety import safe_asset_name
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


def _safe_disk_name(content: bytes, filename: str) -> str:
    digest = hashlib.sha256(content).hexdigest()
    safe = safe_asset_name(filename, ARCHIVE_DIRNAME)
    while ".." in safe:
        safe = safe.replace("..", ".")
    safe = safe.strip(". ") or "artifact"
    return f"{digest[:16]}-{safe}"[:128]


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
    disk_name = _safe_disk_name(content, filename)
    target = (root / disk_name).resolve()
    if root.resolve() not in target.parents:
        raise ValueError("归档路径不安全")
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
    root = archive_root(db.get_bind()).resolve()
    target = (root / artifact.disk_name).resolve()
    if root not in target.parents:
        raise ValueError("归档路径不安全")
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

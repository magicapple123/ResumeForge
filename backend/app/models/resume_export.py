# SPDX-License-Identifier: Apache-2.0
"""W19 导出配置与交付原件归档（迁移 0059）。

- resume_export_preset：命名导出配置（格式组合/命名模板/后处理选项），**不含内容与版式**；
  数据集级（每份数据集独立库），随数据集备份。
- resume_export_artifact：一次导出的**原件字节**（可选归档）。DB 只存 disk_name 引用，
  字节落 export_archive/（数据集资产目录，进备份）；与 resume_delivery_record 的分工：
  后者存"可重放的数据"，前者存"当时那个文件"。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 归档类型：rendered = 本次重排产物；bundle_member = 成套导出的成员（同一语义，保留区分）。
EXPORT_ARTIFACT_RENDERED = "rendered"
EXPORT_ARTIFACT_BUNDLE = "bundle_member"
EXPORT_ARTIFACT_KINDS = (EXPORT_ARTIFACT_RENDERED, EXPORT_ARTIFACT_BUNDLE)
# 每个预设/简历的归档上限：超限拒绝新增并提示用户删旧，不自动清理。
MAX_ARTIFACTS_PER_RESUME = 20


class ResumeExportPreset(Base):
    """命名导出配置（D18）。"""

    __tablename__ = "resume_export_preset"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255), default="", server_default="")
    # {"formats": [...], "naming": "{name}-{job_title}-{date}", "watermark": "",
    #  "redact": false, "redact_options": {...}, "include_photo": true,
    #  "archive_original": false, "max_artifacts_per_resume": 20}
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    is_default: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ResumeExportArtifact(Base):
    """一次导出的原件字节（D19）：可选归档、可显式删除、不自动清理。"""

    __tablename__ = "resume_export_artifact"

    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_delivery_record.id", ondelete="SET NULL"), nullable=True, index=True
    )
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(
        String(16), default=EXPORT_ARTIFACT_RENDERED, server_default=EXPORT_ARTIFACT_RENDERED
    )
    export_format: Mapped[str] = mapped_column(String(16), default="", server_default="")
    filename: Mapped[str] = mapped_column(String(256), default="", server_default="")
    media_type: Mapped[str] = mapped_column(String(128), default="", server_default="")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sha256: Mapped[str] = mapped_column(String(64), default="", server_default="")
    # 数据集资产目录 export_archive/ 里的文件名（唯一引用点，备份清单收集它）。
    disk_name: Mapped[str] = mapped_column(String(128), default="", server_default="", index=True)
    resource_manifest: Mapped[dict[str, Any]] = mapped_column(
        JSON, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


__all__ = [
    "EXPORT_ARTIFACT_BUNDLE",
    "EXPORT_ARTIFACT_KINDS",
    "EXPORT_ARTIFACT_RENDERED",
    "MAX_ARTIFACTS_PER_RESUME",
    "ResumeExportArtifact",
    "ResumeExportPreset",
]

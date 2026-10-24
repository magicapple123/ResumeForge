# SPDX-License-Identifier: Apache-2.0
"""W19 导出配置 / 成套导出 / 原件归档的接口形状。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .export import ExportFormat
from .resume import MAX_RESUME_PAGES, ResumeContent, ResumeFontScale, ResumeLanguage

ALL_FORMATS: tuple[str, ...] = ("json", "md", "html", "pdf", "docx", "txt")
MAX_PRESET_NAME = 64
MAX_PRESET_DESCRIPTION = 255
MAX_BUNDLE_FORMATS = 6


class ExportPresetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_PRESET_NAME)
    description: str = Field(default="", max_length=MAX_PRESET_DESCRIPTION)
    # {"formats": [...], "naming": "{name}-{job_title}-{date}", "watermark": "",
    #  "redact": false, "include_photo": true, "archive_original": false}
    config: dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False


class ExportPresetOut(BaseModel):
    id: int
    name: str
    description: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    is_default: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ExportPresetListOut(BaseModel):
    items: list[ExportPresetOut] = Field(default_factory=list)


class ExportBundleRequest(BaseModel):
    """成套导出请求：未给的项回退到预设/记录值；内容覆盖仅供当前草稿快照。"""

    model_config = ConfigDict(extra="forbid")

    preset_id: int | None = Field(default=None, ge=1)
    formats: list[ExportFormat] | None = Field(
        default=None, min_length=1, max_length=MAX_BUNDLE_FORMATS
    )
    watermark: str | None = Field(default=None, max_length=200)
    redact: bool | None = None
    include_photo: bool | None = None
    archive_original: bool | None = None
    resume_revision: int | None = Field(default=None, ge=0)
    strict_revision: bool = False
    # 当前草稿（W04 缺口）：与预览同一份内容；给定则不读库内正文，不落库不冻结正文。
    content: ResumeContent | None = None
    margin_mm: float | None = Field(default=None, ge=4, le=40)
    font_scale: ResumeFontScale | None = None
    page_limit: int | None = Field(default=None, ge=1, le=MAX_RESUME_PAGES)
    format_config: dict[str, Any] | None = None
    language: ResumeLanguage | None = None
    allow_incomplete: bool = False


class ExportArtifactOut(BaseModel):
    id: int
    resume_id: int | None = None
    delivery_id: int | None = None
    kind: str = "rendered"
    export_format: str = ""
    filename: str = ""
    media_type: str = ""
    size_bytes: int = 0
    sha256: str = ""
    created_at: datetime | None = None


class ExportArtifactListOut(BaseModel):
    items: list[ExportArtifactOut] = Field(default_factory=list)


BundleFailure = dict[str, str]

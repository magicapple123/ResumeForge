# SPDX-License-Identifier: Apache-2.0
"""W18 离线对象批注的接口形状。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AnnotationOut(BaseModel):
    id: int
    share_package_id: int | None = None
    resume_id: int | None = None
    document_version_id: int | None = None
    snapshot_sha256: str = ""
    external_id: str
    object_id: str | None = None
    point_id: str | None = None
    path: str | None = None
    field: str | None = None
    quoted_text: str = ""
    text: str
    reviewer: str = ""
    status: str = "open"
    resolved_at: datetime | None = None
    created_at: datetime | None = None


class AnnotationListOut(BaseModel):
    items: list[AnnotationOut] = Field(default_factory=list)


class ImportAnnotationsRequest(BaseModel):
    """收件人回传的 annotations.json 原文（字符串，服务端自己 parse 以给出可执行提示）。"""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=600_000)


class ImportAnnotationsOut(BaseModel):
    imported: int = 0
    duplicates: int = 0
    stale: int = 0
    dismissed_existing: int = 0
    annotations: list[AnnotationOut] = Field(default_factory=list)


class ReattachRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_id: str = Field(min_length=8, max_length=32)
    point_id: str | None = Field(default=None, max_length=32)

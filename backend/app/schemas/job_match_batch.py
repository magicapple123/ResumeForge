"""岗位批量匹配接口的数据结构。"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .job_match import JobMatchResult, MatchReferenceScore

BatchItemStatus = Literal["completed", "failed"]
BatchAnalysisSource = Literal["new", "existing", "local"]


class JobMatchBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_ids: list[int] = Field(min_length=1, max_length=50)
    force: bool = False


class JobMatchBatchItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: int
    job_title: str = ""
    company: str = ""
    status: BatchItemStatus
    rank: int | None = None
    reference_score: MatchReferenceScore | None = None
    result: JobMatchResult | None = None
    model: str = ""
    analysis_source: BatchAnalysisSource | None = None
    error: str = ""


class JobMatchBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    requested_count: int
    completed_count: int
    failed_count: int
    items: list[JobMatchBatchItem] = Field(default_factory=list)
    model: str = ""
    created_at: datetime
    updated_at: datetime


class JobMatchBatchSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    requested_count: int
    completed_count: int
    failed_count: int
    top_score: int | None = None
    model: str = ""
    created_at: datetime


__all__ = [
    "BatchAnalysisSource",
    "BatchItemStatus",
    "JobMatchBatchItem",
    "JobMatchBatchOut",
    "JobMatchBatchRequest",
    "JobMatchBatchSummary",
]

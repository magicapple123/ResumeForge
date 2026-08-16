"""岗位 Schema。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SkillTag(BaseModel):
    name: str
    category: str


class JobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    company: str = ""
    location: str = ""
    salary: str = ""
    job_type: str = "校招"
    description: str = ""
    requirements: str = ""
    source: str = "手动添加"
    source_url: str = ""
    posted_at: str = ""
    status: str = "开放中"


class JobUpdate(BaseModel):
    """PUT 语义：只更新提交了的字段。"""

    title: str | None = None
    company: str | None = None
    location: str | None = None
    salary: str | None = None
    job_type: str | None = None
    description: str | None = None
    requirements: str | None = None
    source_url: str | None = None
    posted_at: str | None = None
    status: str | None = None


class JobOut(JobCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    keywords: list[SkillTag] = []
    created_at: datetime
    updated_at: datetime


class ScrapeRequest(BaseModel):
    source: str = Field(min_length=1, description="抓取源唯一标识，见 /api/jobs/meta/sources")
    keyword: str | None = None
    limit: int = Field(default=20, ge=1, le=100)


class ScrapeResult(BaseModel):
    created: int  # 新增条数
    skipped: int  # 已存在而跳过的条数
    jobs: list[JobOut] = []


class SourceInfo(BaseModel):
    name: str
    display_name: str
    description: str

"""岗位 Schema。"""
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models.job import JOB_STATUSES


MAX_SQLITE_INTEGER = 2**63 - 1
JobId = Annotated[int, Field(strict=True, ge=1, le=MAX_SQLITE_INTEGER)]


def _validate_status(value: str) -> str:
    if value not in JOB_STATUSES:
        allowed = "、".join(JOB_STATUSES)
        raise ValueError(f"无效的岗位状态，可选值：{allowed}")
    return value


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
    source_url: str = ""
    posted_at: str = ""
    status: str = "开放中"
    note: str = Field(default="", max_length=2000)
    favorite: bool = False

    @field_validator("status")
    @classmethod
    def status_must_be_supported(cls, value: str) -> str:
        return _validate_status(value)


class JobUpdate(BaseModel):
    """PUT 语义：只更新提交了的字段。"""

    title: str = ""
    company: str = ""
    location: str = ""
    salary: str = ""
    job_type: str = ""
    description: str = ""
    requirements: str = ""
    source_url: str = ""
    posted_at: str = ""
    status: str = "开放中"
    note: str = Field(default="", max_length=2000)
    favorite: bool = False

    @field_validator("status")
    @classmethod
    def status_must_be_supported_when_set(cls, value: str) -> str:
        return _validate_status(value)


class JobBatchRequest(BaseModel):
    job_ids: list[JobId]

    @field_validator("job_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("请至少选择一个岗位")
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) > 500:
            raise ValueError("一次最多操作 500 个岗位")
        return unique_ids


class JobBatchStatusRequest(JobBatchRequest):
    status: str = Field(min_length=1, max_length=16)


class JobBatchStatusResult(BaseModel):
    updated: int


class JobBatchDeleteResult(BaseModel):
    deleted: int


class JobTextParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)

    @field_validator("text")
    @classmethod
    def text_must_contain_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("招聘信息不能为空")
        return value


class JobTextParseResult(BaseModel):
    """从粘贴文本生成的可编辑草稿，不要求岗位名称已成功识别。"""

    title: str = Field(default="", max_length=128)
    company: str = Field(default="", max_length=128)
    location: str = Field(default="", max_length=64)
    salary: str = Field(default="", max_length=64)
    job_type: str = Field(default="其他", max_length=32)
    description: str = ""
    requirements: str = ""
    source_url: str = Field(default="", max_length=512)
    posted_at: str = Field(default="", max_length=32)
    status: str = Field(default="开放中", max_length=16)
    warnings: list[str] = Field(default_factory=list)


class JobOut(JobCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source: str = "手动添加"
    keywords: list[SkillTag] = []
    created_at: datetime
    updated_at: datetime

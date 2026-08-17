"""岗位 Schema。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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

"""面经知识库（R-15）的请求/响应结构。

与模拟面试（``schemas/interview.py``）分开：模拟面试是对话式练习，这里沉淀的是**真实面经**
——正文 + 被问到的真实问题清单 + 标签。来源三类（自己/同行/公开），只做分类不做断言。

写入侧做严格校验（来源白名单、日期格式、至少有一项内容）；读取侧只如实回显。
"""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..models.interview_experience import (
    EXPERIENCE_SOURCE_SELF,
    EXPERIENCE_SOURCES,
)

MAX_EXPERIENCE_CONTENT_CHARS = 100_000
MAX_EXPERIENCE_QUESTIONS = 200
MAX_EXPERIENCE_TAGS = 50

ExperienceSource = Literal["self", "peer", "public"]

# YYYY-MM-DD，未知为空串。与资料库/台账的日期字段保持一致的字符串表示。
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_source(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned not in EXPERIENCE_SOURCES:
        raise ValueError(f"无效的面经来源，可选值：{'、'.join(EXPERIENCE_SOURCES)}")
    return cleaned


def _validate_interview_date(value: str) -> str:
    cleaned = (value or "").strip()
    if cleaned and not _DATE_RE.fullmatch(cleaned):
        raise ValueError("面试日期必须是 YYYY-MM-DD 格式，留空表示未知")
    return cleaned


class InterviewExperienceCreate(BaseModel):
    """新增一条面经。

    ``company``/``position`` 是快照：即便之后绑定的岗位被删除，面经仍可读、仍可按公司检索。
    ``job_id`` 只是可选关联，删除后置空（外键 SET NULL）。
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=128)
    position: str = Field(default="", max_length=128)
    job_id: int | None = Field(default=None, ge=1)
    content: str = Field(default="", max_length=MAX_EXPERIENCE_CONTENT_CHARS)
    # 被问到的真实问题清单（R-11 录入）。与题库"即时生成、不落库"互补。
    questions: list[str] = Field(default_factory=list, max_length=MAX_EXPERIENCE_QUESTIONS)
    tags: list[str] = Field(default_factory=list, max_length=MAX_EXPERIENCE_TAGS)
    source: ExperienceSource = EXPERIENCE_SOURCE_SELF
    difficulty: str = Field(default="", max_length=16)
    round_type: str = Field(default="", max_length=32)
    interview_date: str = Field(default="", max_length=10)

    @field_validator("source")
    @classmethod
    def source_must_be_supported(cls, value: str) -> str:
        return _validate_source(value)

    @field_validator("interview_date")
    @classmethod
    def interview_date_must_be_valid(cls, value: str) -> str:
        return _validate_interview_date(value)

    @field_validator("questions", "tags")
    @classmethod
    def strings_must_be_clean(cls, value: list[str]) -> list[str]:
        return [str(item).strip() for item in value if str(item).strip()][:MAX_EXPERIENCE_QUESTIONS]

    @model_validator(mode="after")
    def require_something(self) -> "InterviewExperienceCreate":
        self.title = self.title.strip()
        self.company = self.company.strip()
        self.position = self.position.strip()
        if not self.title and not self.company and not self.content.strip() and not self.questions:
            raise ValueError("请至少填写标题、公司、正文或真实问题清单")
        return self


class InterviewExperienceUpdate(InterviewExperienceCreate):
    """PUT 语义：整体替换一条面经。"""


class InterviewExperienceOut(InterviewExperienceCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


# 列表行的正文截断长度（与知识库列表摘要同量级）。
MAX_EXPERIENCE_EXCERPT_CHARS = 200


class InterviewExperienceSummary(BaseModel):
    """列表视图（``GET /api/interview-experiences/page``）。

    **``content`` 全文与 ``questions`` 清单刻意不进列表行**：正文单条上限 10 万字符、
    问题清单最多 200 条——面经上百之后带着它们翻页，每次都是 MB 级响应，而列表卡片
    只需要标题/公司/来源/标签和一小段预览。全文与完整问题清单走 ``GET /{id}``。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str = ""
    company: str = ""
    position: str = ""
    job_id: int | None = None
    source: ExperienceSource = EXPERIENCE_SOURCE_SELF
    difficulty: str = ""
    round_type: str = ""
    interview_date: str = ""
    tags: list[str] = Field(default_factory=list)
    question_count: int = 0
    content_excerpt: str = ""
    created_at: datetime
    updated_at: datetime


class InterviewExperienceBatchRequest(BaseModel):
    """批量删除请求：与 ``schemas.resume.ResumeBatchRequest`` 同款口径（去重 + 上限 500）。"""

    experience_ids: list[int] = Field(max_length=500)

    @field_validator("experience_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("请至少选择一条面经")
        return list(dict.fromkeys(value))


class InterviewExperienceBatchDeleteResult(BaseModel):
    deleted: int


__all__ = [
    "ExperienceSource",
    "InterviewExperienceBatchDeleteResult",
    "InterviewExperienceBatchRequest",
    "InterviewExperienceCreate",
    "InterviewExperienceOut",
    "InterviewExperienceSummary",
    "InterviewExperienceUpdate",
    "MAX_EXPERIENCE_CONTENT_CHARS",
    "MAX_EXPERIENCE_EXCERPT_CHARS",
    "MAX_EXPERIENCE_QUESTIONS",
    "MAX_EXPERIENCE_TAGS",
]

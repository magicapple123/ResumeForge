# SPDX-License-Identifier: Apache-2.0
"""简历正文的六类旧条目模型与正文常量（A4 从 resume.py 拆出）。

拆出的唯一原因：A4 要给项目/经历补可选字段（public_url / artifact_type /
experience_kind）时，schemas/resume.py 已到 500 行硬预算。拆的是**模型定义**，
行为一条都没变：

- 六类条目仍混入 W06 的 OptionalVisibilityMixin（id/point_ids/hidden/hidden_points/
  lock_content/lock_layout；None 不序列化）；
- 新加的三个可选字符串字段用 OptionalVisibilityMixin 的
  _optional_empty_string_fields 声明：**空串与 None 都不出现在 model_dump() 里**。
  旧记录没有这些键，因此内容指纹（交付快照的 source_content_sha256）逐字节不变。

schemas/resume.py 仍 re-export 本模块的名字，既有导入路径不变。
"""

from __future__ import annotations

from typing import Annotated, ClassVar

from pydantic import BaseModel, Field, field_validator

from .resume_research import MAX_URL_CHARS, _validate_http_url
from .resume_visibility import OptionalVisibilityMixin

MAX_RESUME_SECTION_ITEMS = 200
MAX_RESUME_LIST_ITEMS = 500
MAX_RESUME_TEXT_CHARS = 50_000
ResumeLine = Annotated[str, Field(max_length=20_000)]

# 实践/服务经历的关系类型白名单（计划 §8.1：只有明确选择关系类型才记录，不靠场景猜测）。
# schema 侧用宽松 str（模型输出非白名单值时不整条丢弃），解析层把白名单外的值清空。
EXPERIENCE_KINDS: tuple[str, ...] = (
    "full_time",
    "part_time",
    "contract",
    "self_employed",
    "internship",
    "volunteer",
    "other",
)


class ResumeEducation(OptionalVisibilityMixin, BaseModel):
    school: str = Field(default="", max_length=128)
    major: str = Field(default="", max_length=128)
    degree: str = Field(default="", max_length=32)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    gpa: str = Field(default="", max_length=64)
    courses: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    achievements: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    # W01 稳定身份（可选）：旧记录没有就是没有——GET 不生成、不改写库；只有保存时
    # 客户端带上来的值才原样落库。校验在 document_identity.validate_document_ids。
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None


class ResumeExperience(OptionalVisibilityMixin, BaseModel):
    company: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    # A4 实践/服务经历：关系类型（全职/兼职/合同/自雇/实习/志愿/其他）。空串不序列化，
    # 旧记录没有这个键，内容指纹不变。取值见 EXPERIENCE_KINDS（白名单在解析层收口）。
    experience_kind: str = Field(default="", max_length=32)
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = ("experience_kind",)


class ResumeCampusExperience(OptionalVisibilityMixin, BaseModel):
    organization: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None


class ResumeProject(OptionalVisibilityMixin, BaseModel):
    name: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    tech_stack: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    highlights: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    # A4 作品项目：一个公开链接 + 成果类型（计划 §8.1）。空串不序列化（旧指纹不变）。
    # 链接只接受 http(s)：模板会把它渲染成可点击 <a>；其它协议在 schema 层直接拒绝。
    public_url: str = Field(default="", max_length=MAX_URL_CHARS)
    artifact_type: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = ("public_url", "artifact_type")

    _validate_public_url = field_validator("public_url")(_validate_http_url)


class ResumeSkill(OptionalVisibilityMixin, BaseModel):
    name: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)


class ResumeAward(OptionalVisibilityMixin, BaseModel):
    name: str = Field(default="", max_length=256)
    date: str = Field(default="", max_length=32)
    description: str = Field(default="", max_length=20_000)
    id: str | None = Field(default=None, max_length=32)


__all__ = [
    "EXPERIENCE_KINDS",
    "MAX_RESUME_LIST_ITEMS",
    "MAX_RESUME_SECTION_ITEMS",
    "MAX_RESUME_TEXT_CHARS",
    "ResumeAward",
    "ResumeCampusExperience",
    "ResumeEducation",
    "ResumeExperience",
    "ResumeLine",
    "ResumeProject",
    "ResumeSkill",
]

# SPDX-License-Identifier: Apache-2.0
"""简历正文的六类旧条目模型与正文常量（A4 从 resume.py 拆出）。

拆出的唯一原因：A4 要给项目/经历补可选字段（public_url / artifact_type /
experience_kind）时，schemas/resume.py 已到 500 行硬预算。拆的是**模型定义**，
行为一条都没变：

- 六类条目仍混入 W06 的 OptionalVisibilityMixin（id/point_ids/hidden/hidden_points/
  lock_content/lock_layout；None 不序列化）；
- 新加的可选字符串字段用 OptionalVisibilityMixin 的
  _optional_empty_string_fields 声明：**空串与 None 都不出现在 model_dump() 里**。
  旧记录没有这些键，因此内容指纹（交付快照的 source_content_sha256）逐字节不变。

F8（R-81）把资料页"无独立表单项"的小字段提升为条目的可选字段（只增不改）：
学习形式/学位类型/院系/成绩排名/导师/研究方向、团队规模、项目规模、技能分类、
活动类型、颁发机构/奖项级别/获奖比例；experience_kind 与 artifact_type 复用 A4
已有属性。上限口径：语义短值（排名/比例/规模/级别等）64，机构/院系/导师/类型 128，
研究方向 256；空串一律不序列化（旧简历逐字节不变）。

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
    # F8（R-81）：资料页教育经历里没有独立表单项的小字段，现在可手写/直编。
    study_form: str = Field(default="", max_length=64)
    degree_type: str = Field(default="", max_length=64)
    department: str = Field(default="", max_length=128)
    rank: str = Field(default="", max_length=64)
    advisor: str = Field(default="", max_length=128)
    research_direction: str = Field(default="", max_length=256)
    # W01 稳定身份（可选）：旧记录没有就是没有——GET 不生成、不改写库；只有保存时
    # 客户端带上来的值才原样落库。校验在 document_identity.validate_document_ids。
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = (
        "study_form",
        "degree_type",
        "department",
        "rank",
        "advisor",
        "research_direction",
    )


class ResumeExperience(OptionalVisibilityMixin, BaseModel):
    company: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    # A4 实践/服务经历：关系类型（全职/兼职/合同/自雇/实习/志愿/其他）。空串不序列化，
    # 旧记录没有这个键，内容指纹不变。取值见 EXPERIENCE_KINDS（白名单在解析层收口）。
    experience_kind: str = Field(default="", max_length=32)
    # F8（R-81）：团队规模（自由文本，如"30 人"）。
    team_size: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = (
        "experience_kind",
        "team_size",
    )


class ResumeCampusExperience(OptionalVisibilityMixin, BaseModel):
    organization: str = Field(default="", max_length=128)
    role: str = Field(default="", max_length=128)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    description: list[ResumeLine] = Field(default_factory=list, max_length=MAX_RESUME_LIST_ITEMS)
    # F8（R-81）：活动类型（自由文本，枚举建议仍只在资料页）。
    activity_type: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = ("activity_type",)


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
    # F8（R-81）：项目规模（自由文本，如"10 人月"）。
    project_size: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = (
        "public_url",
        "artifact_type",
        "project_size",
    )

    _validate_public_url = field_validator("public_url")(_validate_http_url)


class ResumeSkill(OptionalVisibilityMixin, BaseModel):
    name: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=64)
    # F8（R-81）：技能分类（自由文本，枚举建议仍只在资料页）。
    category: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = ("category",)


class ResumeLanguageItem(OptionalVisibilityMixin, BaseModel):
    """语言能力条目（2026-10 起独立成栏，不再并入专业技能）。

    资料页的五个字段一一对应：语言 / 水平等级 / 证书 / 分数 / 取得时间。
    旧版把这些信息压成一条 skills 记录（R-72 路线 1），用户反馈"制作台里语言能力
    变成了专业技能"，因此改为独立分区；空列表不序列化（旧简历指纹不变）。
    """

    name: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=64)
    certificate: str = Field(default="", max_length=128)
    score: str = Field(default="", max_length=64)
    obtained_at: str = Field(default="", max_length=32)
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = (
        "level",
        "certificate",
        "score",
        "obtained_at",
    )


class ResumeAward(OptionalVisibilityMixin, BaseModel):
    name: str = Field(default="", max_length=256)
    date: str = Field(default="", max_length=32)
    description: str = Field(default="", max_length=20_000)
    # F8（R-81）：颁发机构/奖项级别/获奖比例（自由文本；枚举建议仍只在资料页）。
    issuer: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=64)
    ratio: str = Field(default="", max_length=64)
    id: str | None = Field(default=None, max_length=32)
    _optional_empty_string_fields: ClassVar[tuple[str, ...]] = (
        "issuer",
        "level",
        "ratio",
    )


__all__ = [
    "EXPERIENCE_KINDS",
    "MAX_RESUME_LIST_ITEMS",
    "MAX_RESUME_SECTION_ITEMS",
    "MAX_RESUME_TEXT_CHARS",
    "ResumeAward",
    "ResumeCampusExperience",
    "ResumeEducation",
    "ResumeExperience",
    "ResumeLanguageItem",
    "ResumeLine",
    "ResumeProject",
    "ResumeSkill",
]

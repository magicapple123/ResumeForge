"""RF-15 合成评测样本 Schema。

同构约定（本任务价值的一半）：

- ``profile`` **直接复用生产结构** :class:`app.schemas.profile.ProfileUpdate`——
  评测样本与生产资料同构，规则在评测里发现的字段级问题在生产链路里同样成立，
  不存在"评测一套字段、生产另一套字段"的漂移。
- ``claims`` 的事实字段对齐事实台账 ``ClaimBase``（title / category / subject /
  source_fact / candidate_wording / responsibility_level / verification_status /
  boundary），枚举取值直接引用 ``app.models.claim`` 的常量。
- ``key_terms`` / ``boundary_forbidden`` 是**评测专用**的确定性门禁元数据：
  它们不进生产台账，只为让 fact_omission / boundary_violation 的判据可复现
  （规则不做模型评分，见 checks.py 模块说明）。

样本全部为纯虚构内容：姓名用常见虚构名，公司为明显虚构组织，联系方式只允许
保留号段（13800138000 / 19999990000）、999999 开头的假身份证号与 example.com
邮箱——由 test_synthetic_fixtures 的隐私扫描器钉住。
"""
from typing import Literal

from app.models.claim import (
    CLAIM_CATEGORIES,
    CLAIM_CATEGORY_OTHER,
    RESPONSIBILITY_LEVELS,
    VERIFICATION_PENDING,
    VERIFICATION_STATUSES,
)
from app.schemas.profile import ProfileUpdate
from pydantic import BaseModel, Field, field_validator, model_validator

PERSONA_TYPES = ("应届", "社招", "转行", "学生兼职")
LANGUAGES = ("中文", "英文", "中英混排")


class SyntheticClaim(BaseModel):
    """一条事实台账条目（对齐生产 ClaimBase + 评测专用元数据）。"""

    title: str = Field(default="", max_length=200)
    category: str = Field(default=CLAIM_CATEGORY_OTHER, max_length=32)
    subject: str = Field(default="", max_length=200)
    source_fact: str = Field(default="", max_length=8000)
    candidate_wording: str = Field(default="", max_length=8000)
    responsibility_level: str = Field(default=RESPONSIBILITY_LEVELS[0], max_length=32)
    verification_status: str = Field(default=VERIFICATION_PENDING, max_length=16)
    boundary: str = Field(default="", max_length=1000)
    # 评测专用：JD 强相关且生成时必须覆盖的关键词（fact_omission 的确定性判据）。
    key_terms: list[str] = Field(default_factory=list, max_length=10)
    # 评测专用：个人边界里明确"不掌握"的内容（boundary_violation 的确定性判据）。
    boundary_forbidden: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("category")
    @classmethod
    def category_must_be_known(cls, value: str) -> str:
        cleaned = (value or "").strip() or CLAIM_CATEGORY_OTHER
        if cleaned not in CLAIM_CATEGORIES:
            raise ValueError(f"未知的台账分类「{cleaned}」")
        return cleaned

    @field_validator("responsibility_level")
    @classmethod
    def responsibility_must_be_known(cls, value: str) -> str:
        cleaned = (value or "").strip() or RESPONSIBILITY_LEVELS[0]
        if cleaned not in RESPONSIBILITY_LEVELS:
            raise ValueError(f"未知的承担程度「{cleaned}」")
        return cleaned

    @field_validator("verification_status")
    @classmethod
    def verification_must_be_known(cls, value: str) -> str:
        cleaned = (value or "").strip() or VERIFICATION_PENDING
        if cleaned not in VERIFICATION_STATUSES:
            raise ValueError(f"未知的核实状态「{cleaned}」")
        return cleaned

    @model_validator(mode="after")
    def must_be_describable(self) -> "SyntheticClaim":
        """与生产 ClaimBase 同规则：至少要写清原始事实或简历表述之一。"""
        if not self.source_fact.strip() and not self.candidate_wording.strip():
            raise ValueError(f"主张「{self.title or self.subject}」缺少事实内容")
        return self


class SyntheticSample(BaseModel):
    """一份合成评测样本：虚构候选人资料 + 目标岗位 + 事实台账。"""

    id: str = Field(max_length=64)
    persona_type: Literal["应届", "社招", "转行", "学生兼职"]
    language: Literal["中文", "英文", "中英混排"]
    industry: str = Field(max_length=32)
    adversarial_tags: list[str] = Field(default_factory=list, max_length=10)
    # 样本里出现过的占位联系方式（privacy_leak 规则的放行清单）。
    privacy_placeholders: list[str] = Field(default_factory=list, max_length=20)
    # JD 内嵌提示注入的原文片段（prompt_injection_passthrough 的比对依据）。
    injection_snippets: list[str] = Field(default_factory=list, max_length=10)
    profile: ProfileUpdate
    job_description: str = Field(default="", max_length=100_000)
    claims: list[SyntheticClaim] = Field(default_factory=list, max_length=20)
    notes: str = Field(default="", max_length=2000)

    @field_validator("id")
    @classmethod
    def id_must_be_prefixed(cls, value: str) -> str:
        if not value.startswith("synthetic_"):
            raise ValueError(f"样本 id 必须以 synthetic_ 开头，收到 {value!r}")
        return value

    @field_validator("industry")
    @classmethod
    def industry_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("industry 不能为空")
        return cleaned

# SPDX-License-Identifier: Apache-2.0
"""岗位需求总结的内部结构，供服务层和后续 API 复用。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_ANALYSIS_REQUIREMENTS = 20
MAX_ANALYSIS_ADVICE = 12


class _StrictAnalysisModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def strip_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class JobRequirementAnalysis(_StrictAnalysisModel):
    priority: Literal["high", "medium", "low"]
    category: str = Field(min_length=1, max_length=64)
    requirement: str = Field(min_length=1, max_length=2000)
    evidence: str = Field(min_length=1, max_length=2000)


class JobSearchAdvice(_StrictAnalysisModel):
    title: str = Field(min_length=1, max_length=128)
    action: str = Field(min_length=1, max_length=2000)
    rationale: str = Field(min_length=1, max_length=2000)


class JobAnalysisResult(_StrictAnalysisModel):
    summary: str = Field(min_length=1, max_length=5000)
    requirements: list[JobRequirementAnalysis] = Field(
        default_factory=list, max_length=MAX_ANALYSIS_REQUIREMENTS
    )
    advice: list[JobSearchAdvice] = Field(default_factory=list, max_length=MAX_ANALYSIS_ADVICE)


class JobAnalysisResponse(JobAnalysisResult):
    """``POST /api/jobs/{id}/analysis`` 的响应体：生成结构 + 这次是不是直接读的缓存。

    只在生成结构上**追加**一个 ``cached`` 字段，其余字段语义一字不改：旧前端忽略未知
    字段照常工作，新前端据它区分"这次等了 10–60 秒"还是"秒开"。

    为什么不直接把 ``cached`` 写进 ``JobAnalysisResult``：那个模型同时是模型结构化输出的
    解析目标（``extra="forbid"``），多一个字段会让模型以为必须返回它。
    """

    cached: bool = False

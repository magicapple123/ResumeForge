# SPDX-License-Identifier: Apache-2.0
"""ATS 本地检测的请求/响应 schema（R-10）。

三类结论：格式风险（format）/ 关键词覆盖（keyword）/ 信息位置（position）。结果里
强制携带 ``disclaimer``（本地规则估计，不代表真实 ATS 解析结果），前端必须展示。
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_JD_TEXT_CHARS = 50_000

AtsIssueCategory = Literal["format", "keyword", "position"]
AtsSeverity = Literal["high", "medium", "low"]

# 免责声明全文；测试会断言它逐字出现在响应里。
ATS_DISCLAIMER = "本地规则估计，不代表真实 ATS 解析结果"


class AtsCheckRequest(BaseModel):
    """ATS 检测请求。``jd_text`` 可选：提供后按 JD 命中的词库关键词检查覆盖。"""

    model_config = ConfigDict(extra="forbid")
    jd_text: str = Field(default="", max_length=MAX_JD_TEXT_CHARS)


class AtsIssue(BaseModel):
    category: AtsIssueCategory
    severity: AtsSeverity = "medium"
    title: str = ""
    detail: str = ""
    # 涉及的关键词 / 命中的符号，便于前端定位。
    evidence: list[str] = Field(default_factory=list, max_length=20)
    # 面向用户的改进建议（R13）。默认空串保持向后兼容：旧客户端拿不到也不会崩。
    suggestion: str = ""


class AtsCheckOut(BaseModel):
    resume_id: int
    issues: list[AtsIssue] = Field(default_factory=list)
    # 简历里已命中的关键词。
    matched_keywords: list[str] = Field(default_factory=list)
    # 未命中的关键词（JD 或通用词库）。
    missing_keywords: list[str] = Field(default_factory=list)
    # 0~100 的粗略估计分，仅作参考。
    score: int = Field(default=0, ge=0, le=100)
    disclaimer: str = ATS_DISCLAIMER
    summary: dict[str, int] = Field(default_factory=dict)
    # 三个分项的分数（键与 issue 类别一致：format / keyword / position），
    # 加起来不等于总分——总分是 0.4/0.4/0.2 加权后的结果。
    subscores: dict[str, int] = Field(default_factory=dict)
    # 关键词覆盖率（0~1）：目标词里有多少出现在简历中。
    coverage_ratio: float = Field(default=0.0, ge=0.0, le=1.0)
    # 每个目标词的命中情况：[{keyword, matched, count, sections}]。默认空列表向后兼容。
    keyword_hits: list[dict] = Field(default_factory=list)


__all__ = [
    "ATS_DISCLAIMER",
    "AtsCheckOut",
    "AtsCheckRequest",
    "AtsIssue",
    "AtsIssueCategory",
    "AtsSeverity",
    "MAX_JD_TEXT_CHARS",
]

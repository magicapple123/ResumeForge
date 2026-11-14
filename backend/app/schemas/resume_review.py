# SPDX-License-Identifier: Apache-2.0
"""待审变更预检 Schema（RF-13，从 ``schemas/resume.py`` 迁出，导入路径保持兼容）。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .resume_entries import MAX_RESUME_TEXT_CHARS
from .resume_generation import MAX_CUSTOM_INSTRUCTION_CHARS

# ===== 待审变更预检（RF-13）：编辑器里的 AI 改写/手填，先过三把既有闸门再落表单 =====

ReviewChangeOrigin = Literal["ai_rewrite", "user_added"]


class ReviewChangeIn(BaseModel):
    """一条待审变更：``path`` 是 data-resume-path 写法的字段路径。"""

    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=256)
    before: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    after: str = Field(default="", max_length=MAX_RESUME_TEXT_CHARS)
    origin: ReviewChangeOrigin = "ai_rewrite"
    instruction: str = Field(default="", max_length=MAX_CUSTOM_INSTRUCTION_CHARS)


class ReviewPrepareRequest(BaseModel):
    """预检请求：**不落库、不改 content**——纯审阅预检。"""

    model_config = ConfigDict(extra="forbid")

    changes: list[ReviewChangeIn] = Field(default_factory=list, max_length=50)


class ReviewChangeVerdictOut(BaseModel):
    """一条变更的预检结论：``ok`` / ``fact_check_needed`` / ``blocked`` + 原因。"""

    path: str
    verdict: Literal["ok", "fact_check_needed", "blocked"]
    reasons: list[str] = Field(default_factory=list)


class ReviewPrepareOut(BaseModel):
    results: list[ReviewChangeVerdictOut] = Field(default_factory=list)

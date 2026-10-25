# SPDX-License-Identifier: Apache-2.0
"""W17 私有表达资产的接口形状（后端契约；前端消费方 fe-content）。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .resume import ResumeOut

PhraseKind = Literal["achievement", "method", "result", "summary", "custom"]
PhraseLanguage = Literal["", "zh-CN", "en-US"]

MAX_PHRASE_TEXT = 2000
MAX_PHRASE_TAGS = 20
MAX_PHRASE_TAG_LENGTH = 32
MAX_PHRASE_QUALITY_NOTE = 256


class PhraseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_PHRASE_TEXT)
    kind: PhraseKind = "custom"
    language: PhraseLanguage = ""
    source_claim_id: int | None = Field(default=None, ge=1)
    source_resume_id: int | None = Field(default=None, ge=1)
    source_object_id: str | None = Field(default=None, max_length=32)
    job_tags: list[str] = Field(default_factory=list, max_length=MAX_PHRASE_TAGS)
    quality_note: str = Field(default="", max_length=MAX_PHRASE_QUALITY_NOTE)


class PhraseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, min_length=1, max_length=MAX_PHRASE_TEXT)
    kind: PhraseKind | None = None
    language: PhraseLanguage | None = None
    job_tags: list[str] | None = Field(default=None, max_length=MAX_PHRASE_TAGS)
    quality_note: str | None = Field(default=None, max_length=MAX_PHRASE_QUALITY_NOTE)


class PhraseOut(BaseModel):
    id: int
    text: str
    kind: str
    language: str = ""
    source_claim_id: int | None = None
    source_resume_id: int | None = None
    source_object_id: str | None = None
    job_tags: list[str] = Field(default_factory=list)
    quality_note: str = ""
    usage_count: int = 0
    last_used_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PhraseListOut(BaseModel):
    items: list[PhraseOut] = Field(default_factory=list)
    next_cursor: int | None = None


class PhraseUpdateOut(PhraseOut):
    """PATCH 的响应：更新后的资产 + **更新前快照**（供「更新先看差异」本地对比）。

    差异由前端算（文本/标签），服务端只保证"旧值和新值同时可拿到"，不替用户决定
    哪一版更好；previous=null 表示更新前记录不可读（正常路径不会出现）。
    """

    previous: PhraseOut | None = None


class PhraseCollectRequest(BaseModel):
    """从简历里选中的一句收藏成资产（path 是 data-resume-path）。

    ``job_tags`` 可选：收藏时顺手打岗位/技能标签（W17 列表按 tag 过滤的数据来源）。
    """

    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(ge=1)
    path: str = Field(min_length=1, max_length=256)
    job_tags: list[str] = Field(default_factory=list, max_length=MAX_PHRASE_TAGS)


class PhraseInsertRequest(BaseModel):
    """把资产插入简历：新目标身份 + 条件写；失败不改正文。"""

    model_config = ConfigDict(extra="forbid")

    resume_id: int = Field(ge=1)
    section: str = Field(min_length=1, max_length=32)
    entry_id: str | None = Field(default=None, max_length=32)
    point_index: int | None = Field(default=None, ge=0, le=500)
    expected_revision: int | None = Field(default=None, ge=0)


class PhraseInsertOut(BaseModel):
    resume: ResumeOut
    phrase: PhraseOut
    inserted_object_id: str
    inserted_point_id: str | None = None

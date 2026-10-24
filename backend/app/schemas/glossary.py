# SPDX-License-Identifier: Apache-2.0
"""W16 数据集级术语表的接口形状。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

GlossaryLanguage = Literal["zh-CN", "en-US"]
GlossaryCategory = Literal["name", "institution", "company", "skill", "term"]
MAX_TERM_LENGTH = 128
MAX_TERM_NOTE = 256


class GlossaryTermIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_term: str = Field(min_length=1, max_length=MAX_TERM_LENGTH)
    target_term: str = Field(min_length=1, max_length=MAX_TERM_LENGTH)
    language_from: GlossaryLanguage
    language_to: GlossaryLanguage
    category: GlossaryCategory = "term"
    locked: bool = True
    note: str = Field(default="", max_length=MAX_TERM_NOTE)


class GlossaryTermUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_term: str | None = Field(default=None, min_length=1, max_length=MAX_TERM_LENGTH)
    target_term: str | None = Field(default=None, min_length=1, max_length=MAX_TERM_LENGTH)
    category: GlossaryCategory | None = None
    locked: bool | None = None
    note: str | None = Field(default=None, max_length=MAX_TERM_NOTE)


class GlossaryTermOut(BaseModel):
    id: int
    source_term: str
    target_term: str
    language_from: str
    language_to: str
    category: str = "term"
    locked: bool = True
    note: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class GlossaryListOut(BaseModel):
    items: list[GlossaryTermOut] = Field(default_factory=list)


class GlossaryImportRequest(BaseModel):
    """批量导入/更新术语；同 (source_term, language_to) 视为同一条。"""

    model_config = ConfigDict(extra="forbid")

    items: list[GlossaryTermIn] = Field(min_length=1, max_length=500)


class GlossaryImportOut(BaseModel):
    created: int = 0
    updated: int = 0
    items: list[GlossaryTermOut] = Field(default_factory=list)

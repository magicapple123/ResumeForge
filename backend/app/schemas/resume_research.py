# SPDX-License-Identifier: Apache-2.0
"""W14 科研三栏目的内容模型（零新表：全部存在 ``content`` JSON 内）。

放在独立文件的原因与 W01/W06 相同：``schemas/resume.py`` 贴着 500 行预算，而
"论文/科研项目/专利长什么样"是一组自洽的模型。

**三条硬约束**：
1. 稳定身份与可见性**复用** W01/W06 的 mixin（``OptionalVisibilityMixin`` 同时带
   id/point_ids/hidden/lock_*），不在这里再声明一遍字段——两份字段必然漂移；
2. 作者/发明人**列表顺序即署名顺序**，本人标记走 ``is_self`` 字段（不往 name 写
   ``**`` 标记：那会污染搜索与复制）；
3. 状态是**事实锁**字段：枚举固定，``under_review`` 不得被展示成"已发表"。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .resume_visibility import OptionalVisibilityMixin

PublicationStatus = Literal[
    "published",
    "accepted",
    "in_press",
    "under_review",
    "preprint",
    "other",
]
PatentStatus = Literal["filed", "pending", "granted", "expired", "other"]

MAX_AUTHORS = 50
MAX_RESEARCH_ITEMS = 200
MAX_TITLE_CHARS = 512
MAX_VENUE_CHARS = 256
MAX_URL_CHARS = 512


def _validate_http_url(value: str) -> str:
    """科研链接只接受 http(s)（空串允许）：模板会把它渲染成可点击链接，别的协议一律拒绝。"""
    text = (value or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        raise ValueError("科研链接只允许 http(s)")
    return text


class ResumeAuthor(BaseModel):
    """作者/发明人：列表下标即署名顺序，``is_self`` 标本人，``corresponding`` 标通讯作者。"""

    name: str = Field(default="", max_length=128)
    is_self: bool = False
    corresponding: bool = False


class ResumePublication(OptionalVisibilityMixin, BaseModel):
    """一条论文/发表记录。``status`` 是事实锁字段（AI 不得改）。"""

    title: str = Field(default="", max_length=MAX_TITLE_CHARS)
    authors: list[ResumeAuthor] = Field(default_factory=list, max_length=MAX_AUTHORS)
    venue: str = Field(default="", max_length=MAX_VENUE_CHARS)
    year: str = Field(default="", max_length=8)
    status: PublicationStatus = "other"
    doi: str = Field(default="", max_length=256)
    url: str = Field(default="", max_length=MAX_URL_CHARS)
    volume_pages: str = Field(default="", max_length=64)
    note: str = Field(default="", max_length=2000)
    # W01 稳定身份（可选；None 不序列化，见 OptionalVisibilityMixin 的字段表）
    id: str | None = Field(default=None, max_length=32)

    _validate_url = field_validator("url")(_validate_http_url)


class ResumeResearchProject(OptionalVisibilityMixin, BaseModel):
    """科研项目（与"项目经历"分开：有实验室/机构与经费字段）。"""

    name: str = Field(default="", max_length=256)
    role: str = Field(default="", max_length=128)
    organization: str = Field(default="", max_length=256)
    start_date: str = Field(default="", max_length=32)
    end_date: str = Field(default="", max_length=32)
    funding: str = Field(default="", max_length=256)
    description: list[str] = Field(default_factory=list, max_length=500)
    outcomes: list[str] = Field(default_factory=list, max_length=500)
    # W01 稳定身份 + 要点伴随映射（与六类旧条目同一机制）
    id: str | None = Field(default=None, max_length=32)
    point_ids: dict[str, list[str]] | None = None


class ResumePatent(OptionalVisibilityMixin, BaseModel):
    """一条专利记录。``status`` 与专利号/申请日/授权日是事实锁字段。"""

    title: str = Field(default="", max_length=MAX_TITLE_CHARS)
    inventors: list[ResumeAuthor] = Field(default_factory=list, max_length=MAX_AUTHORS)
    patent_number: str = Field(default="", max_length=64)
    country: str = Field(default="", max_length=32)
    status: PatentStatus = "other"
    filed_date: str = Field(default="", max_length=32)
    granted_date: str = Field(default="", max_length=32)
    url: str = Field(default="", max_length=MAX_URL_CHARS)
    id: str | None = Field(default=None, max_length=32)

    _validate_url = field_validator("url")(_validate_http_url)


__all__ = [
    "MAX_AUTHORS",
    "MAX_RESEARCH_ITEMS",
    "PatentStatus",
    "PublicationStatus",
    "ResumeAuthor",
    "ResumePatent",
    "ResumePublication",
    "ResumeResearchProject",
]

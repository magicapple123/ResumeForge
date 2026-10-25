# SPDX-License-Identifier: Apache-2.0
"""资格证照栏目的内容模型（A4；零新表：全部存在 content JSON 内）。

放在独立文件的理由与 W14 科研三栏一致：schemas/resume.py 贴着 500 行预算，而
"一条资格证照长什么样"是一组自洽的模型。

**三条硬约束**：

1. **没有 credential_number**：证号默认不进模型、不进纸面、不进导出。需要展示时由
   本地受控字段注入（计划 §8.4：资格编号默认不进模型、日志或纸面）。因此这里根本不声明
   该字段——模型输出/旧内容里即使带了它，也会在解析层被丢弃（不是"渲染时再遮"）。
2. 状态是**事实锁**字段：unknown / pending / active / expired 四态，默认 unknown
   （不自动认定资格）。AI 与关键词都不能把 pending 升级成"已取得"。
3. 稳定身份与可见性**复用** W01/W06 的 mixin（id/hidden/lock_*），不在这里再声明一遍；
   verify_url 只接受 http(s)（模板会把它渲染成可点击链接）。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .resume_research import MAX_URL_CHARS, _validate_http_url
from .resume_visibility import OptionalVisibilityMixin

CredentialStatus = Literal["unknown", "pending", "active", "expired"]

MAX_CREDENTIAL_NAME_CHARS = 128
MAX_ISSUER_CHARS = 256
MAX_DATE_CHARS = 32
MAX_NOTE_CHARS = 2000


class ResumeCredential(OptionalVisibilityMixin, BaseModel):
    """一条资格证照。status 是事实锁字段（AI 不得改），默认 unknown。

    credential_number 刻意**不在这里**：证号是私密值，生成/导出/纸面都不需要它；
    只存在于用户的本地资料里（profile_fact 的私密 payload），由用户显式查看。
    """

    name: str = Field(default="", max_length=MAX_CREDENTIAL_NAME_CHARS)
    issuer: str = Field(default="", max_length=MAX_ISSUER_CHARS)
    issue_date: str = Field(default="", max_length=MAX_DATE_CHARS)
    expiry_date: str = Field(default="", max_length=MAX_DATE_CHARS)
    status: CredentialStatus = "unknown"
    verify_url: str = Field(default="", max_length=MAX_URL_CHARS)
    note: str = Field(default="", max_length=MAX_NOTE_CHARS)
    # W01 稳定身份（可选；None 不序列化，见 OptionalVisibilityMixin 的字段表）
    id: str | None = Field(default=None, max_length=32)

    _validate_verify_url = field_validator("verify_url")(_validate_http_url)


__all__ = [
    "CredentialStatus",
    "MAX_CREDENTIAL_NAME_CHARS",
    "MAX_DATE_CHARS",
    "MAX_ISSUER_CHARS",
    "MAX_NOTE_CHARS",
    "ResumeCredential",
]

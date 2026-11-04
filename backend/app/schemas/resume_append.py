# SPDX-License-Identifier: Apache-2.0
"""3-A：把资料条目确定性补进简历的请求/响应模型。

单独成文件的两个理由：
- ``schemas/resume.py`` 已经贴着 500 行硬预算（本仓对超预算 schema 沿用"拆文件 + 在
  ``resume.py`` 里 re-export"的先例，见 ``resume_custom_sections`` / ``resume_research``）；
- 这两个模型只服务于一个端点，与生成/修订请求没有共享字段，放一起只会让 ``resume.py``
  更难读。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .resume import ResumeOut

#: 一次补入最多几条：与 ``ResumeCustomSection.entries`` 的上限同一量级，超出的属于异常调用。
MAX_APPEND_ENTRIES = 200


class AppendProfileEntriesRequest(BaseModel):
    """``POST /api/resumes/{id}/append-profile-entries`` 的请求体。

    ``entry_ids`` 来自覆盖度清单（``coverage_notes[].entry_ids``，3-A 前置改动）。
    旧记录没有这个字段，前端只能引导用户去制作台，不会走到这里（服务端仍校验非空）。
    """

    model_config = ConfigDict(extra="forbid")

    #: 目标分区的**资料分区键**（``custom:<section_id>`` 或系统分区键）：文档里的分区
    #: key 与它逐字相同，所以不存在"资料键 → 简历键"的第二张映射表。
    section_key: str = Field(min_length=1, max_length=64)
    entry_ids: list[str] = Field(default_factory=list, max_length=MAX_APPEND_ENTRIES)
    #: 点「补进简历」时的那一版（W02 条件写）：期间别的窗口保存过就 409，不覆盖。
    base_revision: int | None = Field(default=None, ge=0)


class AppendProfileEntriesOut(BaseModel):
    """补入结果：更新后的简历 + 实际写进去/被跳过的条目名。

    ``skipped`` 是"这条资料已经在正文里了"（按身份名去重命中）——它不是失败，前端用它
    提示"已存在 N 条，未重复添加"，并且这些名字同样会从 ``coverage_notes`` 里摘掉。
    """

    resume: ResumeOut
    appended: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)


__all__ = ["AppendProfileEntriesOut", "AppendProfileEntriesRequest", "MAX_APPEND_ENTRIES"]

# SPDX-License-Identifier: Apache-2.0
"""投递台补强（#14）的请求 / 响应结构：投递前体检、漏斗摘要、跟进闭环、话术库与屏蔽清单。

**字段名就是前后端契约**（前端按这些名字取值），改名等于破坏接口。

``summary.blocking`` / ``summary.warnings`` 的语义是**条目数**，不是 issue 条数：
一条队列条目可能同时命中两条 warning，但它在界面上只算"1 条要留意"。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .base import MAX_QUEUE_BATCH

# 体检结论码：取值是**协议值**（前端据此分组、给「一键修」按钮），不做展示名。
PreflightCode = Literal[
    "source_unsupported",
    "resume_missing",
    "match_missing",
    "match_weak",
    "greeting_weak",
    # 15A：僵尸岗提示（warning，>70 分才报；岗位置了 ghost_ignored 就不报）。
    "ghost_job",
]
PreflightSeverity = Literal["blocking", "warning"]

# 单条模板正文上限：招呼语在真实站点上也有长度上限，2000 字足够长文案，也不会把
# AppSetting 的一行 JSON 撑到不可读。
MAX_TEMPLATE_BODY_CHARS = 2000
MAX_TEMPLATE_NAME_CHARS = 64
MAX_TEMPLATE_TAGS = 10
MAX_TEMPLATE_TAG_CHARS = 16
MAX_GREETING_TEMPLATES = 50
# 屏蔽清单本身是手填的小名单（几十家 / 几十个词），上限只防"粘错整篇文档"。
MAX_BLOCKLIST_ITEMS = 200
MAX_BLOCKLIST_ITEM_CHARS = 64

# ===== 14A 投递前体检 =====


class ApplyPreflightIn(BaseModel):
    """体检请求：``queue_ids`` 省略 = 整个队列（按界面顺序）。"""

    model_config = ConfigDict(extra="forbid")

    queue_ids: list[int] | None = Field(default=None, max_length=MAX_QUEUE_BATCH)


class ApplyPreflightIssue(BaseModel):
    code: PreflightCode
    severity: PreflightSeverity
    # message 说明"会发生什么"，fix 说明"怎么办"——两条都必须有人话，界面直接展示。
    message: str
    fix: str


class ApplyPreflightItemOut(BaseModel):
    queue_id: int
    issues: list[ApplyPreflightIssue] = Field(default_factory=list)


class ApplyPreflightSummary(BaseModel):
    """按**条目**聚合：有 blocking 的条目数 / 有 warning 的条目数（可同时计入两者）。"""

    blocking: int = 0
    warnings: int = 0


class ApplyPreflightOut(BaseModel):
    items: list[ApplyPreflightItemOut] = Field(default_factory=list)
    summary: ApplyPreflightSummary = Field(default_factory=ApplyPreflightSummary)


# ===== 14F 顶部漏斗条 =====


class ApplySummaryOut(BaseModel):
    """最近 N 天的执行量 + 当前在面/Offer 的快照。

    ``applied`` = 真正动过手的条数（成功 + 失败），``skipped`` 不算投递。
    ``interviewing`` 是**快照**（不受 ``days`` 限制）：它回答"现在有几个在面"，
    按窗口裁剪会把它变成"最近 7 天推进到面试的个数"，那与漏斗条的用途不符。
    """

    applied: int = 0
    succeeded: int = 0
    failed: int = 0
    interviewing: int = 0


# ===== 14C 跟进闭环 =====


class ApplyStaleRecordOut(BaseModel):
    record_id: int
    job_id: int | None = None
    job_title: str = ""
    company: str = ""
    # 投递日期（YYYY-MM-DD）：与 tracker 的日期字段同一格式，不在这里造时间戳。
    applied_at: str = ""
    days: int = 0


class ApplyStaleListOut(BaseModel):
    items: list[ApplyStaleRecordOut] = Field(default_factory=list)
    count: int = 0


class ApplyTrackLinkOut(BaseModel):
    """一键写进度的结果：``created=false`` 表示命中查重、返回的是已有的那条。"""

    track_id: int
    created: bool
    stage: str = ""


# ===== 14D 话术库 =====


class GreetingTemplateIn(BaseModel):
    """写入单条模板。``uses`` 省略（None）= 保留原有计数，不清零。"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default="", max_length=64)
    name: str = Field(default="", max_length=MAX_TEMPLATE_NAME_CHARS)
    body: str = Field(default="", max_length=MAX_TEMPLATE_BODY_CHARS)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TEMPLATE_TAGS)
    uses: int | None = Field(default=None, ge=0)


class GreetingTemplateOut(BaseModel):
    id: str
    name: str
    body: str
    tags: list[str] = Field(default_factory=list)
    uses: int = 0


class GreetingTemplateListOut(BaseModel):
    templates: list[GreetingTemplateOut] = Field(default_factory=list)


class GreetingTemplateSaveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    templates: list[GreetingTemplateIn] = Field(
        default_factory=list, max_length=MAX_GREETING_TEMPLATES
    )


# ===== 14E 屏蔽清单 =====


class ApplyBlocklistOut(BaseModel):
    companies: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class ApplyBlocklistIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    companies: list[str] = Field(default_factory=list, max_length=MAX_BLOCKLIST_ITEMS)
    keywords: list[str] = Field(default_factory=list, max_length=MAX_BLOCKLIST_ITEMS)


__all__ = [
    "MAX_BLOCKLIST_ITEMS",
    "MAX_BLOCKLIST_ITEM_CHARS",
    "MAX_GREETING_TEMPLATES",
    "MAX_TEMPLATE_BODY_CHARS",
    "MAX_TEMPLATE_NAME_CHARS",
    "MAX_TEMPLATE_TAGS",
    "MAX_TEMPLATE_TAG_CHARS",
    "ApplyBlocklistIn",
    "ApplyBlocklistOut",
    "ApplyPreflightIn",
    "ApplyPreflightIssue",
    "ApplyPreflightItemOut",
    "ApplyPreflightOut",
    "ApplyPreflightSummary",
    "ApplyStaleListOut",
    "ApplyStaleRecordOut",
    "ApplySummaryOut",
    "ApplyTrackLinkOut",
    "GreetingTemplateIn",
    "GreetingTemplateListOut",
    "GreetingTemplateOut",
    "GreetingTemplateSaveIn",
    "PreflightCode",
    "PreflightSeverity",
]

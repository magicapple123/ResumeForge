# SPDX-License-Identifier: Apache-2.0
"""收藏夹（#28）的请求/响应结构。

收藏夹列表 = 岗位列表字段 + 生命周期状态（已投递 / 在队列）。刻意不把 applied / queued
塞进 JobListOut：那两个标记属于收藏夹这个视图，不是岗位本身的字段；岗位详情与岗位广场
不该因为一次「投递过」查询多出两次 SQL。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .job import JobListOut

#: 28A 的三个排序选项：收藏时间 / 发布时间 / 匹配度（与后端 service 同一份取值）。
FavoriteSort = Literal["favorited_desc", "posted_desc", "match_desc"]


class FavoriteJobOut(JobListOut):
    """收藏夹行：岗位字段 + 生命周期徽标（28B）。"""

    # 已投递：apply_task_item 投成功过，或 application_track 有进度行（与 14C 同源）。
    applied: bool = False
    # 最近一次投成功的时间（没有就 None）；只用于展示，不参与徽标判定。
    applied_at: datetime | None = None
    # 在队列：apply_queue_item 里 status=pending。
    queued: bool = False


class FavoriteBatchRequest(BaseModel):
    """批量收藏/取消收藏：与简历/岗位批量操作同一口径（上限 500）。"""

    job_ids: list[int] = Field(min_length=1, max_length=500)
    favorite: bool

    @field_validator("job_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))


class FavoriteBatchResult(BaseModel):
    """批量结果：updated 是成功条数；skipped 是已不存在/已删除、被跳过的 id。"""

    updated: int = 0
    skipped: list[int] = Field(default_factory=list)


class FavoriteLifecycleRequest(BaseModel):
    """批量查生命周期状态（一次最多 500 条，避免前端逐行请求）。"""

    job_ids: list[int] = Field(min_length=1, max_length=500)

    @field_validator("job_ids")
    @classmethod
    def validate_and_deduplicate_ids(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))


class FavoriteLifecycleItem(BaseModel):
    job_id: int
    applied: bool = False
    queued: bool = False


class FavoriteLifecycleOut(BaseModel):
    items: list[FavoriteLifecycleItem] = Field(default_factory=list)


__all__ = [
    "FavoriteBatchRequest",
    "FavoriteBatchResult",
    "FavoriteJobOut",
    "FavoriteLifecycleItem",
    "FavoriteLifecycleOut",
    "FavoriteLifecycleRequest",
    "FavoriteSort",
]

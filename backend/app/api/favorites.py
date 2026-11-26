# SPDX-License-Identifier: Apache-2.0
"""收藏页的简历收藏接口（T31）：`GET /api/favorites` 一次返回**两种 kind**。

## 与 `/api/jobs/favorites` 的分工

岗位收藏与简历收藏是两份不同的读模型（岗位那边要带「已投 / 在队列」生命周期徽标与
导出，见 `api/job_favorites.py`），本模块**只服务简历**：内部简历（`resume_record`）
与外部简历（`external_resume`）的收藏行并成一张表。路径取 `/api/favorites` 是因为
它是收藏页「简历」页签的唯一数据源；岗位那条继续留在 `/api/jobs/favorites`
（字面量兄弟，注册顺序见 `application_routers.py`），两条路径没有交集。

## 响应为什么带 `kind` 和 `ref`

`resume_record.id` 与 `external_resume.id` **各自从 1 开始**，撞号是常态。前端不能靠
"id 落在一个区间里"猜是哪张表——猜错就是把用户点开的那一行换成另一份简历。所以每行
**显式**带 `kind`（`internal` / `external`），并附复合引用 `ref`
（`internal:12` / `external:7`，契约 `CONTRACT.md` 第 2 节），前端可以用它与
`types/resumeRef.ts` 的 `decodeResumeRef` 双向对齐，不必自己拼串。

## schema 为什么写在本模块里

收藏页的读模型只被这一个端点使用，且字段是"两张表的并集"，与任一既有 schema 都不
同构。放进 `schemas/` 会让这个并行改造流去改共享目录（与其它流的文件边界冲突），
所以就地定义、就地消费；将来若第二个调用方出现，再整体搬进 `schemas/favorites.py`。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.common import Page
from ..services.favorites_resumes import (
    FavoriteResumeFilter,
    FavoriteResumeRow,
    favorite_resume_ref,
    list_favorite_resumes,
)

router = APIRouter(prefix="/api", tags=["favorites"])


class FavoriteResumeOut(BaseModel):
    """收藏页的一行（内部或外部简历）。

    字段刻意按"并集"设计：两张表各自独有的列在另一侧留空（`mime` / `file_id` /
    `text_chars` 只在外部行有值，`source` 只在内部行有值），前端因此能用同一套
    列定义渲染两种行，只在渲染时按 `kind` 决定显示哪些子元素。
    """

    #: `internal` = `resume_record`，`external` = `external_resume`。**永远显式给出**。
    kind: Literal["internal", "external"]
    #: 在**自己那张表**里的 id（两种 kind 共享同一段数字空间，不许混用）。
    id: int
    #: 复合引用 `internal:12` / `external:7`（契约第 2 节），前端拿它做稳定 key 与跳转。
    ref: str
    #: 展示名：内部 = 简历标题；外部 = 文件名（用户可重命名）。
    title: str
    #: 关联岗位标题（空串 = 通用简历 / 未关联 / 岗位已被彻底删除）。
    job_title: str = ""
    #: 公司：内部简历自有列；外部简历借关联岗位的公司（无则为空串）。
    company: str = ""
    #: 内部简历的来源（`ai` / `manual`）；外部简历没有这个概念，恒为空串。
    source: str = ""
    #: 外部简历原件的 MIME（前端据此出 PDF/DOCX 徽标）；内部简历恒为空串。
    mime: str = ""
    #: 外部简历当前指向的文件 id（详情页预览原件用）；内部简历为 `null`。
    file_id: int | None = None
    #: 备注（"为什么收藏"）。空串 = 没写。
    note: str = ""
    #: 外部简历的提取字数；内部简历为 `null`（它的字数是渲染期算的，不是列）。
    text_chars: int | None = None
    #: 外部简历有没有文字层（扫描件为 `false`，界面据此禁用"用于面试"）；内部为 `null`。
    has_text: bool | None = None
    #: 恒为 `true`：本端点只返回收藏行（字段保留是为了让前端不必假设）。
    favorite: bool = True
    #: 收藏时刻；`null` = 收藏于 28E 之前且时间戳未回填（界面显示「时间不详」）。
    favorited_at: datetime | None = None
    #: 收藏时间是否「不详」（老数据的近似时间）。
    favorited_at_estimated: bool = False
    created_at: datetime
    updated_at: datetime


def _to_out(row: FavoriteResumeRow) -> FavoriteResumeOut:
    """并集行 → 响应模型；`ref` 在这里现拼，避免服务层与协议串出现两份写法。"""
    return FavoriteResumeOut(
        kind=row.kind,  # type: ignore[arg-type]
        id=row.id,
        ref=favorite_resume_ref(row.kind, row.id),
        title=row.title,
        job_title=row.job_title,
        company=row.company,
        source=row.source,
        mime=row.mime,
        file_id=row.file_id,
        note=row.note,
        text_chars=row.text_chars,
        has_text=row.has_text,
        favorite=True,
        favorited_at=row.favorited_at,
        favorited_at_estimated=row.favorited_at_estimated,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/favorites", response_model=Page[FavoriteResumeOut])
def list_favorites(
    kind: FavoriteResumeFilter = Query(
        default="all", description="all=内部+外部，internal / external 只看一边"
    ),
    keyword: str = Query(default="", description="关键词：简历标题/文件名、岗位、公司"),
    page: int = Query(default=1, ge=1, le=100000),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """收藏页「简历」页签的数据源（T31）：**两种 kind 一次给全**。

    排序固定为「收藏时间倒序」——收藏页按收藏时间看才符合"我刚存下来的那份"。
    排序与分页都在服务端合并后执行（见 `services/favorites_resumes.py` 的模块说明），
    前端拿到的 `total` 是两种 kind 合并后的真实条数。
    """
    rows, total = list_favorite_resumes(
        db,
        kind=kind,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )
    return Page(items=[_to_out(row) for row in rows], total=total)


__all__ = ["FavoriteResumeOut", "router"]

# SPDX-License-Identifier: Apache-2.0
"""收藏夹专用接口（#28A/#28B/#28F）：列表、批量取消收藏、生命周期、导出。

为什么要独立路由而不是给 GET /api/jobs 加参数：收藏夹需要一次查询同时拿到
「岗位字段 + 已投递/在队列」，而这两个标记要从投递记录与队列两张表取；塞进通用岗位
列表会让岗位广场也背上两次额外 SQL。独立端点还能把排序（收藏时间/发布时间/匹配度）
与「已投/未投」筛选收在**同一个**筛选口径里——导出复用同一份，保证「看到什么就导出什么」。

注册顺序：本路由必须在 jobs.router 之前 include（/favorites 是 /api/jobs/{job_id}
的字面量兄弟，晚注册会被参数段吞掉）。
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from starlette.responses import Response

from ..database import get_db
from ..models.job import Job
from ..schemas.common import Page
from ..schemas.job_favorites import (
    FavoriteBatchRequest,
    FavoriteBatchResult,
    FavoriteJobOut,
    FavoriteLifecycleItem,
    FavoriteLifecycleOut,
    FavoriteLifecycleRequest,
    FavoriteSort,
)
from ..services import trash
from ..services.favorites import apply_favorite
from ..services.job.job_favorites import (
    MAX_FAVORITE_JOBS,
    lifecycle_for,
    list_favorite_jobs,
    render_favorites_csv,
    render_favorites_markdown,
)
from ..services.job.job_sorting import JobSortOrder

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _to_favorite_out(
    job: Job,
    applied_map: dict,
    queued_ids: set[int],
) -> FavoriteJobOut:
    """岗位行 -> 收藏夹行；生命周期标记来自本页 id 的一次批量查询。"""
    base = FavoriteJobOut.model_validate(job)
    base.applied = job.id in applied_map
    base.applied_at = applied_map.get(job.id)
    base.queued = job.id in queued_ids
    return base


@router.get("/favorites", response_model=Page[FavoriteJobOut])
def list_favorites(
    keyword: str = Query(default="", description="关键词：标题/公司/地点/描述/备注"),
    status: str = Query(default="", description="岗位状态：开放中 / 已截止 / 已投递"),
    applied: bool | None = Query(
        default=None, description="已投/未投筛选：true=已投递，false=未投递，空=不限"
    ),
    sort: FavoriteSort = Query(default="favorited_desc"),
    order: JobSortOrder | None = Query(default=None),
    page: int = Query(default=1, ge=1, le=100000),
    page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """收藏夹列表（28A/28B）：搜索 + 状态筛选 + 三种排序 + 生命周期徽标。"""
    jobs, total, applied_map, queued_ids = list_favorite_jobs(
        db,
        keyword=keyword,
        status=status,
        applied=applied,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
    )
    return Page(
        items=[_to_favorite_out(job, applied_map, queued_ids) for job in jobs],
        total=total,
    )


@router.post("/favorites/lifecycle", response_model=FavoriteLifecycleOut)
def read_favorites_lifecycle(
    payload: FavoriteLifecycleRequest,
    db: Session = Depends(get_db),
):
    """按 id 批量查生命周期（28B）：收藏页之外的行内按钮也用它判断是否禁用。"""
    states = lifecycle_for(db, payload.job_ids)
    return FavoriteLifecycleOut(
        items=[
            FavoriteLifecycleItem(job_id=job_id, applied=applied, queued=queued)
            for job_id, (applied, queued) in states.items()
        ]
    )


@router.post("/favorites/batch", response_model=FavoriteBatchResult)
def batch_favorite(payload: FavoriteBatchRequest, db: Session = Depends(get_db)):
    """批量收藏/取消收藏（28F）：不存在的行跳过并回传 id，不做「删一半」。"""
    updated = 0
    skipped: list[int] = []
    for job_id in payload.job_ids:
        job = trash.get_live(db, Job, job_id)
        if job is None:
            skipped.append(job_id)
            continue
        apply_favorite(job, payload.favorite)
        updated += 1
    db.commit()
    return FavoriteBatchResult(updated=updated, skipped=skipped)


@router.get("/favorites/export")
def export_favorites(
    format: str = Query(default="csv", pattern="^(csv|md)$"),
    keyword: str = Query(default=""),
    status: str = Query(default=""),
    applied: bool | None = Query(default=None),
    sort: FavoriteSort = Query(default="favorited_desc"),
    order: JobSortOrder | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """导出全部收藏（28F）：复用列表同一份筛选口径，CSV 带 UTF-8 BOM。

    导出的是**全部筛选结果**而不是当前页：分页之后前端只有当前页，由后端导出才能
    保证「数据能原样拿回来」。上限 MAX_FAVORITE_JOBS 与列表一致。
    """
    jobs, _total, _applied, _queued = list_favorite_jobs(
        db,
        keyword=keyword,
        status=status,
        applied=applied,
        sort=sort,
        order=order,
        page=1,
        page_size=MAX_FAVORITE_JOBS,
    )
    if format == "md":
        body = render_favorites_markdown(jobs)
        media_type = "text/markdown; charset=utf-8"
        extension = "md"
    else:
        body = render_favorites_csv(jobs)
        media_type = "text/csv; charset=utf-8"
        extension = "csv"
    filename = f"resumeforge-favorites-{date.today().isoformat()}.{extension}"
    return Response(
        content=body.encode("utf-8"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


__all__ = ["router"]

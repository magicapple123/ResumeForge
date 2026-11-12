# SPDX-License-Identifier: Apache-2.0
"""岗位列表的筛选器（``/jobs`` 分页列表与 ``/jobs/ids`` 跨页全选共用）。

原先长在 ``api/jobs.py``：助手动作的 ``list_jobs`` 要拿同一份筛选口径，只能反向
import 路由模块。筛选口径是"看到的那批岗位"的唯一实现，跟着服务走。
"""

from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models.job import Job
from ...schemas.job import RECOGNITION_SOURCE_AUTO, RECOGNITION_SOURCE_OFFICIAL
from .. import trash


def filtered_query(
    db: Session,
    keyword: str,
    job_type: str,
    status: str,
    favorite: bool | None,
    source_kind: str,
):
    """列表页的共用筛选器：``/jobs``（分页列表）与 ``/jobs/ids``（跨页全选）同吃这一份，
    保证"看到的筛选结果"和"一键全选拿到的 id"永远是对同一批岗位的两种视图。"""
    query = db.query(Job).filter(trash.live_only(Job))
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                Job.title.like(like),
                Job.company.like(like),
                Job.location.like(like),
                Job.description.like(like),
                Job.additional_info.like(like),
                Job.note.like(like),
            )
        )
    if job_type:
        query = query.filter(Job.job_type == job_type)
    if status:
        query = query.filter(Job.status == status)
    if favorite is not None:
        query = query.filter(Job.favorite == favorite)
    if source_kind == "collected":
        query = query.filter(
            or_(
                Job.recognition_source.in_(RECOGNITION_SOURCE_AUTO),
                Job.source == RECOGNITION_SOURCE_OFFICIAL,
            )
        )
    elif source_kind == "manual":
        query = query.filter(
            or_(
                Job.recognition_source.is_(None),
                ~Job.recognition_source.in_(RECOGNITION_SOURCE_AUTO),
            )
        ).filter(Job.source != RECOGNITION_SOURCE_OFFICIAL)
    return query


def jobs_by_ids(db: Session, job_ids: list[int]) -> tuple[list[Job], list[int]]:
    """按给定 id 顺序返回存活岗位与缺失 id（回收站里的算"不存在"）。

    为什么放服务层：岗位批量的存在性校验在列表、批量匹配与后台匹配三处是同一语义，
    路由只该把缺失 id 映射成 404，不该各写一遍查询。
    """
    if not job_ids:
        return [], []
    rows = db.query(Job).filter(trash.live_only(Job), Job.id.in_(job_ids)).all()
    by_id = {job.id: job for job in rows}
    ordered = [by_id[job_id] for job_id in job_ids if job_id in by_id]
    missing = [job_id for job_id in job_ids if job_id not in by_id]
    return ordered, missing


__all__ = ["filtered_query", "jobs_by_ids"]

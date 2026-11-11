# SPDX-License-Identifier: Apache-2.0
"""收藏夹的读模型（#28A/#28B/#28F）：找回层、生命周期徽标与导出。

三件事共用同一份筛选口径——「按筛选看到的结果」和「导出的结果」必须是同一批岗位，
否则用户会拿到一份跟自己看到的不一样的 CSV。

生命周期徽标的取数（28B）与 #14C 同源，不另写一份 join：
- 已投递：apply_task_item 投成功过这条岗位（apply_task.kind=apply + success），
  或 application_track 有这条 job_id 的进度行（进度是投出去之后的唯一凭据）；
- 在队列：apply_queue_item 里 status=pending 的条目（用户显式勾选待投递）。
- 在招/已关闭：直接用 Job.status（开放中 / 已截止），不推断。

导出（28F）放在后端而不是前端：分页之后前端只有当前页；而「数据能原样拿回来」是
调研结论里的硬要求。CSV 带 UTF-8 BOM + CRLF（Excel 打开中文不乱码）。
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ...models.apply import (
    QUEUE_STATUS_PENDING,
    TASK_KIND_APPLY,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
)
from ...models.job import Job
from ...models.tracker import ApplicationTrack
from .. import trash
from ..apply.signals import reference_score

#: 收藏夹一次最多返回多少条（用户收藏是手工动作，正常远小于这个数）。
MAX_FAVORITE_JOBS = 1000

#: 排序键：收藏时间 / 发布时间 / 匹配度（28A 的三个选项）。
FAVORITE_SORTS = ("favorited_desc", "posted_desc", "match_desc")


def _filtered_favorite_query(db: Session, *, keyword: str = "", status: str = ""):
    """收藏夹的共用筛选口径：未删除 + 已收藏，再叠加关键词/状态。"""
    query = db.query(Job).filter(trash.live_only(Job), Job.favorite.is_(True))
    term = (keyword or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                Job.title.like(like),
                Job.company.like(like),
                Job.location.like(like),
                Job.description.like(like),
                Job.note.like(like),
            )
        )
    if status.strip():
        query = query.filter(Job.status == status.strip())
    return query


def applied_states(db: Session, job_ids: list[int]) -> dict[int, datetime | None]:
    """这些岗位里哪些投出去过（28B 的已投递判据，与 14C 同源）。

    返回 job_id -> 最近一次投成功的 finished_at（没有时间就是 None）。
    """
    if not job_ids:
        return {}
    states: dict[int, datetime | None] = {}
    item_rows = (
        db.query(ApplyTaskItem.job_id, func.max(ApplyTaskItem.finished_at))
        .join(ApplyTask, ApplyTaskItem.task_id == ApplyTask.id)
        .filter(
            ApplyTask.kind == TASK_KIND_APPLY,
            trash.live_only(ApplyTaskItem),
            ApplyTaskItem.status == "success",
            ApplyTaskItem.job_id.in_(job_ids),
        )
        .group_by(ApplyTaskItem.job_id)
        .all()
    )
    for job_id, finished_at in item_rows:
        if job_id is not None:
            states[int(job_id)] = finished_at
    track_rows = (
        db.query(ApplicationTrack.job_id)
        .filter(trash.live_only(ApplicationTrack), ApplicationTrack.job_id.in_(job_ids))
        .all()
    )
    for (job_id,) in track_rows:
        if job_id is not None:
            states.setdefault(int(job_id), None)
    return states


def queued_job_ids(db: Session, job_ids: list[int]) -> set[int]:
    """这些岗位里哪些在投递队列里待投递（28B 的在队列判据）。"""
    if not job_ids:
        return set()
    # 队列条目没有软删除（移出即物理删除），所以这里不加 live_only。
    rows = (
        db.query(ApplyQueueItem.job_id)
        .filter(
            ApplyQueueItem.status == QUEUE_STATUS_PENDING,
            ApplyQueueItem.job_id.in_(job_ids),
        )
        .all()
    )
    return {int(job_id) for (job_id,) in rows if job_id is not None}


def _match_score(db: Session, job: Job, cache: dict) -> int | None:
    """28A「按匹配度」排序用的参考分（派生值，来自 14B 同一条计算）。"""
    from ..apply.signals import latest_match

    try:
        return reference_score(db, job, latest_match(db, job.id), cache=cache)
    except Exception:  # noqa: BLE001 - 参考分只用于排序，算不出来就当没有
        return None


def _match_sort_key(row: tuple[int | None, Job]) -> tuple:
    score, job = row
    favorited = job.favorited_at.timestamp() if job.favorited_at else 0.0
    return (score is None, -(score or 0), -favorited, -job.id)


def list_favorite_jobs(
    db: Session,
    *,
    keyword: str = "",
    status: str = "",
    applied: bool | None = None,
    sort: str = "favorited_desc",
    order: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Job], int, dict[int, datetime | None], set[int]]:
    """收藏夹列表：筛选/排序/分页 + 生命周期状态。

        返回 (jobs, total, applied_map, queued_ids)；生命周期状态随页内 id 批量查询
        （一次两条 SQL，不由前端逐行发请求）。

        排序语义：
    - favorited_desc：按收藏时间倒序，NULL（旧数据没回填成功）沉底；
    - posted_desc：复用岗位列表的发布时间排序（同一份实现，不复制）；
    - match_desc：参考分倒序。参考分是派生值、不落库，只能在应用层排序，因此这一种
      排序会先取筛选后的全部收藏（上限 MAX_FAVORITE_JOBS）再分页；其余排序在 SQL 里完成。
      收藏夹是用户手工攒的（几十到几百条），这个取舍值得。

        已投/未投在分页之前过滤，total 反映筛选后的集合。
    """
    query = _filtered_favorite_query(db, keyword=keyword, status=status)
    if applied is not None:
        # 已投判据跨投递记录 + 进度表，无法用一条 SQL 既同源又去重；先取候选 id
        # （收藏夹规模有限）再在 Python 里筛选，保证与徽标同一份口径。
        candidate_rows = (
            query.order_by(Job.favorited_at.desc(), Job.id.desc())
            .limit(MAX_FAVORITE_JOBS)
            .with_entities(Job.id)
            .all()
        )
        candidate_ids = [int(row[0]) for row in candidate_rows]
        states = applied_states(db, candidate_ids)
        matched = [job_id for job_id in candidate_ids if (job_id in states) == bool(applied)]
        total = len(matched)
        page_ids = matched[(page - 1) * page_size : page * page_size]
        jobs_by_id = (
            {job.id: job for job in query.filter(Job.id.in_(page_ids)).all()} if page_ids else {}
        )
        jobs = [jobs_by_id[job_id] for job_id in page_ids if job_id in jobs_by_id]
        queued = queued_job_ids(db, [job.id for job in jobs])
        return jobs, total, states, queued

    if sort == "match_desc":
        candidates = (
            query.order_by(Job.favorited_at.desc(), Job.id.desc()).limit(MAX_FAVORITE_JOBS).all()
        )
        cache: dict = {}
        scored = [(_match_score(db, job, cache), job) for job in candidates]
        scored.sort(key=_match_sort_key)
        total = len(scored)
        jobs = [job for _score, job in scored[(page - 1) * page_size : page * page_size]]
        queued = queued_job_ids(db, [job.id for job in jobs])
        applied_map = applied_states(db, [job.id for job in jobs])
        return jobs, total, applied_map, queued

    from ..job.job_sorting import job_order_by

    if sort == "favorited_desc":
        if order == "asc":
            order_by = (Job.favorited_at.asc(), Job.id.asc())
        else:
            order_by = (Job.favorited_at.desc(), Job.id.desc())
    else:
        order_by = job_order_by("posted_desc", order)  # type: ignore[arg-type]
    total = query.count()
    jobs = query.order_by(*order_by).offset((page - 1) * page_size).limit(page_size).all()
    applied_map = applied_states(db, [job.id for job in jobs])
    queued = queued_job_ids(db, [job.id for job in jobs])
    return jobs, total, applied_map, queued


def lifecycle_for(db: Session, job_ids: list[int]) -> dict[int, tuple[bool, bool]]:
    """一次性返回若干岗位的 (已投递, 在队列) 状态（批量端点用）。"""
    states = applied_states(db, job_ids)
    queued = queued_job_ids(db, job_ids)
    return {job_id: (job_id in states, job_id in queued) for job_id in job_ids}


# ===== 导出（28F）=====

CSV_HEADERS = ("岗位名", "公司", "地点", "薪资", "状态", "收藏时间", "备注", "链接")


def _favorite_time_text(job: Job) -> str:
    """收藏时间的人类可读文本；回填的近似值必须写「时间不详」。"""
    if job.favorited_at is None:
        return "时间不详"
    stamp = job.favorited_at.strftime("%Y-%m-%d %H:%M")
    return f"{stamp}（时间不详）" if job.favorited_at_estimated else stamp


def _row_cells(job: Job) -> tuple[str, ...]:
    return (
        job.title,
        job.company,
        job.location,
        job.salary,
        job.status,
        _favorite_time_text(job),
        (job.note or "").replace("\r\n", "\n"),
        job.source_url,
    )


def render_favorites_csv(jobs: list[Job]) -> str:
    """收藏夹 CSV 文本：UTF-8 BOM + CRLF（Excel 中文不乱码的判据）。"""
    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_HEADERS)
    for job in jobs:
        writer.writerow(_row_cells(job))
    return buffer.getvalue()


def render_favorites_markdown(jobs: list[Job]) -> str:
    """收藏夹 Markdown：一张表 + 每条备注，适合直接贴进笔记。"""
    out = [f"# 收藏夹（{len(jobs)} 条）", ""]
    out.append("| " + " | ".join(CSV_HEADERS) + " |")
    out.append("| " + " | ".join("---" for _ in CSV_HEADERS) + " |")
    for job in jobs:
        cells = [cell.replace("|", "\\|").replace("\n", " ") for cell in _row_cells(job)]
        out.append("| " + " | ".join(cells) + " |")
    out.append("")
    detailed = [job for job in jobs if (job.note or "").strip()]
    if detailed:
        out.append("## 备注")
        out.append("")
        for job in detailed:
            out.append(f"### {job.title}（{job.company or '未填写公司'}）")
            out.append("")
            out.append(job.note.strip())
            out.append("")
    return "\n".join(out)


__all__ = [
    "CSV_HEADERS",
    "FAVORITE_SORTS",
    "MAX_FAVORITE_JOBS",
    "applied_states",
    "lifecycle_for",
    "list_favorite_jobs",
    "queued_job_ids",
    "render_favorites_csv",
    "render_favorites_markdown",
]

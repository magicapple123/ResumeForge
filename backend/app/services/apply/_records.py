"""投递回写与记录（按批次分组）。

**投递记录可被用户删除**（软删，进退回收站），所以这里每一处查询都必须过
``trash.live_only(ApplyTaskItem)``——漏一处不会报错，只会让已删的记录继续出现在列表或计数里。
"""

from __future__ import annotations

from typing import get_args

from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session

from ...models.apply import (
    FAILURE_CATEGORY_LABELS,
    QUEUE_STATUS_DONE,
    TASK_KIND_APPLY,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
)
from ...models.job import JOB_STATUS_APPLIED, JOB_STATUS_OPEN, Job
from ...models.profile import utcnow
from ...schemas.apply import ApplyRecordBatchOut, ApplyRecordOut, TaskItemStatus, TaskStatus
from .. import trash

_TASK_ITEM_STATUS_VALUES: tuple[TaskItemStatus, ...] = get_args(TaskItemStatus)
_TASK_STATUS_VALUES: tuple[TaskStatus, ...] = get_args(TaskStatus)


def _as_task_item_status(value: str) -> TaskItemStatus:
    """模型层记录状态是 ``str``，出口处收窄为 schema 的 ``Literal``。

    取值由任务执行链路用常量写入，正常不会走到兜底；库里出现未知值时大声失败
    （与 pydantic Literal 字段的校验语义一致），不悄悄把非法状态发给前端。
    """
    if value not in _TASK_ITEM_STATUS_VALUES:
        raise ValueError(f"未知的投递记录状态：{value!r}")
    return value


def _as_task_status(value: str) -> TaskStatus:
    """批次状态同 :func:`_as_task_item_status` 的收窄口径。"""
    if value not in _TASK_STATUS_VALUES:
        raise ValueError(f"未知的投递批次状态：{value!r}")
    return value


def write_back_job_status(db: Session, job_id: int | None) -> None:
    """投递成功 → 岗位状态置为「已投递」；只在岗位仍是「开放中」时回写，不覆盖用户手改。"""
    if job_id is None:
        return
    job = db.get(Job, job_id)
    if job is not None and job.status in (JOB_STATUS_OPEN, ""):
        job.status = JOB_STATUS_APPLIED
        job.updated_at = utcnow()


def mark_queue_done(db: Session, job_id: int | None) -> None:
    """投递成功后把队列条目标为已完成。"""
    if job_id is None:
        return
    item = db.query(ApplyQueueItem).filter(ApplyQueueItem.job_id == job_id).one_or_none()
    if item is not None:
        item.status = QUEUE_STATUS_DONE
        item.updated_at = utcnow()


def daily_success_count(db: Session) -> int:
    """今天（UTC 自然日）已成功的投递数——每日上限**只计成功投递**。

    **必须排除用户已删的记录**：每日上限是"你还能投几个"的依据，而用户删掉一条成功记录
    就是要它不算数（"删了就真没了"）。漏了这个过滤，删记录会**悄悄放宽**每日上限——
    数字看起来正常，行为却与用户的理解相反。
    """
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(func.count(ApplyTaskItem.id))
        .filter(
            ApplyTaskItem.status == "success",
            ApplyTaskItem.finished_at >= start,
            trash.live_only(ApplyTaskItem),
        )
        .scalar()
        or 0
    )


def _record_out(item: ApplyTaskItem) -> ApplyRecordOut:
    return ApplyRecordOut(
        id=item.id,
        task_id=item.task_id,
        job_id=item.job_id,
        job_title=item.job_title,
        company=item.company,
        resume_title=item.resume_title,
        greeting=item.greeting,
        status=_as_task_item_status(item.status),
        failure_category=item.failure_category,
        failure_label=FAILURE_CATEGORY_LABELS.get(item.failure_category, ""),
        failure_detail=item.failure_detail,
        attempt=item.attempt,
        created_at=item.created_at,
        finished_at=item.finished_at,
    )


def _matched_items_query(
    db: Session, *, keyword: str = "", result: str = ""
) -> Query[ApplyTaskItem]:
    """命中筛选的投递记录查询（``list_records`` 与分组明细共用，保证过滤语义同源）。"""
    query = (
        db.query(ApplyTaskItem)
        .join(ApplyTask, ApplyTaskItem.task_id == ApplyTask.id)
        .filter(ApplyTask.kind == TASK_KIND_APPLY, trash.live_only(ApplyTaskItem))
    )
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(ApplyTaskItem.job_title.like(like), ApplyTaskItem.company.like(like))
        )
    if result:
        query = query.filter(ApplyTaskItem.status == result)
    return query


def list_records(
    db: Session,
    *,
    keyword: str = "",
    result: str = "",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ApplyRecordOut], int]:
    """分页列出投递记录（只含投递批次，按关键词/结果筛选），返回 (记录, 总数)。"""
    query = _matched_items_query(db, keyword=keyword, result=result)
    total = query.count()
    rows = (
        query.order_by(ApplyTaskItem.created_at.desc(), ApplyTaskItem.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_record_out(row) for row in rows], total


def list_record_batches(
    db: Session,
    *,
    keyword: str = "",
    result: str = "",
    page: int = 1,
    page_size: int = 5,
    include_items: bool = True,
) -> tuple[list[ApplyRecordBatchOut], int]:
    """投递记录按**批次**分组：一页返回若干个批次，每个批次带自己的全部（匹配的）记录。

    为什么按批次而不是给扁平记录加 group-by：一次「开始投递」建一个批次（``ApplyTask``），
    用户一次性投 N 个岗位时这 N 条记录天然同属一个批次——分组键已经存在，界面要做的只是
    "折叠/展开"。筛选（关键词 / 结果）作用在**记录**上：只有命中的记录出现在组内，没有
    命中记录的批次整体不出现；分页按**批次**数（一页几个组，而不是一页几条）。

    ``include_items=False``（B4 按需加载）：跳过明细查询，``items=[]``，只带
    ``matched_count``（命中当前筛选的记录数）。5 批 × 每批可达 500 条时，一页不再
    搬 2500 行明细；明细由 ``list_batch_items`` 在批次展开时单独分页拉取。
    """
    item_query = _matched_items_query(db, keyword=keyword, result=result)

    matched_items = item_query.subquery()
    # 只统计"至少有一条命中记录"的批次，分页与总数都以它为准。
    batch_ids = db.query(matched_items.c.task_id).distinct().subquery()
    total = db.query(func.count()).select_from(batch_ids).scalar() or 0
    batch_rows = (
        db.query(ApplyTask)
        .join(batch_ids, ApplyTask.id == batch_ids.c.task_id)
        .order_by(ApplyTask.created_at.desc(), ApplyTask.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    if not batch_rows:
        return [], total
    batch_id_list = [task.id for task in batch_rows]
    # matched_count：在 matched_items 子查询上按批次 group-by 计数（两种模式都填，
    # 供组头「N 条记录」展示；include_items=true 时与 len(items) 一致）。
    count_rows = (
        db.query(matched_items.c.task_id, func.count())
        .filter(matched_items.c.task_id.in_(batch_id_list))
        .group_by(matched_items.c.task_id)
        .all()
    )
    counts_by_task = {task_id: count for task_id, count in count_rows}
    items_by_task: dict[int, list[ApplyRecordOut]] = {task_id: [] for task_id in batch_id_list}
    if include_items:
        item_rows = (
            db.query(ApplyTaskItem)
            .join(
                matched_items,
                (ApplyTaskItem.id == matched_items.c.id)
                & (ApplyTaskItem.task_id == matched_items.c.task_id),
            )
            # 这条过滤在 ``matched_items`` 里已经有了，这里再加一次是**故意的**：
            # 本查询直接查 ``ApplyTaskItem``，将来有人改 `item_query` 时不会想到这里。
            .filter(ApplyTaskItem.task_id.in_(batch_id_list), trash.live_only(ApplyTaskItem))
            .order_by(ApplyTaskItem.sort_order, ApplyTaskItem.id)
            .all()
        )
        for item in item_rows:
            items_by_task.setdefault(item.task_id, []).append(_record_out(item))
    batches = [
        ApplyRecordBatchOut(
            id=task.id,
            status=_as_task_status(task.status),
            total=task.total,
            processed=task.processed,
            succeeded=task.succeeded,
            failed=task.failed,
            skipped=task.skipped,
            message=task.message or "",
            created_at=task.created_at,
            finished_at=task.finished_at,
            matched_count=counts_by_task.get(task.id, 0),
            items=items_by_task.get(task.id, []),
        )
        for task in batch_rows
    ]
    return batches, total


def list_batch_items(
    db: Session,
    task_id: int,
    *,
    keyword: str = "",
    result: str = "",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ApplyRecordOut], int]:
    """分页返回**一个批次**内命中筛选的投递记录，返回 (记录, 总数)。

    过滤语义与 ``list_record_batches`` 完全同源（同一个 ``_matched_items_query``）：
    界面展开批次时按当前关键词/结果拉取明细，组内的记录与组头的 matched_count 对得上。
    """
    query = _matched_items_query(db, keyword=keyword, result=result).filter(
        ApplyTaskItem.task_id == task_id
    )
    total = query.count()
    rows = (
        query.order_by(ApplyTaskItem.sort_order, ApplyTaskItem.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_record_out(row) for row in rows], total


# ===== 删除记录（软删，进退回收站）=====


def delete_record(db: Session, item_id: int) -> bool:
    """删掉单条投递记录。不存在或已删返回 False（不抛，由路由决定怎么报）。"""
    item = trash.get_live(db, ApplyTaskItem, item_id)
    if item is None:
        return False
    trash.soft_delete(db, "apply_record", item)
    db.commit()
    return True


def delete_record_batch(db: Session, task_id: int) -> bool:
    """删掉一整批投递记录，返回是否删到了东西。

    **只软删记录，不动 ``ApplyTask`` 批次本身**：批次是列表的分组键，删掉它整组会从列表消失、
    统计也会跳变；用户想清掉的是"这一批填进去的记录"。批次因此可能变成空组，由界面收起。

    ``synchronize_session=False``：这些行已经取到手，不需要 ORM 再回写会话里的对象状态
    （回写反而可能在批量软删时逐个 UPDATE，慢且无意义）。
    """
    query = db.query(ApplyTaskItem).filter(
        ApplyTaskItem.task_id == task_id, trash.live_only(ApplyTaskItem)
    )
    affected = query.update({ApplyTaskItem.deleted_at: utcnow()}, synchronize_session=False)
    db.commit()
    return bool(affected)

"""求职进度的服务层：写入编排与全量门面（增删改查、漏斗统计、导出、投递台接合点）。

模块分工（PR-18 豁免拆分批，纯搬迁无行为变化）：

- 写路径在本文件：``create_track`` / ``update_track``（单事务）/ ``delete_track`` /
  ``record_applied`` / ``_freeze_linked_resume``——测试在 ``tracker`` 命名空间上
  monkeypatch ``freeze_delivery`` / ``record_status_change``，落点必须留在本模块；
- 查询/过滤/统计口径在 ``tracker_query.py``（list/page/summarize/iter/count）；
- CSV/JSON 导出在 ``tracker_csv.py``；
- 合并（识别通知 → 计划 → 预览/确认）与 track 字段写入的单一实现在
  ``tracker_merge.py``：``plan_merges`` 算出"每条会新增还是更新、为什么"，预览接口
  原样返回，确认接口执行同一份计划（"预览=执行"契约）。

本文件是对外门面：以下 re-export 保证既有消费方（``api/tracker.py``、
``assistant_tools/tracker_tools.py``）与测试的 import 路径与 ``__all__`` 契约不变。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from ..models.resume import ResumeRecord
from ..models.tracker import SOURCE_APPLY, SOURCE_MANUAL, STATUS_APPLIED, ApplicationTrack
from ..schemas.tracker import (
    TrackCreate,
    TrackOut,
    TrackRecordIn,
    TrackUpdate,
)
from . import trash
from .resume.resume_delivery import freeze_delivery, list_track_deliveries
from .track_events import record_status_change, write_source
from .tracker_csv import export_rows, iter_csv_chunks, to_csv, to_json
from .tracker_merge import (
    _apply_payload,
    _find_by_key,
    apply_merges,
    plan_merges,
    preview_merges,
)
from .tracker_query import (
    MAX_LIST_LIMIT,
    count_tracks,
    iter_tracks,
    list_tracks,
    list_tracks_page,
    summarize,
    track_or_none,
)

__all__ = [
    "MAX_LIST_LIMIT",
    "apply_merges",
    "count_tracks",
    "create_track",
    "delete_track",
    "export_rows",
    "iter_csv_chunks",
    "iter_tracks",
    "list_track_deliveries",
    "list_tracks",
    "list_tracks_page",
    "plan_merges",
    "preview_merges",
    "record_applied",
    "summarize",
    "to_csv",
    "to_json",
    "track_or_none",
    "track_out",
    "update_track",
]


# ===== 写入 =====


def _freeze_linked_resume(db: Session, record: ApplicationTrack, *, source: str) -> None:
    """进度显式关联到一份简历时冻结投递快照（RF-17）。

    只在"这份快照还不存在"的意义上不做去重：表单每次把 ``resume_id`` **从无到有**地
    关联上来才算一次投递血缘，同一份记录反复保存（改备注、推进状态）不产生新快照。
    简历已删除/不存在时静默跳过——进度记录本身照常保存。

    目的地快照（PR-09）：公司/岗位取**进度记录本身**（用户填写的实际投递目标），
    不从原简历反推——通用简历（无公司）投给 A 公司时，快照目的地就是 A 公司。
    """
    if record.resume_id is None:
        return
    resume = db.get(ResumeRecord, record.resume_id)
    if resume is None:
        return
    # 标题快照与外键一起落：简历被删后仍能回答"当时投的是哪一版"。
    record.resume_title = resume.title or ""
    freeze_delivery(
        db,
        record=resume,
        track_id=record.id,
        source=source,
        company=record.company or "",
        job_title=record.title or "",
    )


def create_track(
    db: Session, payload: TrackCreate, *, source: str = SOURCE_MANUAL
) -> ApplicationTrack:
    """新增一条求职进度记录（PR-10 原子事务）。

    record + 首个状态事件 + 投递快照在**同一个事务**里：先 flush 拿到 ``record.id``
    （事件与快照的外键都要用它），最后一个 commit 一次性发布。任一步失败整体
    rollback——数据库里不会留下"有记录没事件"或"有记录没快照"的半成品，用户重试
    也不会撞唯一约束。
    """
    record = ApplicationTrack(source=source)
    _apply_payload(record, payload)
    db.add(record)
    try:
        # flush 只写事务缓冲、不提交：record.id 就绪，后面任何一步炸了都能整体回滚。
        db.flush()
        # 首个状态事件（RF-18）：新建本身就是一次状态变化（"" → 初始状态）。
        # 手动添加由用户亲手写入（confirmed），其他来源（助手等）走系统口径。
        record_status_change(
            db,
            record,
            from_status="",
            to_status=payload.status,
            status_date=payload.status_date,
            source=write_source(manual=source == SOURCE_MANUAL),
            user_confirmed=True,
        )
        if payload.resume_id is not None:
            _freeze_linked_resume(db, record, source="track")
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(record)
    return record


def update_track(db: Session, record: ApplicationTrack, payload: TrackUpdate) -> ApplicationTrack:
    """更新一条求职进度记录（PR-10 对称项：单事务）。

    字段保存 + 状态事件 + 投递快照在**同一个事务**里发布：旧实现三段各自
    commit，中途失败会留下"已更新字段但缺事件/快照"的半成品。现在先 flush
    把字段改动压进事务缓冲，事件与快照任一步失败整体 rollback；最后一个
    commit 一次性发布。对外 API 与返回值契约不变。
    """
    previous_resume_id = record.resume_id
    previous_status = record.status
    _apply_payload(record, payload)
    try:
        # flush 只写事务缓冲、不提交（与 create_track 同一模式）。
        db.flush()
        if previous_status != record.status:
            # 状态被用户亲手改了（含改成拒信）：追加一条事件。事件不参与合并取舍，
            # 所以拒信也会留痕——之前的阶段不会因为终态被抹掉。
            record_status_change(
                db,
                record,
                from_status=previous_status,
                to_status=record.status,
                status_date=payload.status_date,
                source=write_source(manual=True),
                user_confirmed=True,
            )
        if payload.resume_id is not None and payload.resume_id != previous_resume_id:
            _freeze_linked_resume(db, record, source="track")
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(record)
    return record


def delete_track(db: Session, track_id: int) -> bool:
    """移入回收站（软删除）。

    **不再真删**：投递记录是用户一条条维护起来的（进度、下次动作、备注），误删的代价远大于
    多留一行。彻底删除在「回收站」里单独提供，且必须二次确认。
    """
    record = db.get(ApplicationTrack, track_id)
    if record is None or trash.is_deleted(record):
        return False
    trash.soft_delete(db, "track", record)
    db.commit()
    return True


# ===== 与投递台的接合点 =====


def record_applied(
    db: Session,
    *,
    company: str,
    title: str,
    applied_on: str = "",
    job_id: int | None = None,
    resume_id: int | None = None,
    resume_title: str = "",
    attempt_key: str | None = None,
) -> None:
    """投递成功后落一条「已投递」。

    刻意**不**覆盖已有记录的更靠后状态：用户可能已经手动把这家推到「面试」了，
    而投递台的批量任务又跑了一次同一个岗位——那时把状态打回「已投递」是错的。

    ``resume_id`` / ``resume_title``（RF-17）：投递条目上记录了这次用的是哪份简历
    （``ApplyTaskItem.resume_id``）。新建进度记录时落关联与标题快照，并冻结一份
    ``source="apply"`` 的投递快照；已有记录仅在缺关联时补上（与 ``job_id`` 同一
    口径），**补上也冻结一份快照**（PR-09：补投同样是真实发生的投递动作，
    不能因为记录先存在就丢证据）。

    ``attempt_key``（PR-09 幂等键）：这次投递动作的天然 ID（如
    ``apply_task_item:{id}``）。同键重放不重复冻结快照；不同条目对同一家公司的
    真实第二次投递拿到不同的键——**不会被 company+title 合并吞掉**。

    目的地快照（PR-09）：公司/岗位取实参（实际投递目标），不从原简历反推。
    """
    if not company.strip() or not title.strip():
        # 快照字段为空时无从合并，宁可不记也不要造一条"(空) · (空)"。
        return
    payload = TrackRecordIn(
        company=company,
        title=title,
        status=STATUS_APPLIED,
        applied_at=applied_on or date.today().isoformat(),
    )
    existing = _find_by_key(db, payload)
    if existing is None:
        record = ApplicationTrack(source=SOURCE_APPLY, resume_title=resume_title)
        _apply_payload(
            record, TrackCreate(**payload.model_dump(), job_id=job_id, resume_id=resume_id)
        )
        db.add(record)
        db.flush()
        # 投递台自动写入也留痕（RF-18）：confirmed=False——这是程序自动记的，
        # 用户没有逐条确认过。乱序通知不会把这条记录拉回去（resolve_status 管合并），
        # 但"曾被记为已投递"是真实发生过的动作。
        record_status_change(
            db,
            record,
            from_status="",
            to_status=STATUS_APPLIED,
            status_date=payload.applied_at,
            source=write_source(manual=False),
            user_confirmed=False,
        )
        if resume_id is not None:
            resume = db.get(ResumeRecord, resume_id)
            if resume is not None:
                freeze_delivery(
                    db,
                    record=resume,
                    track_id=record.id,
                    source="apply",
                    company=company,
                    job_title=title,
                    idempotency_key=attempt_key,
                )
        return
    if not existing.applied_at:
        existing.applied_at = payload.applied_at
    if existing.job_id is None and job_id is not None:
        existing.job_id = job_id
    linked_now = False
    if existing.resume_id is None and resume_id is not None:
        existing.resume_id = resume_id
        existing.resume_title = resume_title or existing.resume_title
        linked_now = True
    # 状态交给 resolve_status：已经在面试的不会被这一次投递拉回「已投递」。
    # 快照条件（PR-09）：补投（关联从无到有）是真实动作；带了 attempt_key 的调用
    # （投递台条目）每条都是一次真实投递——同一键重放由 freeze_delivery 去重，
    # 不同键的真实第二次投递不被 company+title 合并吞掉。都没带（旧的重复通知
    # 路径）保持旧行为：不重复冻结。
    if resume_id is not None and (linked_now or attempt_key is not None):
        resume = db.get(ResumeRecord, resume_id)
        if resume is not None:
            freeze_delivery(
                db,
                record=resume,
                track_id=existing.id,
                source="apply",
                company=company,
                job_title=title,
                idempotency_key=attempt_key,
            )


def track_out(record: ApplicationTrack) -> TrackOut:
    return TrackOut.model_validate(record)

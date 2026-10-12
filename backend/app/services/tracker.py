"""求职进度的服务层：增删改查、漏斗统计、导出与投递台接合点。

合并（识别通知 → 计划 → 预览/确认）与 track 字段写入的单一实现在
``tracker_merge.py``：``plan_merges`` 算出"每条会新增还是更新、为什么"，预览接口
原样返回，确认接口执行同一份计划（"预览=执行"契约）。本文件经门面 re-export。
"""

from __future__ import annotations

import csv
import io
import json
import logging
from collections.abc import Iterator
from datetime import date
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Query, Session

from ..models.resume import ResumeRecord
from ..models.tracker import (
    SOURCE_APPLY,
    SOURCE_MANUAL,
    STATUS_APPLIED,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUSES,
    ApplicationTrack,
    is_active,
    status_label,
)
from ..schemas.tracker import (
    TrackCreate,
    TrackOut,
    TrackRecordIn,
    TrackUpdate,
)
from . import trash
from .resume.resume_delivery import freeze_delivery
from .track_events import record_status_change, write_source
from .tracker_merge import (
    _apply_payload,
    _find_by_key,
    apply_merges,
    plan_merges,
    preview_merges,
)

logger = logging.getLogger(__name__)

MAX_LIST_LIMIT = 500


# ===== 读取 =====


def track_or_none(db: Session, track_id: int) -> ApplicationTrack | None:
    """取一条投递记录；**已在回收站里的当作不存在**（见 ``claim_or_none`` 的说明）。"""
    record = db.get(ApplicationTrack, track_id)
    if record is None or trash.is_deleted(record):
        return None
    return record


def _filtered_query(db: Session, *, status: str = "", keyword: str = "") -> Query[ApplicationTrack]:
    """list_tracks 与 summarize **共用的过滤口径**：软删过滤 + 状态 + 关键词。

    抽出来是为了让统计永远跟列表同一口径——两处各写一遍过滤条件，迟早会改漏一边。
    """
    query = db.query(ApplicationTrack).filter(trash.live_only(ApplicationTrack))
    if status:
        query = query.filter(ApplicationTrack.status == status)
    target = (keyword or "").strip()
    if target:
        like = f"%{target}%"
        query = query.filter(
            ApplicationTrack.company.like(like)
            | ApplicationTrack.title.like(like)
            | ApplicationTrack.note.like(like)
            | ApplicationTrack.next_action.like(like)
        )
    return query


def _stage_expression() -> Any:
    """``_STATUS_ORDER`` 的 SQL 形态：阶段序作为第一排序键。"""
    return case(_STATUS_ORDER, value=ApplicationTrack.status, else_=9)


def _stage_ordered(query: Query[ApplicationTrack]) -> Query[ApplicationTrack]:
    """list_tracks 与 list_tracks_page **共用的排序**：阶段序 → updated_at → id。

    抽出来是为了让分页端点与旧列表的次序永远一致——两处各写一遍排序，迟早会改漏一边。
    """
    return query.order_by(
        _stage_expression(),
        # SQLite 的 DESC 把 NULL 排在最后，与旧实现 None→datetime.min→排在末尾一致；
        # updated_at 同值时按 id 新的在前，也与旧实现的 -id 次序键一致。
        ApplicationTrack.updated_at.desc(),
        ApplicationTrack.id.desc(),
    )


def list_tracks(
    db: Session, *, status: str = "", keyword: str = "", limit: int | None = MAX_LIST_LIMIT
) -> list[ApplicationTrack]:
    """按状态 / 关键词检索。

    默认排序刻意是"进行中的排在前面、越靠后的阶段越靠前"：用户打开这一页最想先看到的是
    还在推进的那几家，而不是三个月前就结束了的。排序已**下推 SQL**（2026-10-05 性能审查：
    旧实现把全表拉回内存再用 Python 排序，是求职看板的主读路径）。

    ``limit`` 默认取 :data:`MAX_LIST_LIMIT` 给列表响应兜个上限；``limit=None`` 表示
    不限量——**导出与助手工具必须传 None**：导出截断等于丢用户数据，助手工具自己
    有一层 limit 语义（见 tracker_tools），两层各管各的。
    """
    query = _stage_ordered(_filtered_query(db, status=status, keyword=keyword))
    if limit is not None:
        query = query.limit(limit)
    return query.all()


def list_tracks_page(
    db: Session,
    *,
    status: str = "",
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
    job_id: int | None = None,
) -> tuple[list[ApplicationTrack], int]:
    """分页列出求职进度（RF-08）：过滤与排序与 :func:`list_tracks` 完全一致。

    与旧列表的分工：旧端点给 MAX_LIST_LIMIT 兜底上限，本函数服务
    ``GET /api/tracker/page``——历史记录超过 500 条之后仍然全部可达。统计（漏斗）
    仍由旧端点随列表下发，本函数只负责行。

    ``job_id``（RF-11）：岗位详情深链过来的「该岗位的投递进度」过滤；None 表示
    不过滤（不传该参数的行为与从前完全一致）。
    """
    base = _filtered_query(db, status=status, keyword=keyword)
    if job_id is not None:
        base = base.filter(ApplicationTrack.job_id == job_id)
    total = base.count()
    rows = _stage_ordered(base).offset((page - 1) * page_size).limit(page_size).all()
    return rows, total


_STATUS_ORDER = {
    "interview": 0,
    "offer": 1,
    "assessment": 2,
    "screening": 3,
    "applied": 4,
    # 终态排最后：结束了的不该占着视线，但也不能藏起来（复盘要看）。
    "rejected": 5,
    "unknown": 6,
}


def summarize(db: Session, *, status: str = "", keyword: str = "") -> dict[str, Any]:
    """列表接口的统计部分：漏斗各阶段计数 + 几个一眼要看到的数字。

    从 **SQL 聚合**取数，过滤口径与列表共用（``_filtered_query``）：列表行数被
    :data:`MAX_LIST_LIMIT` 截断后，统计仍要反映筛选条件下的**全部**记录，而不是
    只数返回的那一页。状态计数沿用旧行为：目录之外的状态也会出现在 ``status_counts``。
    """
    base = _filtered_query(db, status=status, keyword=keyword)
    rows = (
        base.with_entities(ApplicationTrack.status, func.count(ApplicationTrack.id))
        .group_by(ApplicationTrack.status)
        .all()
    )
    counts: dict[str, int] = {status: 0 for status in STATUSES}
    for status_name, count in rows:
        counts[status_name] = counts.get(status_name, 0) + count
    # 「本月投递」按**用户本地的自然月**算：applied_at 是用户自己填的日期，
    # 拿 UTC 去比会让月初的头八个小时落在上个月里，和用户看到的日历对不上。
    # SQL 用 LIKE 前缀匹配（applied_at 形如 YYYY-MM-DD）；NULL 与空串不命中，
    # 与旧实现 ``(applied_at or "").startswith(...)`` 语义一致。
    month_prefix = date.today().strftime("%Y-%m")
    month_count = base.filter(ApplicationTrack.applied_at.like(f"{month_prefix}%")).count()
    return {
        "total": sum(counts.values()),
        "status_counts": counts,
        "active_count": sum(n for name, n in counts.items() if is_active(name)),
        "offer_count": counts.get(STATUS_OFFER, 0),
        "rejected_count": counts.get(STATUS_REJECTED, 0),
        "month_count": month_count,
    }


# ===== 写入 =====


def _freeze_linked_resume(db: Session, record: ApplicationTrack, *, source: str) -> None:
    """进度显式关联到一份简历时冻结投递快照（RF-17）。

    只在"这份快照还不存在"的意义上不做去重：表单每次把 ``resume_id`` **从无到有**地
    关联上来才算一次投递血缘，同一份记录反复保存（改备注、推进状态）不产生新快照。
    简历已删除/不存在时静默跳过——进度记录本身照常保存。
    """
    if record.resume_id is None:
        return
    resume = db.get(ResumeRecord, record.resume_id)
    if resume is None:
        return
    # 标题快照与外键一起落：简历被删后仍能回答"当时投的是哪一版"。
    record.resume_title = resume.title or ""
    freeze_delivery(db, record=resume, track_id=record.id, source=source)


def create_track(
    db: Session, payload: TrackCreate, *, source: str = SOURCE_MANUAL
) -> ApplicationTrack:
    """新增一条求职进度记录。"""
    record = ApplicationTrack(source=source)
    _apply_payload(record, payload)
    db.add(record)
    db.commit()
    db.refresh(record)
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
    db.commit()
    if payload.resume_id is not None:
        _freeze_linked_resume(db, record, source="track")
        db.commit()
        db.refresh(record)
    return record


def update_track(db: Session, record: ApplicationTrack, payload: TrackUpdate) -> ApplicationTrack:
    previous_resume_id = record.resume_id
    previous_status = record.status
    _apply_payload(record, payload)
    db.commit()
    db.refresh(record)
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
        db.commit()
    if payload.resume_id is not None and payload.resume_id != previous_resume_id:
        _freeze_linked_resume(db, record, source="track")
        db.commit()
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
) -> None:
    """投递成功后落一条「已投递」。

    刻意**不**覆盖已有记录的更靠后状态：用户可能已经手动把这家推到「面试」了，
    而投递台的批量任务又跑了一次同一个岗位——那时把状态打回「已投递」是错的。

    ``resume_id`` / ``resume_title``（RF-17）：投递条目上记录了这次用的是哪份简历
    （``ApplyTaskItem.resume_id``）。新建进度记录时落关联与标题快照，并冻结一份
    ``source="apply"`` 的投递快照；已有记录仅在缺关联时补上（与 ``job_id`` 同一
    口径），不重复冻结。
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
                freeze_delivery(db, record=resume, track_id=record.id, source="apply")
        return
    if not existing.applied_at:
        existing.applied_at = payload.applied_at
    if existing.job_id is None and job_id is not None:
        existing.job_id = job_id
    if existing.resume_id is None and resume_id is not None:
        existing.resume_id = resume_id
        existing.resume_title = resume_title or existing.resume_title
    # 状态交给 resolve_status：已经在面试的不会被这一次投递拉回「已投递」。


# ===== 导出 =====


_CSV_HEADER = (
    "公司",
    "岗位",
    "状态",
    "阶段说明",
    "投递日期",
    "状态日期",
    "下一步",
    "下一步日期",
    "备注",
)


def export_row(item: ApplicationTrack) -> list[str]:
    """一条进度记录的 CSV 导出行（备注换行压成空格）。"""
    return [
        item.company,
        item.title,
        status_label(item.status),
        item.stage_note,
        item.applied_at,
        item.status_date,
        item.next_action,
        item.next_action_date,
        item.note.replace("\n", " "),
    ]


def export_rows(records: list[ApplicationTrack]) -> list[list[str]]:
    """把进度记录转成 CSV 导出的行（备注换行压成空格）。"""
    return [export_row(item) for item in records]


def iter_csv_chunks(records) -> Iterator[str]:
    """逐条产出 CSV 导出文本（含 BOM 与表头行），与 :func:`to_csv` 字节级一致。

    导出走 ``StreamingResponse``（2026-10-12 万级数据优化）：不再 fetchall 全量行
    拼一个几十 MB 的字符串，而是每写一行就 yield 一段。``records`` 是任意可迭代
    （通常是 :func:`iter_tracks` 的惰性行迭代器），BOM 与表头先行，行序即记录序。
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    yield "﻿"
    writer.writerow(_CSV_HEADER)
    yield buffer.getvalue()
    for item in records:
        buffer.seek(0)
        buffer.truncate()
        writer.writerow(export_row(item))
        yield buffer.getvalue()


def iter_tracks(db: Session, *, status: str = "", keyword: str = "") -> Iterator[ApplicationTrack]:
    """按状态 / 关键词检索的**惰性**版本：排序与 :func:`list_tracks` 完全一致。

    导出（``limit=None`` 全量）专用：``yield_per`` 让 DBAPI 按批取行，端点不再
    fetchall 把万级记录一次性拖进内存。非导出路径（列表、统计）不经过这里。
    """
    query = _stage_ordered(_filtered_query(db, status=status, keyword=keyword))
    return iter(query.yield_per(200))


def count_tracks(db: Session, *, status: str = "", keyword: str = "") -> int:
    """当前筛选下的记录总数（排序无关）：导出文件名与流式读取各查一次，口径一致。"""
    return int(_filtered_query(db, status=status, keyword=keyword).count())


def to_csv(records: list[ApplicationTrack]) -> str:
    """导出 CSV（一次性全量版本；流式端点走 :func:`iter_csv_chunks`）。

    ``\\ufeff`` 是 BOM：Excel 打开不带 BOM 的 UTF-8 CSV 会把中文显示成乱码，
    而这份文件最常见的用途恰恰是用 Excel 打开看看。
    """
    return "".join(iter_csv_chunks(records))


def to_json(records: list[ApplicationTrack]) -> str:
    """把求职进度记录序列化成 JSON 导出文本。"""
    payload = {
        "说明": "求职进度导出；状态取值与合并规则见 models/tracker.py",
        "总数": len(records),
        "记录": [
            {
                "公司": item.company,
                "岗位": item.title,
                "状态": status_label(item.status),
                "阶段说明": item.stage_note,
                "投递日期": item.applied_at,
                "状态日期": item.status_date,
                "下一步": item.next_action,
                "下一步日期": item.next_action_date,
                "备注": item.note,
                "来源": item.source,
            }
            for item in records
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def track_out(record: ApplicationTrack) -> TrackOut:
    return TrackOut.model_validate(record)


__all__ = [
    "MAX_LIST_LIMIT",
    "apply_merges",
    "count_tracks",
    "create_track",
    "delete_track",
    "export_rows",
    "iter_csv_chunks",
    "iter_tracks",
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

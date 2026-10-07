"""求职进度的服务层：合并、增删改查、漏斗统计与导出。

**合并是这里唯一有判断的地方，所以只写了一遍**：:func:`plan_merges` 算出"每条会新增
还是更新、为什么"，预览接口把它原样返回，确认接口再执行同一份计划。两处各写一遍判断
是这类功能最容易出的错——预览说"会更新"，点了确认却没更新（或反过来），用户再也不会
相信那个预览。

状态取舍规则见 ``models/tracker.py`` 的 :func:`resolve_status`：只能前进，拒信除外。
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import date
from typing import Any

from sqlalchemy import case, func, tuple_
from sqlalchemy.orm import Query, Session

from ..models.tracker import (
    MERGE_CREATED,
    MERGE_LABELS,
    MERGE_UNCHANGED,
    MERGE_UPDATED,
    SOURCE_APPLY,
    SOURCE_MANUAL,
    STATUS_APPLIED,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUSES,
    ApplicationTrack,
    is_active,
    normalize_key,
    resolve_status,
    status_label,
)
from ..schemas.tracker import (
    TrackApplyItemResult,
    TrackApplyOut,
    TrackCreate,
    TrackMergePreview,
    TrackOut,
    TrackRecordIn,
    TrackUpdate,
)
from . import trash

logger = logging.getLogger(__name__)

MAX_LIST_LIMIT = 500


# ===== 读取 =====


def track_or_none(db: Session, track_id: int) -> ApplicationTrack | None:
    """取一条投递记录；**已在回收站里的当作不存在**（见 ``claim_or_none`` 的说明）。"""
    record = db.get(ApplicationTrack, track_id)
    if record is None or trash.is_deleted(record):
        return None
    return record


def _filtered_query(
    db: Session, *, status: str = "", keyword: str = ""
) -> Query[ApplicationTrack]:
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
    query = _filtered_query(db, status=status, keyword=keyword).order_by(
        _stage_expression(),
        # SQLite 的 DESC 把 NULL 排在最后，与旧实现 None→datetime.min→排在末尾一致；
        # updated_at 同值时按 id 新的在前，也与旧实现的 -id 次序键一致。
        ApplicationTrack.updated_at.desc(),
        ApplicationTrack.id.desc(),
    )
    if limit is not None:
        query = query.limit(limit)
    return query.all()


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


def _apply_payload(record: ApplicationTrack, payload: TrackCreate | TrackUpdate) -> None:
    record.company = payload.company
    record.title = payload.title
    record.company_key = normalize_key(payload.company)
    record.title_key = normalize_key(payload.title)
    record.status = payload.status
    record.stage_note = payload.stage_note
    # **这里刻意没有"默认今天"**：手工录入不可能知道投递日期（可能投递当天录，也可能
    # 三周后照着一封通知补录），替他填今天会把记录钉在错误的月份上，在投递趋势里造出
    # 一个从未发生过的尖峰。投递台的 :func:`record_applied` 默认今天是对的——那条路径
    # 叫"刚投出去"，日期是确知的。两条路径的差异是正当的，别顺手"统一"掉。
    # 表单那一侧用一键「填今天」降低留空的摩擦（见 TrackFormModal）。
    record.applied_at = payload.applied_at
    record.status_date = payload.status_date
    record.next_action = payload.next_action
    record.next_action_date = payload.next_action_date
    record.note = payload.note
    record.evidence = payload.evidence
    record.job_id = payload.job_id
    record.resume_id = payload.resume_id


def create_track(db: Session, payload: TrackCreate, *, source: str = SOURCE_MANUAL) -> ApplicationTrack:
    """新增一条求职进度记录。"""
    record = ApplicationTrack(source=source)
    _apply_payload(record, payload)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_track(db: Session, record: ApplicationTrack, payload: TrackUpdate) -> ApplicationTrack:
    _apply_payload(record, payload)
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


# ===== 合并 =====


def _find_by_key(db: Session, record: TrackRecordIn) -> ApplicationTrack | None:
    return (
        db.query(ApplicationTrack)
        .filter(
            ApplicationTrack.company_key == normalize_key(record.company),
            ApplicationTrack.title_key == normalize_key(record.title),
        )
        .one_or_none()
    )


def _find_existing_by_keys(
    db: Session, records: list[TrackRecordIn]
) -> dict[tuple[str, str], ApplicationTrack]:
    """一批记录的合并目标，**一次 IN 查询**取回按键建字典。

    :func:`plan_merges` 旧实现对每条折叠后的记录单独点查——一次粘贴几十条通知就是
    几十次点查（2026-10-05 性能审查低-4：N+1）。``(company_key, title_key)`` 有唯一
    约束（``uq_application_track_company_title``），一个键至多命中一行，按键建字典
    与逐条 :func:`_find_by_key` 完全等价（含"软删记录也可被合并命中"的现状语义——
    两条路径都不带 live_only 过滤）。
    """
    keys = sorted({(normalize_key(r.company), normalize_key(r.title)) for r in records})
    if not keys:
        return {}
    rows = (
        db.query(ApplicationTrack)
        .filter(tuple_(ApplicationTrack.company_key, ApplicationTrack.title_key).in_(keys))
        .all()
    )
    return {(row.company_key, row.title_key): row for row in rows}


class _Plan:
    """一条记录的处理计划：预览与确认执行的是同一份。"""

    def __init__(
        self,
        record: TrackRecordIn,
        action: str,
        reason: str,
        existing: ApplicationTrack | None,
        current_status: str,
    ) -> None:
        self.record = record
        self.action = action
        self.reason = reason
        self.existing = existing
        self.current_status = current_status


def _fold_batch(records: list[TrackRecordIn]) -> list[tuple[TrackRecordIn, int]]:
    """按合并键折叠同一批里的多条通知，返回 ``(代表记录, 合并了几条)`` 并保序。

    一次粘贴一整段邮箱记录时，同一个岗位往往连着出现好几封（已投递 → 筛选 → 面试）。
    不折叠的话，后一条会相对前一条（还没落库的那条）判成"更新"，而库里的原记录并不
    存在——计划里的"更新"找不到可更新的对象。

    折叠时以**进展最靠后的那条**为代表，其余字段也取它的：这条记录表达的是"目前到哪
    一步了"，就该用走到最远的那封通知里的下一步和备注。
    """
    order: list[tuple[str, str]] = []
    folded: dict[tuple[str, str], TrackRecordIn] = {}
    counts: dict[tuple[str, str], int] = {}

    for record in records:
        key = (normalize_key(record.company), normalize_key(record.title))
        current = folded.get(key)
        if current is None:
            order.append(key)
            folded[key] = record
            counts[key] = 1
            continue
        counts[key] += 1
        if resolve_status(current.status, record.status) == record.status:
            folded[key] = record

    return [(folded[key], counts[key]) for key in order]


def plan_merges(db: Session, records: list[TrackRecordIn]) -> list[_Plan]:
    """算出每条记录会新增还是更新，并给出面向用户的原因。**不写库。**"""
    plans: list[_Plan] = []
    folded = _fold_batch(records)
    existing_by_key = _find_existing_by_keys(db, [record for record, _count in folded])

    for record, folded_count in folded:
        key = (normalize_key(record.company), normalize_key(record.title))
        existing = existing_by_key.get(key)
        merged_note = f"（本次识别有 {folded_count} 条通知指向这个岗位，已按进展合并）"

        if existing is None:
            plans.append(
                _Plan(
                    record,
                    MERGE_CREATED,
                    f"新增「{record.company} · {record.title}」"
                    + (merged_note if folded_count > 1 else ""),
                    None,
                    "",
                )
            )
            continue

        resolved = resolve_status(existing.status, record.status)
        if resolved == existing.status:
            reason = (
                f"已有记录处于「{status_label(existing.status)}」，这条通知更早，保留现有进度"
                if record.status != existing.status
                else f"状态本来就是「{status_label(existing.status)}」，没有新变化"
            )
            plans.append(_Plan(record, MERGE_UNCHANGED, reason, existing, existing.status))
            continue

        plans.append(
            _Plan(
                record,
                MERGE_UPDATED,
                f"「{status_label(existing.status)}」推进为「{status_label(resolved)}」"
                + (merged_note if folded_count > 1 else ""),
                existing,
                existing.status,
            )
        )

    return plans


def _merge_into(record: ApplicationTrack, incoming: TrackRecordIn) -> None:
    """把一条通知合并进已有记录。

    只覆盖这次通知确实带来的字段，不清空用户自己填过的东西：一封只写了"进入面试"的邮件
    不该把用户记的下一步或备注抹掉。
    """
    record.status = resolve_status(record.status, incoming.status)
    if incoming.stage_note:
        record.stage_note = incoming.stage_note
    if incoming.status_date:
        record.status_date = incoming.status_date
    if incoming.applied_at and not record.applied_at:
        record.applied_at = incoming.applied_at
    if incoming.next_action:
        record.next_action = incoming.next_action
        record.next_action_date = incoming.next_action_date
    if incoming.note:
        # 备注是追加而不是替换：一条通知里的一句话不该让之前的备注消失。
        merged = f"{record.note}\n{incoming.note}".strip() if record.note else incoming.note
        record.note = merged[:4_000]
    if incoming.evidence:
        record.evidence = incoming.evidence[:500]


def apply_merges(
    db: Session, records: list[TrackRecordIn], *, source: str = "recognized"
) -> TrackApplyOut:
    """执行合并计划；预览说什么，这里就做什么。"""
    plans = plan_merges(db, records)
    items: list[TrackApplyItemResult] = []
    created = updated = unchanged = 0

    for plan in plans:
        if plan.action == MERGE_CREATED:
            created_record = ApplicationTrack(source=source)
            _apply_payload(
                created_record,
                TrackCreate(**plan.record.model_dump(), job_id=None, resume_id=None),
            )
            db.add(created_record)
            created += 1
            status = plan.record.status
        elif plan.action == MERGE_UPDATED:
            assert plan.existing is not None  # 计划里说更新，就一定找得到原记录
            _merge_into(plan.existing, plan.record)
            updated += 1
            status = plan.existing.status
        else:
            # 未改变也要把来源摘录留下来：用户可能正是为了留下这封通知的原文才导入的。
            if plan.existing is not None and plan.record.evidence:
                plan.existing.evidence = plan.record.evidence[:500]
            unchanged += 1
            status = plan.current_status
        items.append(
            TrackApplyItemResult(
                company=plan.record.company,
                title=plan.record.title,
                action=MERGE_LABELS.get(plan.action, plan.action),
                status=status,
                reason=plan.reason,
            )
        )

    db.commit()
    return TrackApplyOut(items=items, created=created, updated=updated, unchanged=unchanged)


def preview_merges(db: Session, records: list[TrackRecordIn]) -> list[TrackMergePreview]:
    """预览粘贴的进度记录与现有记录的合并计划（只算不写，/parse 直接返回）。"""
    return [
        TrackMergePreview(
            record=plan.record,
            action=plan.action,
            reason=plan.reason,
            current_status=plan.current_status,
        )
        for plan in plan_merges(db, records)
    ]


# ===== 与投递台的接合点 =====


def record_applied(
    db: Session, *, company: str, title: str, applied_on: str = "", job_id: int | None = None
) -> None:
    """投递成功后落一条「已投递」。

    刻意**不**覆盖已有记录的更靠后状态：用户可能已经手动把这家推到「面试」了，
    而投递台的批量任务又跑了一次同一个岗位——那时把状态打回「已投递」是错的。
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
        record = ApplicationTrack(source=SOURCE_APPLY)
        _apply_payload(
            record, TrackCreate(**payload.model_dump(), job_id=job_id, resume_id=None)
        )
        db.add(record)
        return
    if not existing.applied_at:
        existing.applied_at = payload.applied_at
    if existing.job_id is None and job_id is not None:
        existing.job_id = job_id
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


def export_rows(records: list[ApplicationTrack]) -> list[list[str]]:
    """把进度记录转成 CSV 导出的行（备注换行压成空格）。"""
    return [
        [
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
        for item in records
    ]


def to_csv(records: list[ApplicationTrack]) -> str:
    """导出 CSV。

    ``\\ufeff`` 是 BOM：Excel 打开不带 BOM 的 UTF-8 CSV 会把中文显示成乱码，
    而这份文件最常见的用途恰恰是用 Excel 打开看看。
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(_CSV_HEADER)
    writer.writerows(export_rows(records))
    return "﻿" + buffer.getvalue()


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
    "create_track",
    "delete_track",
    "export_rows",
    "list_tracks",
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


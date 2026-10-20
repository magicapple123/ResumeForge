# SPDX-License-Identifier: Apache-2.0
"""进度合并与字段写入的单一实现：**预览说什么，执行就做什么**。

``plan_merges`` 算出"每条会新增还是更新、为什么"，预览接口把它原样返回，确认接口
（:func:`apply_merges`）再执行同一份计划。两处各写一遍判断是这类功能最容易出的错——
预览说"会更新"，点了确认却没更新（或反过来），用户再也不会相信那个预览。

:func:`_apply_payload` 是 track 字段写入的唯一实现（手工新增/编辑与识别合并三方共用）。
状态取舍规则见 ``models/tracker.py`` 的 :func:`resolve_status`：只能前进，拒信除外。
"""
from __future__ import annotations

from sqlalchemy import tuple_
from sqlalchemy.orm import Session

from ..models.tracker import (
    MERGE_CREATED,
    MERGE_LABELS,
    MERGE_UNCHANGED,
    MERGE_UPDATED,
    ApplicationTrack,
    normalize_key,
    resolve_status,
    status_label,
)
from ..schemas.tracker import (
    TrackApplyItemResult,
    TrackApplyOut,
    TrackCreate,
    TrackMergePreview,
    TrackRecordIn,
    TrackUpdate,
)
from .track_events import record_status_change, write_source

__all__ = ["apply_merges", "plan_merges", "preview_merges"]


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
    # 渠道（RF-18）只在 TrackCreate/TrackUpdate 上：识别合并的中间类型没有它。
    record.channel = payload.channel


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


def _merge_into(record: ApplicationTrack, incoming: TrackRecordIn) -> str:
    """把一条通知合并进已有记录。

    只覆盖这次通知确实带来的字段，不清空用户自己填过的东西：一封只写了"进入面试"的邮件
    不该把用户记的下一步或备注抹掉。

    阶段字段（``stage_note``/``status_date``）只在状态**真的前进**时才采纳
    （RF-06）：乱序旧通知或终态记录上的过期回执，状态保住了，阶段说明和状态日期
    也不能被旧阶段拖回去。拒信通知不受此限——它总是推进状态（终态互斥），它自己
    的说明（如「技术面挂了」）理应落进记录。

    返回合并前的状态（供事件留痕判断"这次合并改没改状态"）。
    """
    previous_status = record.status
    record.status = resolve_status(record.status, incoming.status)
    if record.status != previous_status:
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
    return previous_status


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
            db.flush()  # 先拿到 id：事件要挂 track_id
            record_status_change(
                db,
                created_record,
                from_status="",
                to_status=plan.record.status,
                status_date=plan.record.status_date,
                source=write_source(manual=False),
                # 识别导入经过了用户在确认页勾选，是"用户确认过的"程序写入。
                user_confirmed=True,
            )
            created += 1
            status = plan.record.status
        elif plan.action == MERGE_UPDATED:
            assert plan.existing is not None  # 计划里说更新，就一定找得到原记录
            merged_from = _merge_into(plan.existing, plan.record)
            if merged_from != plan.existing.status:
                # 合并推进了状态（含拒信覆盖）：留痕。事件里的日期取通知上的日期。
                record_status_change(
                    db,
                    plan.existing,
                    from_status=merged_from,
                    to_status=plan.existing.status,
                    status_date=plan.record.status_date,
                    source=write_source(manual=False),
                    user_confirmed=True,
                )
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

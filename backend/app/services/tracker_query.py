# SPDX-License-Identifier: Apache-2.0
"""求职进度的查询层：过滤口径、排序、列表、分页、漏斗统计与惰性行迭代。

从 ``tracker.py`` 纯搬迁而来（PR-18 豁免拆分批）：查询/统计口径是求职看板的
主读路径，与写路径（``tracker.py``）与导出（``tracker_csv.py``）的接缝在此分开。
``tracker.py`` 经门面 re-export 全部公开名字——消费方（``api/tracker.py``、
``assistant_tools/tracker_tools.py``）的 import 路径不变。
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Query, Session

from ..models.tracker import (
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUSES,
    ApplicationTrack,
    is_active,
)
from . import trash

MAX_LIST_LIMIT = 500


def track_or_none(db: Session, track_id: int) -> ApplicationTrack | None:
    """取一条投递记录；**已在回收站里的当作不存在**（见 ``claim_or_none`` 的说明）。"""
    record = db.get(ApplicationTrack, track_id)
    if record is None or trash.is_deleted(record):
        return None
    return record


def _filtered_query(
    db: Session, *, status: str = "", keyword: str = "", job_id: int | None = None
) -> Query[ApplicationTrack]:
    """list / summarize / iter_tracks **共用的过滤口径**：软删过滤 + 状态 + 关键词 + 岗位。

    抽出来是为了让统计永远跟列表同一口径——两处各写一遍过滤条件，迟早会改漏一边。
    ``job_id``（PR-13）：岗位深链时列表、统计与导出三处都按它过滤，否则会出现
    "列表是一家公司的岗位，漏斗和下载却是全部岗位"的口径分裂。None 表示不过滤。
    """
    query = db.query(ApplicationTrack).filter(trash.live_only(ApplicationTrack))
    if status:
        query = query.filter(ApplicationTrack.status == status)
    if job_id is not None:
        query = query.filter(ApplicationTrack.job_id == job_id)
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
    db: Session,
    *,
    status: str = "",
    keyword: str = "",
    job_id: int | None = None,
    limit: int | None = MAX_LIST_LIMIT,
) -> list[ApplicationTrack]:
    """按状态 / 关键词 / 岗位检索。

    默认排序刻意是"进行中的排在前面、越靠后的阶段越靠前"：用户打开这一页最想先看到的是
    还在推进的那几家，而不是三个月前就结束了的。排序已**下推 SQL**（2026-10-05 性能审查：
    旧实现把全表拉回内存再用 Python 排序，是求职看板的主读路径）。

    ``limit`` 默认取 :data:`MAX_LIST_LIMIT` 给列表响应兜个上限；``limit=None`` 表示
    不限量——**导出与助手工具必须传 None**：导出截断等于丢用户数据，助手工具自己
    有一层 limit 语义（见 tracker_tools），两层各管各的。
    """
    query = _stage_ordered(_filtered_query(db, status=status, keyword=keyword, job_id=job_id))
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
    不过滤（不传该参数的行为与从前完全一致）。过滤下推 ``_filtered_query``（PR-13），
    与统计/导出共用同一份口径。
    """
    base = _filtered_query(db, status=status, keyword=keyword, job_id=job_id)
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


def summarize(
    db: Session, *, status: str = "", keyword: str = "", job_id: int | None = None
) -> dict[str, Any]:
    """列表接口的统计部分：漏斗各阶段计数 + 几个一眼要看到的数字。

    从 **SQL 聚合**取数，过滤口径与列表共用（``_filtered_query``）：列表行数被
    :data:`MAX_LIST_LIMIT` 截断后，统计仍要反映筛选条件下的**全部**记录，而不是
    只数返回的那一页。状态计数沿用旧行为：目录之外的状态也会出现在 ``status_counts``。
    ``job_id``（PR-13）：岗位深链时统计与列表同口径，不再出现"列表是一家公司、
    漏斗是全部岗位"的分裂。
    """
    base = _filtered_query(db, status=status, keyword=keyword, job_id=job_id)
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


def iter_tracks(
    db: Session, *, status: str = "", keyword: str = "", job_id: int | None = None
) -> Iterator[ApplicationTrack]:
    """按状态 / 关键词 / 岗位检索的**惰性**版本：排序与 :func:`list_tracks` 完全一致。

    导出（``limit=None`` 全量）专用：``yield_per`` 让 DBAPI 按批取行，端点不再
    fetchall 把万级记录一次性拖进内存。非导出路径（列表、统计）不经过这里。
    """
    query = _stage_ordered(_filtered_query(db, status=status, keyword=keyword, job_id=job_id))
    return iter(query.yield_per(200))


def count_tracks(
    db: Session, *, status: str = "", keyword: str = "", job_id: int | None = None
) -> int:
    """当前筛选下的记录总数（排序无关）：导出文件名与流式读取各查一次，口径一致。"""
    return int(_filtered_query(db, status=status, keyword=keyword, job_id=job_id).count())


__all__ = [
    "MAX_LIST_LIMIT",
    "count_tracks",
    "iter_tracks",
    "list_tracks",
    "list_tracks_page",
    "summarize",
    "track_or_none",
]

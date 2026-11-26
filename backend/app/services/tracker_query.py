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

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Query, Session

from ..models.followup import ApplicationFollowUp
from ..models.tracker import (
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUSES,
    ApplicationTrack,
    is_active,
)
from ..vocabulary.followup import FOLLOWUP_DECISION_CONTACTED
from . import trash

MAX_LIST_LIMIT = 500


def track_or_none(db: Session, track_id: int) -> ApplicationTrack | None:
    """取一条投递记录；**已在回收站里的当作不存在**（见 ``claim_or_none`` 的说明）。"""
    record = db.get(ApplicationTrack, track_id)
    if record is None or trash.is_deleted(record):
        return None
    return record


def existing_track_ids(db: Session, track_ids: list[int]) -> set[int]:
    """这批进度记录里真实存在的 id（**不排除回收站**：历史决策与恢复后语义一致）。

    为什么放服务层：跟进决策要按 id 集合做外键存在性校验，而"哪些 id 存在"属于
    求职进度域的读取口径，不该由路由自己拼 SQL。
    """
    if not track_ids:
        return set()
    return set(
        db.scalars(select(ApplicationTrack.id).where(ApplicationTrack.id.in_(track_ids))).all()
    )


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


# ===== 排序（R13：进度页可排序，方向与字段都下推 SQL） =====

#: 可排序字段。``stage``（阶段优先）是默认值，语义等于改造前写死的次序。
TRACK_SORT_KEYS: tuple[str, ...] = (
    "stage",
    "updated",
    "next_action_date",
    "applied_at",
    "company",
)

#: 默认排序键。前端「阶段优先」不写 URL，后端缺省值也必须是它，否则刷新一次次序就变了。
DEFAULT_TRACK_SORT = "stage"

#: 每个字段的默认方向（换字段时前端回到这里，后端做非法值兜底时也用它）。
#: ``stage`` 不在表里：它是复合排序（阶段序 → 更新时间 → id），没有可翻转的方向。
TRACK_SORT_DEFAULT_ORDER: dict[str, str] = {
    "updated": "desc",
    "next_action_date": "asc",
    "applied_at": "desc",
    "company": "asc",
}


def normalize_track_sort(sort: str | None, order: str | None) -> tuple[str, str]:
    """``(sort, order)`` → 合法组合；**任何非法值都回落默认，不抛 422、更不能 500**。

    为什么不在接口层用 Literal 校验：排序是"看数据的角度"，URL 里带了个手改坏的
    ``?sort=foo`` 时，用户想要的是"按默认次序看"，而不是一页错误。这与 ``status``
    的 422 不同——状态是过滤条件，悄悄忽略会让人以为筛选生效了。
    """
    key = (sort or "").strip().lower()
    if key not in TRACK_SORT_DEFAULT_ORDER and key != DEFAULT_TRACK_SORT:
        return DEFAULT_TRACK_SORT, ""
    if key == DEFAULT_TRACK_SORT:
        # 阶段优先是固定次序：等宽翻转在这里没有意义，方向一律归零（前端也不显示）。
        return DEFAULT_TRACK_SORT, ""
    direction = (order or "").strip().lower()
    if direction not in ("asc", "desc"):
        direction = TRACK_SORT_DEFAULT_ORDER[key]
    return key, direction


def _blank_last(column: Any) -> Any:
    """空值分层表达式：**不管升降序，空值一律排最后**。

    只按方向排是不够的：``applied_at`` / ``next_action_date`` 升序时 SQLite 把空值排在
    最前，而"没有下一步时间"正是最不紧急的那一批，顶到第一屏与"最该先看的排前面"相反。
    这两列在模型里默认是**空串**（不是 NULL），所以两种"没填"都要当成空值。
    """
    return case((or_(column.is_(None), column == ""), 1), else_=0)


def track_order_by(sort: str, order: str) -> tuple[Any, ...]:
    """``(sort, order)`` → ORDER BY 子句（调用方先用 :func:`normalize_track_sort` 洗过）。

    每个键都以 ``id`` 收尾：同一时刻更新的两条记录在翻页时才不会重复或漏行。
    平局口径统一是 ``updated_at desc → id desc``——与改造前的默认次序逐字一致，
    用户从"阶段优先"切到别的键时，同分的那批记录不会整片倒过来。
    """
    tie_break = (ApplicationTrack.updated_at.desc(), ApplicationTrack.id.desc())
    if sort == "updated":
        column = ApplicationTrack.updated_at
        primary = column.desc() if order == "desc" else column.asc()
        return (primary, ApplicationTrack.id.desc())
    if sort == "next_action_date":
        column = ApplicationTrack.next_action_date
        primary = column.desc() if order == "desc" else column.asc()
        return (_blank_last(column), primary, *tie_break)
    if sort == "applied_at":
        column = ApplicationTrack.applied_at
        primary = column.desc() if order == "desc" else column.asc()
        return (_blank_last(column), primary, *tie_break)
    if sort == "company":
        # 中文按拼音、英文按字母：SQLite 默认的 BINARY collation 会把中文全部沉底
        # （「111」永远第一），``rf_pinyin`` 由 ``app/database.py`` 在每条连接上注册。
        column = func.coalesce(ApplicationTrack.company, "").collate("rf_pinyin")
        primary = column.desc() if order == "desc" else column.asc()
        return (primary, *tie_break)
    return (
        _stage_expression(),
        # SQLite 的 DESC 把 NULL 排在最后，与旧实现 None→datetime.min→排在末尾一致；
        # updated_at 同值时按 id 新的在前，也与旧实现的 -id 次序键一致。
        ApplicationTrack.updated_at.desc(),
        ApplicationTrack.id.desc(),
    )


def _stage_ordered(query: Query[ApplicationTrack]) -> Query[ApplicationTrack]:
    """list_tracks / iter_tracks / 导出共用的默认次序：阶段序 → updated_at → id。

    与分页端点共用同一份 :func:`track_order_by`——两处各写一遍排序，迟早会改漏一边。
    """
    return query.order_by(*track_order_by(DEFAULT_TRACK_SORT, ""))


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
    sort: str = DEFAULT_TRACK_SORT,
    order: str = "",
) -> tuple[list[ApplicationTrack], int]:
    """分页列出求职进度（RF-08）：过滤与排序与 :func:`list_tracks` 完全一致。

    与旧列表的分工：旧端点给 MAX_LIST_LIMIT 兜底上限，本函数服务
    ``GET /api/tracker/page``——历史记录超过 500 条之后仍然全部可达。统计（漏斗）
    仍由旧端点随列表下发，本函数只负责行。

    ``job_id``（RF-11）：岗位详情深链过来的「该岗位的投递进度」过滤；None 表示
    不过滤（不传该参数的行为与从前完全一致）。过滤下推 ``_filtered_query``（PR-13），
    与统计/导出共用同一份口径。

    ``sort`` / ``order``（R13）：用户在下拉里选的字段与方向。**必须下推 SQL**——列表
    20 条一页，本地排序只能排当页。缺省 ``stage`` 等于改造前的次序。
    """
    key, direction = normalize_track_sort(sort, order)
    base = _filtered_query(db, status=status, keyword=keyword, job_id=job_id)
    total = base.count()
    rows = (
        base.order_by(*track_order_by(key, direction))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
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


def job_ids_for_tracks(db: Session, track_ids: list[int]) -> dict[int, int | None]:
    """这批进度各自挂的岗位 id（CR-19，一次批查询；没挂岗位的值为 None）。

    任务步骤只记 ``track_id``，首页要把它变成 ``/tracker?job_id=`` 的链接参数。
    查询属于求职进度域，放在查询层而不是路由层（``test_api_layer_rules`` 守着）。
    """
    if not track_ids:
        return {}
    rows = db.execute(
        select(ApplicationTrack.id, ApplicationTrack.job_id).where(
            ApplicationTrack.id.in_(track_ids)
        )
    ).all()
    return {track_id: job_id for track_id, job_id in rows}


def latest_contacted_at(db: Session, track_ids: list[int]) -> dict[int, Any]:
    """这批进度里每条「最近一次已联系」的时刻（CR-19，一次批查询）。

    口径刻意只认 ``contacted``：``replied`` 是"对方已回"、``stopped`` 是"不跟了"，
    把它们显示成「已联系」等于替用户说没发生过的事。没有任何 contacted 决策的进度
    不出现在结果里，调用方据此显示空（而不是一个编出来的时间）。
    """
    if not track_ids:
        return {}
    rows = db.execute(
        select(ApplicationFollowUp.track_id, func.max(ApplicationFollowUp.decided_at))
        .where(
            ApplicationFollowUp.track_id.in_(track_ids),
            ApplicationFollowUp.decision == FOLLOWUP_DECISION_CONTACTED,
        )
        .group_by(ApplicationFollowUp.track_id)
    ).all()
    return {track_id: decided_at for track_id, decided_at in rows}


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
    "DEFAULT_TRACK_SORT",
    "MAX_LIST_LIMIT",
    "TRACK_SORT_DEFAULT_ORDER",
    "TRACK_SORT_KEYS",
    "count_tracks",
    "existing_track_ids",
    "iter_tracks",
    "job_ids_for_tracks",
    "list_tracks",
    "list_tracks_page",
    "latest_contacted_at",
    "normalize_track_sort",
    "summarize",
    "track_or_none",
    "track_order_by",
]

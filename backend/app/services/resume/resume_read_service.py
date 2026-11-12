# SPDX-License-Identifier: Apache-2.0
"""简历的只读查询：列表分页 / 全选 id / 按 id 批量取存活记录。

从 api/resumes/crud_routes.py 与 api/resumes/batch_export_routes.py 搬来（读路径
第三批）：筛选条件、排序键与"缺一个就整体拒绝"的取数口径是简历域的主读路径，
路由只该做参数校验、错误映射与响应模型声明——查询构造与视图组装收在这里。
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Query, Session

from ...models.resume import ResumeRecord, saved_only
from ...schemas.common import Page
from ...schemas.resume import ResumeBrief
from .. import trash

#: 列表排序的取值 → ORDER BY（从 crud_routes 原样搬入）。
#
# 默认「最近修改」：用户更常找"我刚改过的那份"，而不是"最久以前生成的那份"。
# ``coalesce`` 兜住 0047 之前的旧行（updated_at 为空时用创建时间），迁移失败或
# 历史库残留也不会把它们排到最后。
#
# T2：每个键都配一个反向键（列头三态排序需要"再点一次反向"）。两条硬约束：
# 1. 反向键的主排序与二级排序**方向全反**，但 collation 不变（拼音仍是拼音）；
# 2. 每个键都以 ``id`` 收尾，且方向与主排序一致——同一时刻创建的记录跨页时
#    才不会重复/漏行（分页稳定性）。company_*/job_title_* 原本没有末位 tie-breaker，
#    这次一并补上（纯增强，主排序口径未变）。
RESUME_SORT_ORDERS = {
    "updated_desc": (
        func.coalesce(ResumeRecord.updated_at, ResumeRecord.created_at).desc(),
        ResumeRecord.id.desc(),
    ),
    "updated_asc": (
        func.coalesce(ResumeRecord.updated_at, ResumeRecord.created_at).asc(),
        ResumeRecord.id.asc(),
    ),
    "created_desc": (ResumeRecord.created_at.desc(), ResumeRecord.id.desc()),
    "created_asc": (ResumeRecord.created_at.asc(), ResumeRecord.id.asc()),
    # 按标题排序时先按公司/岗位归类更有意义。中文按**拼音**、英文按字母、数字按大小
    # （``rf_pinyin``，见 services/text_sort.py）：SQLite 默认的 BINARY collation 会把
    # 所有 ASCII 标题排在中文之前，于是「UI 设计师」永远第一（2026-10 用户反馈）。
    "title_asc": (ResumeRecord.title.collate("rf_pinyin").asc(), ResumeRecord.id.asc()),
    "title_desc": (ResumeRecord.title.collate("rf_pinyin").desc(), ResumeRecord.id.desc()),
    "company_asc": (
        ResumeRecord.company.collate("rf_pinyin").asc(),
        ResumeRecord.title.collate("rf_pinyin").asc(),
        ResumeRecord.id.asc(),
    ),
    "company_desc": (
        ResumeRecord.company.collate("rf_pinyin").desc(),
        ResumeRecord.title.collate("rf_pinyin").desc(),
        ResumeRecord.id.desc(),
    ),
    "job_title_asc": (
        ResumeRecord.job_title.collate("rf_pinyin").asc(),
        ResumeRecord.title.collate("rf_pinyin").asc(),
        ResumeRecord.id.asc(),
    ),
    "job_title_desc": (
        ResumeRecord.job_title.collate("rf_pinyin").desc(),
        ResumeRecord.title.collate("rf_pinyin").desc(),
        ResumeRecord.id.desc(),
    ),
}

SortKey = Literal[
    "updated_desc",
    "updated_asc",
    "created_desc",
    "created_asc",
    "title_asc",
    "title_desc",
    "company_asc",
    "company_desc",
    "job_title_asc",
    "job_title_desc",
]


def filtered_query(
    db: Session,
    *,
    keyword: str = "",
    job_id: int | None = None,
    favorite: bool | None = None,
    has_job: bool | None = None,
    include_general: bool = False,
) -> Query[ResumeRecord]:
    """list_resumes 与 list_resume_ids **共用的过滤口径**。

    四个筛选参数（keyword/job_id/favorite/has_job）与旧 list_resumes 内联逻辑逐行
    同源：两处各写一遍迟早会改漏一边（jobs 域的 filtered_query 同一模式）。
    keyword 仍走标题/岗位/公司/正文 LIKE——content 是 JSON 文本（cast 后整段扫描），
    不适合 FTS 分词，与全局搜索的简历分支口径一致，保持不动。

    **一律排除草稿**（0051）：制作台草稿是"用户点进去看过、还没保存"的落脚点，
    出现在简历中心里等于凭空多出一份空白简历。

    include_general 只与 job_id 组合生效（面试关联简历：本岗位的 + 通用的）：
    真实的投递/面试既可能用专为这个岗位写的简历，也可能用一份通用简历，所以下拉里
    两类都要给。不传或 job_id 为空时口径与以前完全一致。
    """
    query = db.query(ResumeRecord).filter(trash.live_only(ResumeRecord), saved_only())
    if job_id is not None:
        if include_general:
            # 「本岗位的简历」+「通用简历（没关联任何岗位）」，两者都在面试可选的范围内。
            query = query.filter(or_(ResumeRecord.job_id == job_id, ResumeRecord.job_id.is_(None)))
        else:
            query = query.filter(ResumeRecord.job_id == job_id)
    if has_job is not None:
        query = query.filter(
            ResumeRecord.job_id.is_not(None) if has_job else ResumeRecord.job_id.is_(None)
        )
    if favorite is not None:
        query = query.filter(ResumeRecord.favorite == favorite)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                ResumeRecord.title.like(like),
                ResumeRecord.job_title.like(like),
                ResumeRecord.company.like(like),
                cast(ResumeRecord.content, String).like(like),
            )
        )
    return query


def list_resumes_page(
    db: Session,
    *,
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
    job_id: int | None = None,
    favorite: bool | None = None,
    has_job: bool | None = None,
    include_general: bool = False,
    sort: SortKey = "updated_desc",
) -> Page[ResumeBrief]:
    """按筛选条件分页列出简历，并组装成响应分页对象。"""
    query = filtered_query(
        db,
        keyword=keyword,
        job_id=job_id,
        favorite=favorite,
        has_job=has_job,
        include_general=include_general,
    )
    total = query.count()
    records = (
        query.order_by(*RESUME_SORT_ORDERS[sort])
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Page(items=[ResumeBrief.model_validate(record) for record in records], total=total)


def list_resume_ids(
    db: Session,
    *,
    keyword: str = "",
    job_id: int | None = None,
    favorite: bool | None = None,
    has_job: bool | None = None,
    include_general: bool = False,
) -> list[int]:
    """当前筛选下**全部**简历的 id（不分页）：批量选择「全选全部简历」用。"""
    query = filtered_query(
        db,
        keyword=keyword,
        job_id=job_id,
        favorite=favorite,
        has_job=has_job,
        include_general=include_general,
    )
    return [
        resume_id
        for (resume_id,) in query.order_by(ResumeRecord.created_at.desc())
        .with_entities(ResumeRecord.id)
        .all()
    ]


def live_resumes_by_ids(db: Session, resume_ids: list[int]) -> tuple[list[ResumeRecord], list[int]]:
    """按给定 id 顺序返回存活简历与缺失 id（回收站/已删的算"不存在"）。

    批量导出拿它做"缺一份就整体 404"的存在性校验；缺失 id 交给路由映射成 404，
    因为错误形状是接口层契约。
    """
    if not resume_ids:
        return [], []
    rows = (
        db.query(ResumeRecord)
        .filter(trash.live_only(ResumeRecord), ResumeRecord.id.in_(resume_ids))
        .all()
    )
    by_id = {row.id: row for row in rows}
    ordered = [by_id[resume_id] for resume_id in resume_ids if resume_id in by_id]
    missing = [resume_id for resume_id in resume_ids if resume_id not in by_id]
    return ordered, missing


__all__ = [
    "RESUME_SORT_ORDERS",
    "SortKey",
    "filtered_query",
    "list_resume_ids",
    "list_resumes_page",
    "live_resumes_by_ids",
]

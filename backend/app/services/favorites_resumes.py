# SPDX-License-Identifier: Apache-2.0
"""收藏页的「简历侧」读模型：一次查询同时给出**内部简历**与**外部简历**的收藏行（T31）。

## 为什么必须是一个新读模型，而不是前端拼两次请求

收藏页此前的「简历」页签只查 `GET /api/resumes?favorite=true`——那只覆盖
`resume_record`（内部简历）。T28 给 `external_resume` 补齐了 `favorite` /
`favorited_at` 之后，用户在外部简历列表点了星星，**收藏页里看不到它**：两处都在"收藏"，
却只有一处能被找回。前端拼两次请求看似更省事，但那样有两个排不掉的问题：

1. **排序会错**：两个接口各自分页，前端拿到的是"内部前 10 + 外部前 10"，而不是
   "两边混在一起按收藏时间的前 10"；用户收藏了三份外部简历后，第一页可能一份都不显示。
2. **`total` 无法相加**：分页器的总数会把两份"各自的总数"加成 20+ 的假数字。

所以合并与排序都放在服务端：两张表各取最多 `MAX_FAVORITE_RESUMES` 条收藏行，
按「收藏时间倒序」合并后再切片分页，`total` 是合并后的真实条数。

## 为什么 kind 是独立字段而不是靠 id 段猜

`resume_record` 与 `external_resume` 的 id **各自从 1 开始、会撞号**（见
`types/resumeRef.ts` 的说明）：`3` 既可能是内部第 3 份，也可能是外部第 3 份。前端
若按"id 大于某个数就是外部"这类规则判断，撞号那天就会把用户点开的详情换成另一份
简历。因此每行都显式带 `kind`（`internal` / `external`）与复合引用 `ref`
（`internal:12` / `external:7`，契约 `CONTRACT.md` 第 2 节）。

## 为什么岗位与 MIME 用批量查询而不是逐行取

列表是 N 行 → 逐行 `db.get(Job, ...)` / `db.get(UserFile, ...)` 就是 N+1，一次收藏页
首屏会发几十条 SQL。岗位标题 / 公司 / MIME 三处都用**一条 `IN` 查询**批量取，
与外部简历列表的既有 helper（`job_titles` / `user_file_mimes`）同一口径——两处口径
（岗位标题怎么取、MIME 从哪来）不能各写一份。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, NamedTuple

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..models.external_resume import ExternalResume
from ..models.job import Job
from ..models.resume import ResumeRecord
from . import trash
from .external_resumes import job_titles, user_file_mimes

#: 收藏页的 kind 取值（每一行必然是其中一种）。
FavoriteResumeKind = Literal["internal", "external"]
#: 请求里的 kind 过滤值；`all` = 两种一起看（收藏页默认）。
FavoriteResumeFilter = Literal["all", "internal", "external"]

#: 单侧收藏行上限。收藏是用户手工点出来的，几十上百条已属极端；这个数只是
#: "别把整表读进内存"的闸，不是产品限制（与岗位收藏的 `MAX_FAVORITE_JOBS` 同一取舍）。
MAX_FAVORITE_RESUMES = 500

#: 排序占位时刻：`favorited_at` 为 NULL 的老行走它（排在所有真实时间之后）。
_EPOCH = datetime.min


class FavoriteResumeRow(NamedTuple):
    """合并后的一行（两张表的并集字段；各自没有的字段留空）。

    `text_chars` / `has_text` 只对外部简历有值：内部简历是结构化文档，
    "有没有文字"不是它的概念（它永远可渲染），所以留 `None` 而不是编一个 `True`
    ——前端据此只对 `external` 行渲染字数与格式徽标。
    """

    kind: str
    id: int
    title: str
    job_title: str
    company: str
    source: str
    mime: str
    file_id: int | None
    note: str
    text_chars: int | None
    has_text: bool | None
    favorited_at: datetime | None
    favorited_at_estimated: bool
    created_at: datetime
    updated_at: datetime


def _internal_rows(db: Session, pattern: str | None) -> list[ResumeRecord]:
    """内部简历的收藏行（未删除、`favorite=1`），关键词命中标题 / 岗位 / 公司。"""
    query = db.query(ResumeRecord).filter(
        trash.live_only(ResumeRecord),
        ResumeRecord.favorite.is_(True),
    )
    if pattern is not None:
        query = query.filter(
            or_(
                ResumeRecord.title.like(pattern),
                ResumeRecord.job_title.like(pattern),
                ResumeRecord.company.like(pattern),
            )
        )
    return query.order_by(ResumeRecord.id.desc()).limit(MAX_FAVORITE_RESUMES).all()


def _external_rows(db: Session, pattern: str | None) -> list[ExternalResume]:
    """外部简历的收藏行；关键词口径与 `GET /api/external-resumes` 逐字一致。

    岗位表 `outerjoin` + `live_only(Job)`：岗位被彻底删除后 `job_id` 会被
    `ON DELETE SET NULL` 置空，而已软删的岗位不该再贡献标题/公司命中——这与外部简历
    列表的既有口径必须同源，否则同一份文件在两个页面搜同一个词会有两种结果。
    """
    query = (
        db.query(ExternalResume)
        .outerjoin(Job, and_(ExternalResume.job_id == Job.id, trash.live_only(Job)))
        .filter(
            trash.live_only(ExternalResume),
            ExternalResume.favorite.is_(True),
        )
    )
    if pattern is not None:
        query = query.filter(
            or_(
                ExternalResume.name.like(pattern),
                Job.title.like(pattern),
                Job.company.like(pattern),
            )
        )
    return query.order_by(ExternalResume.id.desc()).limit(MAX_FAVORITE_RESUMES).all()


def _job_companies(db: Session, job_ids: list[int]) -> dict[int, str]:
    """批量取岗位公司名（一条 `IN` 查询；外部简历的公司只能从岗位借）。"""
    wanted = [job_id for job_id in set(job_ids) if job_id]
    if not wanted:
        return {}
    rows = (
        db.query(Job.id, Job.company).filter(Job.id.in_(wanted)).filter(trash.live_only(Job)).all()
    )
    return {int(job_id): str(company or "") for job_id, company in rows}


def _internal_row(record: ResumeRecord) -> FavoriteResumeRow:
    """内部简历 → 并集行。`company` 是它自己的列（外部简历只能从岗位表借）。"""
    return FavoriteResumeRow(
        kind="internal",
        id=int(record.id),
        title=record.title or "",
        job_title=record.job_title or "",
        company=record.company or "",
        source=record.source or "",
        mime="",
        file_id=None,
        note=record.note or "",
        text_chars=None,
        has_text=None,
        favorited_at=record.favorited_at,
        favorited_at_estimated=bool(record.favorited_at_estimated),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _external_row(
    record: ExternalResume, *, job_title: str, company: str, mime: str
) -> FavoriteResumeRow:
    """外部简历 → 并集行；`title` 取用户可见的文件名（`name`）。"""
    return FavoriteResumeRow(
        kind="external",
        id=int(record.id),
        title=record.name or "",
        job_title=job_title,
        company=company,
        # 外部简历没有「来源」概念（不是 AI 生成的），留空串让前端整列不渲染。
        source="",
        mime=mime,
        file_id=int(record.file_id) if record.file_id else None,
        note=record.note or "",
        text_chars=int(record.text_chars or 0),
        has_text=bool((record.text or "").strip()),
        favorited_at=record.favorited_at,
        # 外部简历的收藏时间都是精确值（迁移 0031 新建列，没有历史回填），永远不"不详"。
        favorited_at_estimated=False,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _sort_merged(rows: list[FavoriteResumeRow]) -> None:
    """按「最近收藏的在前」合并排序（就地）。

    两趟稳定排序：先按 `(kind, id)` 定一个**确定的**初始顺序，再按收藏时间倒序。
    为什么要先定序：`favorited_at` 相同的两行（同一秒点了两个星星）若没有次级键，
    两次请求可能给出不同顺序，列表就会"自己抖"，而用户点行内按钮时按位置取行，
    抖一下就可能操作到隔壁那一行。

    `favorited_at IS NULL`（28E 之前收藏、时间戳没回填的老内部简历）排在最后：
    它的时间「不详」，把它当"最久以前"是唯一不会撒谎的排法。
    """
    rows.sort(key=lambda row: (row.kind, row.id))
    rows.sort(
        key=lambda row: (
            row.favorited_at is not None,
            row.favorited_at or _EPOCH,
            row.updated_at or _EPOCH,
        ),
        reverse=True,
    )


def list_favorite_resumes(
    db: Session,
    *,
    kind: FavoriteResumeFilter = "all",
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[FavoriteResumeRow], int]:
    """收藏页的简历行（内部 + 外部），按收藏时间倒序 + 切片分页。

    Args:
        db: 请求会话。
        kind: `all`（默认）/ `internal` / `external`；只要一边时不做另一边的查询。
        keyword: 关键词（标题/文件名、岗位标题、公司）；空串表示不筛。
        page: 1 起的页码（调用方已由 FastAPI `ge=1` 守住下界）。
        page_size: 每页条数（调用方已由 `le=100` 守住上界）。

    Returns:
        `(rows, total)`：`rows` 是**当前页**的并集行，`total` 是合并后（切片前）的
        总数。两个数必须来自同一次合并，否则会出现"共 3 项、第二页却是空的"。
    """
    cleaned = (keyword or "").strip()
    pattern = f"%{cleaned}%" if cleaned else None

    rows: list[FavoriteResumeRow] = []
    if kind in ("all", "internal"):
        rows.extend(_internal_row(record) for record in _internal_rows(db, pattern))
    if kind in ("all", "external"):
        externals = _external_rows(db, pattern)
        job_ids = [row.job_id for row in externals if row.job_id is not None]
        titles = job_titles(db, job_ids)
        companies = _job_companies(db, job_ids)
        mimes = user_file_mimes(db, [row.file_id for row in externals])
        rows.extend(
            _external_row(
                record,
                job_title=titles.get(record.job_id or 0, ""),
                company=companies.get(record.job_id or 0, ""),
                mime=mimes.get(record.file_id, ""),
            )
            for record in externals
        )

    _sort_merged(rows)
    total = len(rows)
    start = (page - 1) * page_size
    return rows[start : start + page_size], total


def favorite_resume_ref(kind: str, record_id: int) -> str:
    """`(kind, id)` → 复合引用串（`internal:12` / `external:7`，契约第 2 节）。"""
    return f"{kind}:{record_id}"


__all__ = [
    "MAX_FAVORITE_RESUMES",
    "FavoriteResumeFilter",
    "FavoriteResumeKind",
    "FavoriteResumeRow",
    "favorite_resume_ref",
    "list_favorite_resumes",
]

# SPDX-License-Identifier: Apache-2.0
"""进度行 → 岗位详情页的**只读派生**匹配（整改 #7）。

## 为什么是派生，而不是把 ``job_id`` 回填进库

识别导入的进度显式把 ``job_id`` 置空（``tracker_merge.py``），所以"岗位广场里明明有这个
岗位、进度行却点不进去"是常态。看起来最省事的做法是导入时顺手补一个 ``job_id``，但那等于
用**一次猜测决定长期关联**：同名岗位、公司写法相近（「XX 科技」/「XX 科技有限公司」）都会
猜错，而一旦写进库，用户很难发现、更难撤销。

派生字段只影响一次显示：规则收紧或放宽都不需要迁移数据，也不会污染 ``tracker_merge`` 的
合并键语义。所以这里只回答"这一行现在可以链到哪个岗位"，**不写任何东西**。

## 两条通道

1. **已关联**：``job_id`` 有值且岗位还在（``deleted_at IS NULL``）→ 直接用它。
   软删除的岗位不返回：外键的 ``SET NULL`` 只在硬删时生效，软删后 ``job_id`` 仍在，
   不查一次就会给出一个点进去是空详情的死链。
2. **唯一命中**：``job_id`` 为空的行，按"公司归一化后相等，且岗位名归一化后相等
   或为进度标题的前缀"匹配。**只有唯一命中才返回**——0 个是没匹配上，≥2 个是
   "猜不出是哪一条"，两者都返回空（宁可不可点，也不要链错岗位）。

两次查询覆盖整页（显式一次 + 候选一次），行数增长不增加查询次数。
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from ..models.job import Job
from ..models.tracker import ApplicationTrack, normalize_key
from . import trash

# 前缀匹配的最小长度：一个字的岗位名（「A」）几乎必然误配，宁可不给链。
_MIN_PREFIX_CHARS = 2


def _matches(job_title_key: str, track_title_key: str) -> bool:
    """岗位名与进度标题是否算"同一个"：相等，或岗位名是进度标题的前缀。

    前缀这一条覆盖导入批次的常见形态：进度标题是通知里的全称
    （「后端开发工程师（校招）」），岗位广场里是简称（「后端开发工程师」）。
    """
    if not job_title_key:
        return False
    if job_title_key == track_title_key:
        return True
    return len(job_title_key) >= _MIN_PREFIX_CHARS and track_title_key.startswith(job_title_key)


def resolve_job_links(db: Session, records: Iterable[ApplicationTrack]) -> dict[int, int]:
    """算出 ``{track_id: job_id}``：可以直接跳岗位详情的行。没命中就不在表里。

    入参是**整页**记录（列表端点最多 100 行）：显式关联与候选匹配各一次查询，
    不随行数增长（N+1 会让一页 100 行变成 100 次额外 SQL）。
    """
    rows = list(records)
    if not rows:
        return {}

    links: dict[int, int] = {}
    explicit_ids = {int(row.job_id) for row in rows if row.job_id}
    if explicit_ids:
        live_ids = {
            int(job_id)
            for (job_id,) in db.query(Job.id)
            .filter(Job.id.in_(explicit_ids), trash.live_only(Job))
            .all()
        }
        for row in rows:
            if row.job_id and int(row.job_id) in live_ids:
                links[int(row.id)] = int(row.job_id)

    pending = [
        row
        for row in rows
        if not row.job_id and (row.company or "").strip() and (row.title or "").strip()
    ]
    if not pending:
        return links

    # 一次取出候选公司的全部在架岗位，Python 侧归一化比较（库里没有 company_key 列）。
    companies = {(row.company or "").strip() for row in pending}
    candidates = (
        db.query(Job.id, Job.company, Job.title)
        .filter(Job.company.in_(companies), trash.live_only(Job))
        .all()
    )
    by_company: dict[str, list[tuple[int, str]]] = {}
    for job_id, company, title in candidates:
        by_company.setdefault(normalize_key(company), []).append(
            (int(job_id), normalize_key(title))
        )

    for row in pending:
        company_key = normalize_key(row.company or "")
        title_key = normalize_key(row.title or "")
        hits = [
            job_id
            for job_id, job_title_key in by_company.get(company_key, [])
            if _matches(job_title_key, title_key)
        ]
        # 唯一命中才给：两个候选说明"猜不出是哪一条"，此时给链接比不给更糟。
        if len(hits) == 1:
            links[int(row.id)] = hits[0]
    return links


__all__ = ["resolve_job_links"]

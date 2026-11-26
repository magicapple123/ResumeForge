# SPDX-License-Identifier: Apache-2.0
"""「这条投递记录已经写进哪条求职进度」（整改 #18）。

单独成文件是因为 ``_records.py`` 已经贴到 500 行预算：这里的逻辑是**一次批量反查**，
与记录行的其余出口字段（JD 变更、队列条目）互不依赖，搬出来不影响任何调用方。

## 为什么必须与 ``link_track`` 同源

``services.apply.funnel._find_track`` 的查重键是**先 ``job_id``，再
``(company_key, title_key)`` 兜底**（历史上手工建过的进度没有 ``job_id``）。前端按钮
「更新进度 / 查看进度」由这里的结论驱动，只要两边判定不同，就会出现"列表说没写过、
点一下却回 ``created=false``"的矛盾——用户会以为按钮坏了。所以键的顺序、"取最小 id"
的次序都与 ``_find_track`` 保持一致。

## 为什么不能逐条查

一页 20 条记录 = 20 次额外 SQL，而它们读的是同一张 ``application_track``。
调用方把整页记录一起交进来，这里最多两次查询（按 ``job_id`` 一次、按合并键一次）。
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from ...models.apply import ApplyTaskItem
from ...models.tracker import ApplicationTrack, normalize_key
from .. import trash


def track_id_map(db: Session, rows: Iterable[ApplyTaskItem]) -> dict[int, int]:
    """批量反查"这些投递记录各自对应哪条进度"（最多两次查询，与条数无关）。

    返回 ``{记录 id: 进度 id}``：没有对应进度的记录不出现在映射里，调用方按缺失传 ``None``
    （前端据此渲染「更新进度」）。

    岗位与岗位名用的是记录上的**快照**（``_tasks.py`` 建记录时从 job 复制）：``link_track``
    读的也是这份快照（记录上为空时才回落到 job，而那时 job 侧同样是空，最终直接拒绝写入），
    因此这里不需要再回查岗位表。
    """
    items = list(rows)
    if not items:
        return {}

    job_ids = sorted({int(item.job_id) for item in items if item.job_id is not None})
    # 兜底键：只保留两段都非空的组合（任一为空时 ``link_track`` 直接拒绝写入，
    # 也就不可能有对应的进度记录）。
    key_pairs = {
        (normalize_key(item.company or ""), normalize_key(item.job_title or "")) for item in items
    }
    key_pairs = {
        (company_key, title_key)
        for company_key, title_key in key_pairs
        if company_key and title_key
    }

    by_job: dict[int, int] = {}
    if job_ids:
        job_rows = (
            db.query(ApplicationTrack.id, ApplicationTrack.job_id)
            .filter(
                trash.live_only(ApplicationTrack),
                ApplicationTrack.job_id.in_(job_ids),
            )
            .order_by(ApplicationTrack.id)
            .all()
        )
        for track_id, job_id in job_rows:
            if job_id is None:
                continue
            # 升序遍历 + setdefault = 同一岗位多条进度时取最小 id（与 ``_find_track`` 的
            # ``order_by(id).first()`` 是同一条）。
            by_job.setdefault(int(job_id), int(track_id))

    by_key: dict[tuple[str, str], int] = {}
    if key_pairs:
        # 两列各取一次 IN，再在内存里按对精确匹配：SQL 侧的元组 IN 在不同方言下写法
        # 不一致，而多带回来的组合在内存里过滤掉即可（条数可忽略）。
        key_rows = (
            db.query(
                ApplicationTrack.id,
                ApplicationTrack.company_key,
                ApplicationTrack.title_key,
            )
            .filter(
                trash.live_only(ApplicationTrack),
                ApplicationTrack.company_key.in_({company_key for company_key, _ in key_pairs}),
                ApplicationTrack.title_key.in_({title_key for _, title_key in key_pairs}),
            )
            .order_by(ApplicationTrack.id)
            .all()
        )
        for track_id, company_key, title_key in key_rows:
            by_key.setdefault((company_key or "", title_key or ""), int(track_id))

    mapping: dict[int, int] = {}
    for item in items:
        track_id: int | None = None
        if item.job_id is not None:
            track_id = by_job.get(int(item.job_id))
        if track_id is None:
            track_id = by_key.get(
                (normalize_key(item.company or ""), normalize_key(item.job_title or ""))
            )
        if track_id is not None:
            mapping[item.id] = track_id
    return mapping


__all__ = ["track_id_map"]

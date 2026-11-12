# SPDX-License-Identifier: Apache-2.0
"""备选岗位的只读查询（批量按 id 取存活候选）。

从 api/candidate_jobs.py 搬来：services/candidate_jobs.py 已贴着 500 行预算，而
"按 id 批量取候选 + 只认未删除"是导出/批量操作共用的存在性校验。为什么放服务层：
这套取数口径属于备选岗位域，路由只该把缺失 id 映射成 404。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.material import CandidateJob
from .trash import live_only


def candidates_by_ids(
    db: Session, candidate_ids: list[int]
) -> tuple[list[CandidateJob], list[int]]:
    """按给定 id 顺序返回存活候选与缺失 id（回收站里的算"不存在"）。

    缺失 id 交给调用方映射成 404：错误形状是接口层契约，不归服务层管。
    """
    if not candidate_ids:
        return [], []
    rows = (
        db.query(CandidateJob)
        .filter(CandidateJob.id.in_(candidate_ids), live_only(CandidateJob))
        .all()
    )
    by_id = {candidate.id: candidate for candidate in rows}
    ordered = [by_id[candidate_id] for candidate_id in candidate_ids if candidate_id in by_id]
    missing = [candidate_id for candidate_id in candidate_ids if candidate_id not in by_id]
    return ordered, missing


__all__ = ["candidates_by_ids"]

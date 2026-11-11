# SPDX-License-Identifier: Apache-2.0
"""队列列表的展示信号：匹配参考分与收藏标记（14B）。

两个字段都是**派生值 / 快照**，不落库、不参与准入：

- ``match_score`` 复用 ``services/match_scoring.score_match_result``（与岗位广场的
  「参考分」是同一份实现，含免责文案），未分析或读不出可用结论时为 ``None``；
- ``favorite`` 直接取 ``Job.favorite``（字段本来就有，只是以前没透出给队列）。

参考分要现算，而算分需要"资料文本 + 该岗位的简历文本"。批量列出 500 条队列时逐行
重读资料是纯浪费，所以调用方可以把一个 ``cache`` 字典传进来（``list_queue`` 就是
这么做的），资料只读一次。
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ...models.apply import JobMatchAnalysis
from ...models.job import Job
from ...schemas.job_match import JobMatchResult
from ..job.job_match import finalize_match_result, job_payload
from ..match_scoring import score_match_result
from ._match import latest_match

logger = logging.getLogger(__name__)


def _source_texts(db: Session, job: Job, cache: dict[str, Any]) -> tuple[str, str]:
    """取 ``(资料文本, 该岗位简历文本)``；资料文本按 ``cache`` 复用。

    **延迟导入**：``job_match_context`` 在模块顶层 import 了 ``services.apply`` 的门面
    （``apply_service``），而本模块由 ``apply_service → _queue`` 这条链在包初始化期间
    加载——顶层 import 会形成循环。模块已缓存，函数内 import 的代价可以忽略。
    """
    from ..job.job_match_context import match_source_texts

    profile = cache.get("profile")
    profile, profile_text, resume_text = match_source_texts(db, job, profile=profile)
    cache["profile"] = profile
    return profile_text, resume_text


def _finalized_result(match: JobMatchAnalysis) -> JobMatchResult | None:
    """把库里的 ``result`` 收成可用结论；脏数据只记一条日志，绝不让队列列表失败。"""
    payload = match.result if isinstance(match.result, dict) else {}
    try:
        return finalize_match_result(JobMatchResult.model_validate(payload))
    except (ValidationError, ValueError, TypeError):
        logger.warning("岗位匹配结论无法解析，参考分留空 job_id=%s", match.job_id)
        return None


def reference_score(
    db: Session,
    job: Job | None,
    match: JobMatchAnalysis | None = None,
    *,
    cache: dict[str, Any] | None = None,
) -> int | None:
    """0-100 参考分；未分析 / 无结论 / 岗位已删时返回 ``None``。

    参考分是**派生值**：不落库、不回写 ``job_match_analysis.result``，也不改变准入结论
    （前端必须用「参考分」措辞展示，不能拿它替代准入）。
    """
    if job is None:
        return None
    row = match if match is not None else latest_match(db, job.id)
    if row is None:
        return None
    result = _finalized_result(row)
    if result is None:
        return None
    profile_text, resume_text = _source_texts(db, job, cache if cache is not None else {})
    try:
        score = score_match_result(result, job_payload(job), profile_text, resume_text)
    except Exception:  # noqa: BLE001 - 参考分只用于展示，算不出来不该拖累队列列表
        logger.exception("参考分计算失败，本次留空 job_id=%s", job.id)
        return None
    return int(score.score)


def favorite_of(job: Job | None) -> bool:
    """队列行上的收藏标记；岗位已删时按未收藏处理。"""
    return bool(getattr(job, "favorite", False)) if job is not None else False


__all__ = ["favorite_of", "reference_score"]

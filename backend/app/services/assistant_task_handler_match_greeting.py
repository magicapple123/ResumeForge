# SPDX-License-Identifier: Apache-2.0
"""#18A match_batch / greeting_batch 的步骤（read / match / report 与 read / generate / handoff）。

- 匹配：复用 job_match.analyze_match*（未配置模型时沿用 local_match_result 本地降级），
  结果写 JobMatchAnalysis；report 只汇总，不伪造分数。
- 招呼语：复用 job_match.generate_greeting，写进投递队列条目；**不发送**（不创建 ApplyTask）。
"""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy.orm import Session

from ..models.agent_task import AgentTask, AgentTaskStep
from ..models.job import Job
from ..schemas.apply import ApplyQueueAddItem, ApplyQueueAddRequest
from . import assistant_task_handler_common as common
from .apply import _match as apply_match
from .apply import _queue as apply_queue
from .assistant_task_handler_common import (
    StepResult,
    require_live_jobs,
    run_async,
    stage_of,
    task_params,
)
from .job.job_match_context import match_source_texts

logger = logging.getLogger(__name__)


# ===== match_batch =====


def match_read_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    params = task_params(task)
    jobs = require_live_jobs(db, params)
    stage_of(task.id)["job_ids"] = [int(job.id) for job in jobs]
    return StepResult(True, {"total": len(jobs), "job_ids": [int(job.id) for job in jobs]})


def _match_one(db: Session, job: Job, provider: Any) -> tuple[Any, str]:
    from .job.job_match import analyze_match_with_retry, job_payload, local_match_result

    payload = job_payload(job)
    if provider is None:
        return local_match_result(payload), ""
    _profile, profile_text, resume_text = match_source_texts(db, job)
    result = run_async(analyze_match_with_retry(provider, payload, profile_text, resume_text))
    return result, str(getattr(getattr(provider, "config", None), "model", "") or "")


def match_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    from ..schemas.job_match import JobMatchResult

    params = task_params(task)
    jobs = require_live_jobs(db, params)
    provider = common.provider_for_task(db)
    matched: list[int] = []
    failed = 0
    for job in jobs:
        try:
            raw_result, model_name = _match_one(db, job, provider)
            result = (
                raw_result
                if isinstance(raw_result, JobMatchResult)
                else JobMatchResult.model_validate(raw_result)
            )
            apply_match.persist_match(db, job, result, model=model_name)
            matched.append(int(job.id))
        except Exception as exc:  # noqa: BLE001 - 单岗失败不拖垮整批
            failed += 1
            db.rollback()
            logger.warning("批量匹配单岗失败 job_id=%s：%s", job.id, exc)
    if not matched and failed:
        return StepResult(False, error=f"{failed} 个岗位的匹配分析全部失败")
    stage_of(task.id)["matched_jobs"] = matched
    return StepResult(True, {"processed": len(matched), "failed": failed, "job_ids": matched})


def match_report_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    from ..models.apply import JobMatchAnalysis

    stage = stage_of(task.id)
    job_ids = [int(item) for item in (stage.get("matched_jobs") or stage.get("job_ids") or [])]
    rows = (
        db.query(JobMatchAnalysis).filter(JobMatchAnalysis.job_id.in_(job_ids)).all()
        if job_ids
        else []
    )
    scores: list[int] = []
    for row in rows:
        result = row.result if isinstance(row.result, dict) else {}
        reference = result.get("reference_score")
        if isinstance(reference, dict) and isinstance(reference.get("overall"), int):
            scores.append(int(reference["overall"]))
    return StepResult(
        True,
        {"matched": len(rows), "job_ids": job_ids, "top_score": max(scores) if scores else None},
    )


# ===== greeting_batch =====


def _greeting_jobs(db: Session, task: AgentTask) -> list[Job]:
    params = task_params(task)
    known = stage_of(task.id).get("job_ids")
    if isinstance(known, list) and known:
        params = dict(params)
        params["job_ids"] = list(known)
        return require_live_jobs(db, params)
    jobs = require_live_jobs(db, params)
    stage_of(task.id)["job_ids"] = [int(job.id) for job in jobs]
    return jobs


def greeting_read_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    jobs = _greeting_jobs(db, task)
    params = task_params(task)
    template = str(params.get("template") or "").strip()
    return StepResult(
        True,
        {
            "total": len(jobs),
            "has_template": bool(template),
            "job_ids": [int(job.id) for job in jobs],
        },
    )


def _greeting_one(db: Session, job: Job, provider: Any, template: str) -> str:
    from .job.job_match import generate_greeting, job_payload

    if provider is None:
        config = apply_queue.get_apply_config(db)
        return (template or config.default_greeting or "").strip()
    payload = job_payload(job)
    resume = apply_queue.resolve_resume(db, job.id, None)
    resume_text = f"{resume.title or ''}\n{resume.job_title or ''}" if resume is not None else ""
    return run_async(generate_greeting(provider, payload, resume_text))


def _save_queue_greeting(db: Session, job: Job, greeting: str) -> bool:
    """把招呼语写进队列：已在队列就更新，否则走真实入队链路（准入闸门保留）。"""
    try:
        apply_queue.add_to_queue(
            db,
            ApplyQueueAddRequest(
                items=[
                    ApplyQueueAddItem(
                        job_id=int(job.id),
                        greeting=greeting,
                        confirm_unanalyzed=True,
                        confirm_real_gap=True,
                    )
                ]
            ),
        )
        return True
    except apply_queue.ApplyConflict:
        db.rollback()
        item = (
            db.query(apply_queue.ApplyQueueItem)
            .filter(apply_queue.ApplyQueueItem.job_id == int(job.id))
            .one_or_none()
        )
        if item is None:
            return False
        item.greeting = greeting
        db.commit()
        return True


def greeting_generate_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    params = task_params(task)
    jobs = _greeting_jobs(db, task)
    provider = common.provider_for_task(db)
    template = str(params.get("template") or "").strip()
    generated: list[int] = []
    failed = 0
    for job in jobs:
        try:
            greeting = _greeting_one(db, job, provider, template)[:500].strip()
            if not greeting:
                raise ValueError("没有可用的招呼语（模型为空且未配置默认招呼语）")
            if not _save_queue_greeting(db, job, greeting):
                raise ValueError("写不进投递队列（岗位可能不在准入范围内）")
            generated.append(int(job.id))
        except Exception as exc:  # noqa: BLE001 - 单岗失败不拖垮整批
            failed += 1
            db.rollback()
            logger.warning("批量招呼语单岗失败 job_id=%s：%s", job.id, exc)
    if not generated and failed:
        return StepResult(False, error=f"{failed} 个岗位的招呼语全部生成失败")
    return StepResult(True, {"processed": len(generated), "failed": failed, "job_ids": generated})


def greeting_handoff_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    jobs = _greeting_jobs(db, task)
    ids = [int(job.id) for job in jobs]
    rows = (
        db.query(apply_queue.ApplyQueueItem)
        .filter(apply_queue.ApplyQueueItem.job_id.in_(ids))
        .all()
    )
    queued = [row for row in rows if str(row.greeting or "").strip()]
    if not queued:
        return StepResult(False, error="没有可交给投递台的招呼语")
    return StepResult(
        True,
        {
            "queued": len(queued),
            # job_id 在队列表是 NOT NULL，且上面按 ``in_(ids)`` 取的；cast 只为了让
            # Column 声明里的 ``int | None`` 不逼近调用处。
            "job_ids": [int(cast(int, row.job_id)) for row in queued],
            "note": "只写入投递队列，未发送",
        },
    )


MATCH_HANDLERS = {
    ("match_batch", "read"): match_read_step,
    ("match_batch", "match"): match_step,
    ("match_batch", "report"): match_report_step,
}

GREETING_HANDLERS = {
    ("greeting_batch", "read"): greeting_read_step,
    ("greeting_batch", "generate"): greeting_generate_step,
    ("greeting_batch", "handoff"): greeting_handoff_step,
}

__all__ = ["GREETING_HANDLERS", "MATCH_HANDLERS"]

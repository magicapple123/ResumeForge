"""岗位匹配度分析接口（prefix ``/api/jobs``）。

薄路由：只做校验、调 service、返回 schema。匹配分析第一次把 JD 与**用户已确认的资料/
简历**对齐，所以它和「岗位需求解读」不同——这里会读取个人资料与简历。

未配置大模型时走**本地降级**并给出中文警告（不阻断流程）；资料为空时应先补资料再分析。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models.job import Job
from ..models.job_match_batch import JobMatchBatch
from ..models.profile import utcnow
from ..schemas.job_match import JobMatchOut, JobMatchResult
from ..schemas.job_match_background import JobMatchBackgroundTask
from ..schemas.job_match_batch import (
    JobMatchBatchOut,
    JobMatchBatchRequest,
    JobMatchBatchSummary,
)
from ..services import trash
from ..services.apply import apply_service
from ..services.job.job_match import (
    analyze_match,
    finalize_match_result,
    job_payload,
    local_match_result,
)
from ..services.job.job_match_background import (
    JobMatchBackgroundRunnerError,
    create_job_match_background_task,
    get_job_match_background_runner,
    get_job_match_background_task,
    list_active_job_match_background_tasks,
)
from ..services.job.job_match_batch import (
    build_batch_inputs,
    list_batch_summaries,
    persist_batch,
    run_batch_match,
)
from ..services.job.job_match_context import match_source_texts, profile_is_empty
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.match_scoring import score_match_result
from ..services.settings_service import get_llm_config

router = APIRouter(prefix="/api/jobs", tags=["job-match"])
logger = logging.getLogger(__name__)


@router.post("/match-batches", response_model=JobMatchBatchOut)
async def create_match_batch(
    payload: JobMatchBatchRequest,
    db: Session = Depends(get_db),
):
    """对用户选中的岗位批量分析，并按参考分保存一份可回看的快照。"""
    job_ids = list(dict.fromkeys(payload.job_ids))
    jobs = db.query(Job).filter(trash.live_only(Job), Job.id.in_(job_ids)).all()
    found = {job.id: job for job in jobs}
    missing = [job_id for job_id in job_ids if job_id not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"以下岗位不存在或已被删除：{'、'.join(map(str, missing))}")
    ordered_jobs = [found[job_id] for job_id in job_ids]
    try:
        inputs = build_batch_inputs(db, ordered_jobs, force=payload.force)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    config = get_llm_config(db)
    # 模型调用期间不占用请求数据库连接。
    db.close()
    run = await run_batch_match(inputs, config)
    session = SessionLocal()
    try:
        row = persist_batch(session, run)
    except Exception as exc:  # noqa: BLE001 - 记录失败要返回可理解的错误，不泄露堆栈
        session.rollback()
        logger.exception("保存批量岗位匹配记录失败")
        raise HTTPException(status_code=500, detail="保存批量匹配记录失败，请稍后重试") from exc
    finally:
        session.close()
    return JobMatchBatchOut.model_validate(row)


@router.post("/match-batch-tasks", response_model=JobMatchBackgroundTask)
def create_match_batch_task(
    payload: JobMatchBatchRequest,
    db: Session = Depends(get_db),
):
    """创建后台批量分析任务；任务结果完成后仍写入同一份历史快照。"""
    job_ids = list(dict.fromkeys(payload.job_ids))
    jobs = db.query(Job).filter(trash.live_only(Job), Job.id.in_(job_ids)).all()
    found = {job.id: job for job in jobs}
    missing = [job_id for job_id in job_ids if job_id not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"以下岗位不存在或已被删除：{'、'.join(map(str, missing))}")
    try:
        # 在创建任务前先做资料准入校验，避免用户关闭弹窗后才发现资料为空。
        build_batch_inputs(db, [found[job_id] for job_id in job_ids], force=payload.force)
        task = create_job_match_background_task(db, job_ids, force=payload.force)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        get_job_match_background_runner().start(task.task_id)
    except JobMatchBackgroundRunnerError as exc:
        # 任务记录已经写入，启动失败也必须留下明确终态，不能制造幽灵 pending。
        get_job_match_background_runner().fail_task(task.task_id, str(exc))
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return task


@router.get("/match-batch-tasks", response_model=list[JobMatchBackgroundTask])
def get_active_match_batch_tasks(db: Session = Depends(get_db)):
    return list_active_job_match_background_tasks(db)


@router.get("/match-batch-tasks/{task_id}", response_model=JobMatchBackgroundTask)
def get_match_batch_task(task_id: str, db: Session = Depends(get_db)):
    task = get_job_match_background_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="后台岗位匹配任务不存在")
    return task


@router.post("/match-batch-tasks/{task_id}/cancel", response_model=JobMatchBackgroundTask)
def cancel_match_batch_task(task_id: str, db: Session = Depends(get_db)):
    task = get_job_match_background_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="后台岗位匹配任务不存在")
    if task.status not in ("pending", "running"):
        return task
    try:
        get_job_match_background_runner().cancel(task_id)
    except JobMatchBackgroundRunnerError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    refreshed = get_job_match_background_task(db, task_id)
    return refreshed or task


@router.get("/match-batches", response_model=list[JobMatchBatchSummary])
def get_match_batch_history(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return list_batch_summaries(db, limit=limit)


@router.get("/match-batches/{batch_id}", response_model=JobMatchBatchOut)
def get_match_batch(batch_id: int, db: Session = Depends(get_db)):
    row = db.get(JobMatchBatch, batch_id)
    if row is None:
        raise HTTPException(status_code=404, detail="批量匹配记录不存在")
    return JobMatchBatchOut.model_validate(row)


@router.post("/{job_id}/match-analysis", response_model=JobMatchResult)
async def create_match_analysis(
    job_id: int,
    force: bool = Query(default=False, description="为真时忽略已有结论，强制重算"),
    db: Session = Depends(get_db),
):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")

    if not force:
        existing = apply_service.latest_match(db, job_id)
        if existing is not None and isinstance(existing.result, dict) and existing.result:
            return JobMatchResult.model_validate(existing.result)

    profile, profile_text, resume_text = match_source_texts(db, job)
    if profile_is_empty(profile) and not resume_text.strip():
        raise HTTPException(
            status_code=400, detail="个人资料为空，请先在「我的资料」中填写后再做匹配分析"
        )

    payload = job_payload(job)
    config = get_llm_config(db)
    configured = bool(config.base_url.strip() and config.model.strip())
    # 释放数据库连接（await 期间不要占着连接池）。
    db.close()

    if not configured:
        result = local_match_result(payload)
        model_name = ""
    else:
        provider = create_provider(config)
        try:
            result = await analyze_match(provider, payload, profile_text, resume_text)
        except LLMError as exc:
            logger.warning("岗位匹配分析失败：%s", exc)
            raise HTTPException(status_code=502, detail=f"生成匹配分析失败：{exc}") from exc
        except Exception as exc:  # noqa: BLE001 - 外部模型异常统一转为可理解的错误
            logger.exception("岗位匹配分析发生内部错误")
            raise HTTPException(status_code=502, detail="生成匹配分析失败，请稍后重试") from exc
        model_name = config.model

    session = SessionLocal()
    try:
        stored_job = session.get(Job, job_id)
        if stored_job is not None:
            apply_service.persist_match(session, stored_job, result, model=model_name)
    finally:
        session.close()
    return result


@router.get("/{job_id}/match-analysis", response_model=JobMatchOut)
def get_match_analysis(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    row = apply_service.latest_match(db, job_id)
    if row is None:
        # 尚未分析：返回一个空结果，前端据此显示「未分析」。
        now = utcnow()
        return JobMatchOut(
            id=0,
            job_id=job_id,
            job_title=job.title,
            company=job.company,
            result=JobMatchResult(),
            hard_gate="unknown",
            requires_confirm=False,
            model="",
            created_at=now,
            updated_at=now,
            reference_score=None,
        )
    out = JobMatchOut.model_validate(row)
    # 参考分是派生值：只读、仅展示、不落库。每次现算，且用 admission_of 重推结论后再算，
    # 与准入逻辑完全解耦（参考分不参与、也不改变五类结论与准入闸门）。
    result = finalize_match_result(JobMatchResult.model_validate(row.result))
    _profile, profile_text, resume_text = match_source_texts(db, job)
    out.reference_score = score_match_result(
        result,
        job_payload(job),
        profile_text,
        resume_text,
    )
    return out


@router.delete("/{job_id}/match-analysis", status_code=204)
def delete_match_analysis(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    apply_service.delete_match(db, job_id)
    return None


__all__ = ["router"]

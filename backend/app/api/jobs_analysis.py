"""岗位解读端点（R2）：读缓存 / 生成并写回。

从 `api/jobs.py` 拆出来：那里已经接近 500 行预算，而解读是唯一会调用模型、还会
写缓存的一组端点，单独放一处的边界最清楚。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.job import Job
from ..runtime.log_redact import log_exception_redacted
from ..schemas.job import JobOut
from ..schemas.job_analysis import JobAnalysisResponse, JobAnalysisResult
from ..services import trash
from ..services.job.job_analysis import generate_job_analysis
from ..services.job_analysis_cache import read_cached_analysis, store_analysis
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.settings_service import get_llm_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}/analysis")
def read_job_analysis(job_id: int, db: Session = Depends(get_db)) -> dict:
    """读取缓存的岗位解读（R2）：不发模型请求，秒开。

    没有缓存时返回 ``{"cached": false, "result": null}``，界面据此显示"开始生成"。
    内容改过时 ``stale: true``——旧结果照常给出，由界面提醒"可能过期"。
    """

    job = db.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    cached = read_cached_analysis(job)
    if cached is None:
        return {"cached": False, "stale": False, "generated_at": None, "result": None}
    return {"cached": True, **cached}


@router.post("/{job_id}/analysis", response_model=JobAnalysisResponse)
async def analyze_job(
    request: Request,
    job_id: int,
    force: bool = Query(
        default=False,
        description="为真时忽略已有缓存强制重新生成（消耗一次模型调用）；默认先读缓存",
    ),
    db: Session = Depends(get_db),
) -> JobAnalysisResponse:
    """生成岗位需求总结和通用求职建议，不修改岗位或个人资料。

    **先读缓存，再决定要不要调模型**（R2-a）：指纹一致且未过期的缓存直接返回并标
    ``cached=true``——用户点开弹窗往往只是想再看一眼上次的结论，不该为此再等 10–60 秒、
    再付一次 token。只有 ``force=true`` 或缓存缺失/过期时才真的调用模型。

    生成结束后再确认一次客户端是否已断开（R2-b）：已经走开的用户不该在后台被写下一份
    缓存——否则界面下次会说"已完成"，而他看的是自己那次早已放弃的请求。
    """
    job = db.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
    if not force:
        cached = read_cached_analysis(job)
        # stale 表示岗位内容改过：旧解读仍可读，但它不是"当前这份岗位"的结论，
        # 这时按缓存缺失处理，走一次真实生成；界面上也有「重新生成」的显式入口。
        if cached is not None and not cached["stale"]:
            try:
                return JobAnalysisResponse(cached=True, **cached["result"])
            except ValidationError:
                # 缓存是过去某次调用的结果，字段可能已随模型演进而不再合法。
                # 与其回 500，不如当作没有缓存重新生成一次。
                logger.warning("岗位解读缓存结构已失效，转为重新生成 job=%s", job_id)
    config = get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")
    provider = create_provider(config)
    job_out = JobOut.model_validate(job)
    # 长调用期间不持有会话：先关掉，拿到结果再开一个写缓存。
    engine = db.get_bind()
    db.close()
    try:
        result = await generate_job_analysis(provider, job_out)
    except LLMError as exc:
        logger.warning("岗位需求解读失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"生成岗位解读失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 外部模型异常统一转为用户可理解的错误
        log_exception_redacted(logger, "岗位需求解读发生内部错误")
        raise HTTPException(status_code=502, detail="生成岗位解读失败，请稍后重试") from exc
    fresh = JobAnalysisResponse(cached=False, **result.model_dump())
    if await request.is_disconnected():
        logger.info("岗位解读已生成但客户端已断开，本次不写缓存 job=%s", job_id)
        return fresh
    _cache_job_analysis(engine, job_id, result)
    return fresh


def _cache_job_analysis(engine, job_id: int, result: JobAnalysisResult) -> None:
    """把解读结果写回岗位（失败只记日志：缓存是加速，不该让一次成功的调用变失败）。"""
    from sqlalchemy.orm import Session

    session = Session(engine)
    try:
        job = session.get(Job, job_id)
        if job is not None:
            store_analysis(
                session, job, result.model_dump() if hasattr(result, "model_dump") else dict(result)
            )
    except Exception:  # noqa: BLE001 - 缓存写失败不影响用户拿到结果
        logger.warning("岗位解读缓存写入失败 job=%s", job_id, exc_info=True)
    finally:
        session.close()

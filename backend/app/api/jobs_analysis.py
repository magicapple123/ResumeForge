"""岗位解读端点（R2）：读缓存 / 生成并写回。

从 `api/jobs.py` 拆出来：那里已经接近 500 行预算，而解读是唯一会调用模型、还会
写缓存的一组端点，单独放一处的边界最清楚。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.job import Job
from ..runtime.log_redact import log_exception_redacted
from ..schemas.job import JobOut
from ..schemas.job_analysis import JobAnalysisResult
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


@router.post("/{job_id}/analysis", response_model=JobAnalysisResult)
async def analyze_job(job_id: int, db: Session = Depends(get_db)):
    """按需生成岗位需求总结和通用求职建议，不修改岗位或个人资料。"""
    job = db.get(Job, job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=404, detail="岗位不存在或已被删除")
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
        _cache_job_analysis(engine, job_id, result)
        return result
    except LLMError as exc:
        logger.warning("岗位需求解读失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"生成岗位解读失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 外部模型异常统一转为用户可理解的错误
        log_exception_redacted(logger, "岗位需求解读发生内部错误")
        raise HTTPException(status_code=502, detail="生成岗位解读失败，请稍后重试") from exc


def _cache_job_analysis(engine, job_id: int, result) -> None:
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

"""简历 AI 编辑端点（域⑥）：岗位化修改建议与按指令修订。

从原 ``api/resumes.py`` 原样搬运。**patch 锚点契约**：测试通过
``monkeypatch.setattr("app.api.resumes.create_provider" / "…get_llm_config", …)`` 在**包
命名空间**替换这两个符号，因此本模块对它们的读取必须是调用期的 ``_api.<name>`` 属性
访问（``from app.api import resumes as _api``），**禁止** from-import 具名绑定。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api import resumes as _api  # patch 锚点：调用期从包命名空间读取

from ...database import get_db
from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.job import JobOut
from ...schemas.resume import (
    ResumeContent,
    ResumeOut,
    ResumeReviseRequest,
    ResumeSuggestionsOut,
)
from ...services import trash
from ...services.llm.base import LLMError
from ...services.profile.profile_service import get_profile_detail, to_profile_out
from ...services.resume.resume_revision import revise_resume
from ...services.resume.resume_suggestions import generate_suggestions
from ._shared import _to_resume_out

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{resume_id}/suggestions", response_model=ResumeSuggestionsOut)
async def suggest_resume_edits(resume_id: int, db: Session = Depends(get_db)):
    """按需生成当前简历针对关联岗位的修改建议，不修改简历内容。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    if record.job_id is None:
        raise HTTPException(status_code=400, detail="这份简历没有关联的岗位，无法生成岗位化建议")
    job = db.get(Job, record.job_id)
    if job is None or trash.is_deleted(job):
        raise HTTPException(status_code=400, detail="关联岗位已被删除，无法生成岗位化建议")

    # 经包命名空间调用期读取，保住 test_resume_suggestions 对
    # app.api.resumes.get_llm_config 的 patch 契约。
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")
    try:
        profile = to_profile_out(get_profile_detail(db))
        resume = ResumeContent.model_validate(record.content)
        job_out = JobOut.model_validate(job)
        # 经包命名空间调用期读取，保住 test_resume_suggestions 对
        # app.api.resumes.create_provider 的 patch 契约。
        provider = _api.create_provider(config)
        db.close()
        suggestions = await generate_suggestions(
            provider,
            resume,
            job_out,
            profile,
        )
    except LLMError as exc:
        logger.warning("简历岗位建议生成失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"生成修改建议失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 为用户提供可理解的失败提示
        logger.exception("简历岗位建议发生内部错误")
        raise HTTPException(status_code=502, detail="生成修改建议失败，请稍后重试") from exc
    return ResumeSuggestionsOut(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        suggestions=suggestions,
    )


@router.post("/{resume_id}/revise", response_model=ResumeOut)
async def revise_existing_resume(
    resume_id: int, payload: ResumeReviseRequest, db: Session = Depends(get_db)
):
    """按用户指令修订简历并更新当前记录。

    指令为空 = 整体重新生成（事实口径不变，表达重写）；非空 = 只改提出的部分。
    修订**不新建记录**：预览界面里的"这份简历"始终是同一条记录，用户不满意时
    可以继续改或手动调整。旧的内容告警基于修订前的正文，一并清空。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    job = db.get(Job, record.job_id) if record.job_id is not None else None
    if record.job_id is not None and (job is None or trash.is_deleted(job)):
        # 关联岗位被删不该挡住修订：修订只需要简历本身，岗位只是可选的上下文。
        job = None

    # 经包命名空间调用期读取，保住 test_resume_revision 对
    # app.api.resumes.get_llm_config 的 patch 契约。
    config = _api.get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="请先在「设置」页配置大模型 API")
    try:
        resume = ResumeContent.model_validate(record.content)
        job_out = JobOut.model_validate(job) if job is not None else None
        # 经包命名空间调用期读取，保住 test_resume_revision 对
        # app.api.resumes.create_provider 的 patch 契约（FakeProvider 演练）。
        provider = _api.create_provider(config)
        # 这里**不**像建议接口那样先 close：修订要更新这条记录，模型返回后还要
        # 用同一个 session 落库；先关再重取反而容易拿到过期的对象状态。
        revised = await revise_resume(provider, resume, job_out, payload.instructions)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LLMError as exc:
        logger.warning("简历修订失败：%s", exc)
        raise HTTPException(status_code=502, detail=f"修订简历失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 为用户提供可理解的失败提示
        logger.exception("简历修订发生内部错误")
        raise HTTPException(status_code=502, detail="修订简历失败，请稍后重试") from exc

    record.content = revised.model_dump()
    record.warnings = []
    # 修订后的内容不再对应"生成时"的筛选状态：说明与未收录清单一并清空。
    record.coverage_notes = []
    record.rationale = ""
    db.commit()
    db.refresh(record)
    return _to_resume_out(record)

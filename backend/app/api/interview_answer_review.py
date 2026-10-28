# SPDX-License-Identifier: Apache-2.0
"""题库「我的作答」批改接口（``POST /api/interview/questions/review``）。

单独成模块的原因只有一个：``api/interview.py`` 早已贴着行数预算（会话编排 + 题库 + 思路 +
反向优化挤在一个文件里），批改是**独立的一问一答**，与面试会话的流程状态无关，放这里既
不牵连会话路由，也不必再往那个文件里加代码。

路由用 ``/questions/review`` 字面量段，注册顺序排在 ``interview.router`` 之前（与
``interview_history`` 同理）：否则会被 ``/{session_id}`` 这类参数段抢走。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.job import Job
from ..schemas.interview import InterviewAnswerReviewOut, InterviewAnswerReviewRequest
from ..schemas.resume import ResumeContent
from ..services.interview import interview_questions as interview_questions_service
from ..services.llm.base import LLMError
from ..services.profile.profile_relevance import build_job_prompt_text
from ..services.resume.resume_suggestions import serialize_resume_prompt_data

# 通过模块访问而不是 `from .interview import _require_provider`：测试用 monkeypatch 把
# `app.api.interview._require_provider` 换成了假 provider（"monkeypatch 钉死端点编排"
# 的既有约定），按值导入会让那个补丁失效，于是接口在测试里始终返回"尚未配置大模型"。
from . import interview as interview_api

router = APIRouter(prefix="/api/interview", tags=["interview"])
logger = logging.getLogger(__name__)


@router.post("/questions/review", response_model=InterviewAnswerReviewOut)
async def review_question_answer(
    payload: InterviewAnswerReviewRequest, db: Session = Depends(get_db)
):
    """批改候选人对某道题的自答：打分 + 解析 + 修改建议 + 改写示范（即时计算、不落库）。"""
    provider, _model = interview_api._require_provider(db)

    job_payload = ""
    if payload.job_id is not None:
        job = db.get(Job, payload.job_id)
        if job is not None:
            job_payload = build_job_prompt_text(job, interview_api.MAX_JOB_CONTEXT_FOR_INTERVIEW)

    resume_text = ""
    if payload.resume_id is not None:
        record = interview_api._resume_record_or_none(db, payload.resume_id)
        if record is None:
            raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
        resume_text = serialize_resume_prompt_data(
            ResumeContent.model_validate(record.content or {})
        )

    db.close()
    try:
        return await interview_questions_service.review_answer(
            provider,
            question=payload.question,
            my_answer=payload.my_answer,
            job_payload=job_payload,
            resume_text=resume_text,
            reference_answer=payload.reference_answer,
        )
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"批改作答失败：{exc}") from exc


__all__ = ["router"]

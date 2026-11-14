# SPDX-License-Identifier: Apache-2.0
"""题库与答题相关的路由：会话依赖从外部注入，测试可以直接替换。

为什么单独一个文件：``interview.py`` 已接近行数预算，而题库/答题这组路由的参数与返回结构
自成一类。把 ``get_db`` 与当前请求作为默认依赖注入，测试能覆盖依赖，不必打桩整个模块。
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.job import Job
from ..schemas.interview import (
    InterviewAnalysisOut,
    InterviewAnalysisRequest,
    InterviewOptimizeOut,
    InterviewOptimizeRequest,
    InterviewQuestionAnswerOut,
    InterviewQuestionAnswerRequest,
    InterviewQuestionGenerateRequest,
    QuestionBankOut,
)
from ..services.interview import interview_questions as interview_questions_service
from ..services.llm.base import LLMError
from ..services.profile.profile_relevance import build_job_prompt_text
from ..services.resume import document_io
from ..services.resume.document_view import document_text
from ._disconnect import client_gone, run_until_disconnect

MAX_JOB_CONTEXT_FOR_INTERVIEW = 6_000
MAX_RESUME_CONTEXT_FOR_QUESTION_BANK = 50_000


def register_question_routes(
    router, _require_provider, _resume_record_or_none, _job_text, _claims_json
):
    @router.post("/questions", response_model=QuestionBankOut)
    async def generate_question_bank(
        payload: InterviewQuestionGenerateRequest,
        request: Request,
        db: Session = Depends(get_db),
    ):
        """生成个性化题库（三类：基础/项目深挖/反问 HR），**即时计算、不落库**。"""
        provider, _model = _require_provider(db)
        job = db.get(Job, payload.job_id) if payload.job_id else None

        resume_record = None
        resume_json = payload.resume_text
        if payload.resume_id is not None:
            resume_record = _resume_record_or_none(db, payload.resume_id)
            if resume_record is None:
                raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
            resume_json = document_text(document_io.document_for_record(db, resume_record)[0])

        job_text = payload.job_text or (
            build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)
            if job is not None
            else _job_text(db, resume_record.job_id if resume_record is not None else None)
        )
        notes = []
        if len(job_text) > MAX_JOB_CONTEXT_FOR_INTERVIEW:
            job_text = job_text[:MAX_JOB_CONTEXT_FOR_INTERVIEW]
            notes.append(f"岗位材料较长，本次仅使用前 {MAX_JOB_CONTEXT_FOR_INTERVIEW} 字")
        if len(resume_json) > MAX_RESUME_CONTEXT_FOR_QUESTION_BANK:
            resume_json = resume_json[:MAX_RESUME_CONTEXT_FOR_QUESTION_BANK]
            notes.append(f"简历材料较长，本次仅使用前 {MAX_RESUME_CONTEXT_FOR_QUESTION_BANK} 字")
        claims_json = _claims_json(db)
        db.close()
        try:
            # 客户端断开就真的停：题库是一次十几秒的生成，人走了没人收这份结果。
            result = await run_until_disconnect(
                request,
                interview_questions_service.generate_question_bank(
                    provider,
                    job_text=job_text,
                    resume_json=resume_json,
                    claims_json=claims_json,
                ),
                what="面试题库生成",
            )
            if result is None:
                raise client_gone("面试题库生成")
        except LLMError as exc:
            raise HTTPException(status_code=502, detail=f"生成题库失败：{exc}") from exc
        return QuestionBankOut(
            job_id=job.id if job is not None and not payload.job_text else None,
            job_title="临时岗位" if payload.job_text else job.title if job is not None else "",
            company=job.company if job is not None and not payload.job_text else "",
            resume_id=payload.resume_id,
            resume_title=resume_record.title if resume_record is not None else payload.resume_title,
            groups=result["groups"],
            llm_used=True,
            notes=[*notes, *result["notes"]],
        )

    @router.post("/analyze", response_model=InterviewAnalysisOut)
    async def analyze_question(
        payload: InterviewAnalysisRequest, request: Request, db: Session = Depends(get_db)
    ):
        """输入一道真实问题，分析答题思路（框架/要点/追问/误区）。"""
        provider, _model = _require_provider(db)

        parts: list[str] = []
        if payload.job_id is not None:
            job = db.get(Job, payload.job_id)
            if job is not None:
                parts.append(
                    f"## 目标岗位\n{build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)}"
                )
        if payload.resume_id is not None:
            record = _resume_record_or_none(db, payload.resume_id)
            if record is None:
                raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
            parts.append(
                "## 候选人简历\n" + document_text(document_io.document_for_record(db, record)[0])
            )
        elif payload.resume_text:
            # 外部简历 / 导入文件（Q3）：没有内部记录，正文直接随请求带上来。
            # 拼法与题库那一侧逐字一致（同一个「## 候选人简历」标题），提示词不用分两套。
            parts.append("## 候选人简历\n" + payload.resume_text)
        claims_json = _claims_json(db)
        if claims_json:
            parts.append(f"## 事实台账\n{claims_json}")
        if payload.context.strip():
            parts.append(f"## 用户补充\n{payload.context.strip()}")

        context = "\n\n".join(parts)
        db.close()
        try:
            analysis = await run_until_disconnect(
                request,
                interview_questions_service.analyze_question(
                    provider, question=payload.question, context=context
                ),
                what="答题思路分析",
            )
        except LLMError as exc:
            raise HTTPException(status_code=502, detail=f"分析答题思路失败：{exc}") from exc
        if analysis is None:
            raise client_gone("答题思路分析")
        return analysis

    @router.post("/questions/answer", response_model=InterviewQuestionAnswerOut)
    async def generate_question_answer_entry(
        payload: InterviewQuestionAnswerRequest,
        request: Request,
        db: Session = Depends(get_db),
    ):
        """为单道题生成详细参考答案（正文 + 要点 + 话术），**即时计算、不落库**。"""
        provider, _model = _require_provider(db)

        job_payload = ""
        if payload.job_id is not None:
            job = db.get(Job, payload.job_id)
            if job is not None:
                job_payload = build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW)

        resume_text = ""
        if payload.resume_id is not None:
            record = _resume_record_or_none(db, payload.resume_id)
            if record is None:
                raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
            resume_text = document_text(document_io.document_for_record(db, record)[0])

        db.close()
        try:
            answer = await run_until_disconnect(
                request,
                interview_questions_service.generate_question_answer(
                    provider,
                    question=payload.question,
                    job_payload=job_payload,
                    resume_text=resume_text,
                ),
                what="参考答案生成",
            )
        except LLMError as exc:
            raise HTTPException(status_code=502, detail=f"生成参考答案失败：{exc}") from exc
        if answer is None:
            raise client_gone("参考答案生成")
        return answer

    @router.post("/optimize-resume", response_model=InterviewOptimizeOut)
    async def optimize_resume(
        payload: InterviewOptimizeRequest, request: Request, db: Session = Depends(get_db)
    ):
        """把面试暴露的短板与高频追问反向转成简历改写建议（**只产出建议、不改正文**）。"""
        provider, _model = _require_provider(db)
        # 内部简历走记录；外部简历 / 导入文件（Q3）没有再 404 的理由——正文随请求上来。
        record = (
            _resume_record_or_none(db, payload.resume_id)
            if payload.resume_id is not None
            else None
        )
        if payload.resume_id is not None and record is None:
            raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
        resume = document_io.document_for_record(db, record)[0] if record is not None else None

        job = (
            db.get(Job, payload.job_id)
            if payload.job_id
            else (db.get(Job, record.job_id) if record is not None and record.job_id else None)
        )
        job_text = (
            build_job_prompt_text(job, MAX_JOB_CONTEXT_FOR_INTERVIEW) if job is not None else ""
        )
        weaknesses = [str(item).strip() for item in payload.weaknesses if str(item).strip()]
        follow_ups = [str(item).strip() for item in payload.follow_ups if str(item).strip()]
        db.close()
        try:
            suggestions = await run_until_disconnect(
                request,
                interview_questions_service.optimize_resume(
                    provider,
                    resume=resume,
                    resume_text=payload.resume_text,
                    job_text=job_text,
                    weaknesses=weaknesses,
                    follow_ups=follow_ups,
                ),
                what="面试反向优化",
            )
        except LLMError as exc:
            raise HTTPException(status_code=502, detail=f"反向优化失败：{exc}") from exc
        if suggestions is None:
            raise client_gone("面试反向优化")
        return InterviewOptimizeOut(
            resume_id=payload.resume_id,
            suggestions=suggestions,
            llm_used=True,
            notes=[],
        )

# SPDX-License-Identifier: Apache-2.0
"""面试材料导入 + 结束后的追问（#41）。

两个端点，一条共同的原则：**材料在进会话之前就要拿到结果，追问在面试结束之后才开放**。

* ``POST /api/interview/materials``（multipart）：上传一份材料，立刻提取成文本返回。
  **两侧接受同一组格式**（图片 / PDF / TXT / Word / Markdown），解析路径由**文件类型**
  决定而不是 ``kind``：``kind`` 只表示"放哪一侧"（界面左右栏）。文本类走本机提取，
  图片与扫描件 PDF 走视觉模型。开面试时只把提取结果带进会话，所以用户在上传那一刻
  就能看到"识别出多少字 / 有没有警告"，而不是等开场那十几秒里再冒出一个错误。
* ``POST /api/interview/{id}/followups``：面试结束后的答疑，写入 ``phase="followup"``
  的消息——**不占正式轮次**，也不会让一场 ``finished`` 的会话重新变回 ``active``。

端点放在独立模块里，由 ``api/interview.py`` 用 ``register_*`` 挂到同一个 router 上：
``api/interview.py`` 已经贴着 500 行预算，而这两块各有一份自己的校验与错误文案。
"""

from __future__ import annotations

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.interview import INTERVIEW_STATUS_FINISHED, MESSAGE_PHASE_FOLLOWUP
from ..models.profile import utcnow
from ..schemas.interview import (
    InterviewDetail,
    InterviewFollowUpCreate,
    InterviewFollowUpResult,
    InterviewFollowUpStateUpdate,
)
from ..schemas.interview_material import InterviewMaterialExtract, MaterialKind
from ..services.document_text import material_suffix
from ..services.interview.interview import add_message
from ..services.interview.interview_followup import generate_followup
from ..services.interview.interview_material import (
    IMAGE_MATERIAL_SUFFIXES,
    extract_image_material,
    extract_text_material,
    recognize_material_scans,
)
from ..services.llm.base import LLMError
from .interview_shared import (
    _resume_text,
    _session_job_text,
    _session_or_404,
    _to_detail,
)

# 单份材料文件的硬上限：与 ``document_text.MAX_MATERIAL_FILE_BYTES`` 同一个数，
# 在这里再拦一道是因为 multipart 已经收进内存/临时文件，早点说"太大"比解析完再说好。
MAX_MATERIAL_UPLOAD_BYTES = 10 * 1024 * 1024

_TOO_LARGE_DETAIL = "文件超过 10 MB，无法导入"
_EMPTY_DETAIL = "文件是空的"
_IMAGE_FAILED_DETAIL = "视觉模型暂时无法识别这张图"
_SCAN_FAILED_DETAIL = "视觉模型暂时无法识别这份 PDF 的扫描页"
_FOLLOWUP_NOT_FINISHED_DETAIL = "这场面试还没结束，追问只在面试结束后开放"
_FOLLOWUP_CLOSED_DETAIL = "追问已停止，先点「继续追问」再发问"
_FOLLOWUP_FAILED_DETAIL = "面试助手暂时无法回答这次追问"


def register_material_routes(router, require_provider) -> None:
    @router.post("/materials", response_model=InterviewMaterialExtract)
    async def extract_material(
        kind: MaterialKind = Form(...),
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
    ):
        """把上传的材料提取成文本；**文件类型**决定走哪条识别链，``kind`` 只表示放哪一侧。"""
        raw = await file.read()
        name = file.filename or ""
        if not raw:
            raise HTTPException(status_code=422, detail=_EMPTY_DETAIL)
        if len(raw) > MAX_MATERIAL_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)
        suffix = material_suffix(name)

        if suffix in IMAGE_MATERIAL_SUFFIXES:
            # 图片必须走视觉模型：没配置模型时给的是"去设置里配"这个前因，而不是一个坏文件。
            provider, _model = require_provider(db)
            try:
                extracted = await extract_image_material(provider, name, raw)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except LLMError as exc:
                raise HTTPException(status_code=502, detail=_IMAGE_FAILED_DETAIL) from exc
            return InterviewMaterialExtract(
                name=extracted.name,
                text=extracted.text,
                warnings=list(extracted.warnings),
                parser="vision",
            )

        try:
            # PDF 解析是同步 CPU/IO 重活（pypdf），下沉线程池，别占住事件循环。
            extracted = await run_in_threadpool(extract_text_material, name, raw)
        except ValueError as exc:
            # detail 只写原因：动作（换文件 / 重试）由前端按场景补。
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        parser = "text"
        if extracted.scan_images:
            # 扫描件兜底：**只有真的拿到渲染页**才向模型要能力。有文字层的 PDF
            # 永远走不到这里，所以未配置模型不会挡住 pdf / txt / md / docx。
            provider, _model = require_provider(db)
            parser = "vision"
            try:
                extracted = await recognize_material_scans(provider, extracted)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except LLMError as exc:
                raise HTTPException(status_code=502, detail=_SCAN_FAILED_DETAIL) from exc

        return InterviewMaterialExtract(
            name=extracted.name,
            text=extracted.text,
            warnings=list(extracted.warnings),
            parser=parser,
        )


def register_followup_routes(router, require_provider) -> None:
    @router.post("/{session_id}/followups", response_model=InterviewFollowUpResult)
    async def submit_followup(
        session_id: int,
        payload: InterviewFollowUpCreate,
        db: Session = Depends(get_db),
    ):
        """面试结束后的追问：写入 ``phase="followup"`` 的消息，**不计入轮次**。

        为什么要求 ``finished``：追问的语义是"考完再问"。放行 ``active`` 会话的话，这条
        消息会落在一条还在推进的面试里，而它既不算轮次也不该被当成回答——两套状态混在
        一起，下一次提交回答时"复用被中断的那条"就会认错消息。

        需求 4 起"收盘"与"出报告"是两件事：自动收尾后 ``finished`` 但 ``report`` 还空着，
        这期间**本来就是追问的窗口**（决策卡上的「继续追问」），所以这条判据一个字都不用
        改——报告有没有生成与能不能追问无关。报告的转录只取 ``phase="interview"``，
        追问不会进评分（见 ``build_report_messages``）。
        """
        session = _session_or_404(db, session_id)
        if session.status != INTERVIEW_STATUS_FINISHED:
            raise HTTPException(status_code=409, detail=_FOLLOWUP_NOT_FINISHED_DETAIL)
        # 用户自己收起了追问区：关着就别再往里写消息（否则界面上看不到、记录里却有）。
        if session.follow_up_closed_at is not None:
            raise HTTPException(status_code=409, detail=_FOLLOWUP_CLOSED_DETAIL)
        provider, _model = require_provider(db)

        question = add_message(
            session,
            role="user",
            content=payload.content,
            phase=MESSAGE_PHASE_FOLLOWUP,
        )
        db.commit()

        try:
            answer = await generate_followup(
                provider,
                session,
                resume_text=_resume_text(db, session),
                job_text=_session_job_text(db, session),
            )
        except LLMError:
            # 没答出来就把这条追问撤掉：留一条"问了没人答"的记录，界面上会永远挂着
            # 一个空气泡，而用户重发一次就能得到完全相同的结果。
            db.delete(question)
            db.commit()
            raise HTTPException(status_code=502, detail=_FOLLOWUP_FAILED_DETAIL) from None

        add_message(
            session,
            role="interviewer",
            content=answer,
            phase=MESSAGE_PHASE_FOLLOWUP,
        )
        db.commit()
        db.refresh(session)
        return InterviewFollowUpResult(session=_to_detail(session), answer=answer)

    @router.patch("/{session_id}/followups", response_model=InterviewDetail)
    def set_followup_state(
        session_id: int,
        payload: InterviewFollowUpStateUpdate,
        db: Session = Depends(get_db),
    ):
        """收起 / 重新打开追问区（#41）。

        只对**已结束**的面试有意义：还在进行的会话本来就没有追问区。收起之后
        POST /followups 会被 409 拒绝；重新打开只是把时间戳置回 NULL，已经
        落库的追问记录一条都不删——"停止追问"停的是继续发问，不是抹掉聊过的内容。
        """
        session = _session_or_404(db, session_id)
        if session.status != INTERVIEW_STATUS_FINISHED:
            raise HTTPException(status_code=409, detail=_FOLLOWUP_NOT_FINISHED_DETAIL)
        session.follow_up_closed_at = utcnow() if payload.closed else None
        db.commit()
        db.refresh(session)
        return _to_detail(session)


__all__ = [
    "MAX_MATERIAL_UPLOAD_BYTES",
    "register_followup_routes",
    "register_material_routes",
]

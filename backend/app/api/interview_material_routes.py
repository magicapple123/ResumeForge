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

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.interview import (
    INTERVIEW_STATUS_FINISHED,
    MESSAGE_PHASE_FOLLOWUP,
    InterviewMessage,
)
from ..models.profile import utcnow
from ..runtime.blocking import run_sync
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
from ..services.llm.base import BaseLLMProvider, LLMError
from ..services.ocr.policy import load_ocr_context
from .interview_shared import (
    SessionMaterial,
    _commit_and_refresh,
    _resume_text,
    _session_job_text,
    _session_or_404,
    _to_detail,
    _warm_messages,
)

#: 材料识别链的「模型解析器」契约：给一个会话，拿到（provider, 模型名）或抛 400。
#: 显式标注是因为这里的 ``provider`` 可能为 ``None``（OCR 可用时不需要视觉模型），
#: 不标注时 pyright 只能推出 ``Unknown``，调用点就没有真检查。
RequireProvider = Callable[[Session], tuple[BaseLLMProvider, str]]

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

#: 响应契约允许的 ``parser`` 取值（未知值一律按 ``text``，与改造前口径一致）。
_PARSER_VALUES: dict[str, Literal["text", "ocr", "vision"]] = {
    "text": "text",
    "ocr": "ocr",
    "vision": "vision",
}


def _parser_of(extracted) -> Literal["text", "ocr", "vision"]:
    """正文来源：响应契约只认 ``text`` / ``ocr`` / ``vision``，其它值一律按本机提取。

    走"查表"而不是 ``in`` 判断：``getattr`` 拿到的是 ``Any``，值域收窄要在**返回值**上
    成立（``Literal`` 才行），否则调用点等于没被检查。
    """
    parser = str(getattr(extracted, "parser", "text"))
    return _PARSER_VALUES.get(parser, "text")


def register_material_routes(router, require_provider: RequireProvider) -> None:
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
        # 识别引擎与 Key 是全局设置：这里一次性解析，两条识别链共用同一份决策。
        # RF-02：读设置是同步 IO（``db.get`` + 设置行），放 worker 里。
        ocr_ctx = await run_sync(load_ocr_context, db)

        if suffix in IMAGE_MATERIAL_SUFFIXES:
            # OCR 可用时不需要视觉模型：用户可能只配了 DeepSeek Key、没配多模态模型，
            # 那种情况下强行 require_provider 会把一条本来能走通的路径挡死。
            provider: BaseLLMProvider | None = None
            if not (ocr_ctx.uses_ocr() and ocr_ctx.configured):
                provider, _model = await run_sync(require_provider, db)
            try:
                extracted = await extract_image_material(provider, name, raw, ocr_ctx)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except LLMError as exc:
                raise HTTPException(status_code=502, detail=_IMAGE_FAILED_DETAIL) from exc
            return InterviewMaterialExtract(
                name=extracted.name,
                text=extracted.text,
                warnings=list(extracted.warnings),
                parser=_parser_of(extracted),
            )

        try:
            # PDF 解析是同步 CPU/IO 重活（pypdf + 可能的 OCR 长连接），下沉线程池。
            extracted = await run_in_threadpool(extract_text_material, name, raw, ocr_ctx)
        except ValueError as exc:
            # detail 只写原因：动作（换文件 / 重试）由前端按场景补。
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if extracted.scan_images:
            # 扫描件兜底：**只有真的拿到渲染页**才向模型要能力。有文字层的 PDF
            # 永远走不到这里，所以未配置模型不会挡住 pdf / txt / md / docx。
            provider, _model = await run_sync(require_provider, db)
            try:
                extracted = await recognize_material_scans(provider, extracted)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except LLMError as exc:
                raise HTTPException(status_code=502, detail=_SCAN_FAILED_DETAIL) from exc
            extracted = extracted._replace(parser="vision")

        return InterviewMaterialExtract(
            name=extracted.name,
            text=extracted.text,
            warnings=list(extracted.warnings),
            parser=_parser_of(extracted),
        )


@dataclass(frozen=True)
class _FollowupPrep:
    """追问的准备结果：会话行、provider、材料快照与那条刚落库的问题消息 id。

    ``question_id`` 而不是那条 ORM 消息：模型失败要把它撤掉，跨 ``await`` 只传 id，
    由 worker 重新 ``get`` 一次。
    """

    session: Any
    provider: Any
    material: SessionMaterial
    question_id: int


def _prepare_followup(
    db: Session, session_id: int, content: str, require_provider: RequireProvider
) -> _FollowupPrep:
    """校验追问前置条件 + 落库这条追问 + 读材料快照（一个完整工作单元）。"""
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
        content=content,
        phase=MESSAGE_PHASE_FOLLOWUP,
    )
    db.commit()
    # 追问的提示词要读材料（简历文件 / 记录反序列化）与整场转录：都在 worker 里读成快照。
    material = SessionMaterial(
        resume_text=_resume_text(db, session),
        job_text=_session_job_text(db, session),
    )
    _warm_messages(session)
    return _FollowupPrep(
        session=session,
        provider=provider,
        material=material,
        question_id=int(question.id),
    )


def _discard_followup_question(db: Session, question_id: int) -> None:
    """模型没答出来就把这条追问撤掉（工作单元）。"""
    message = db.get(InterviewMessage, question_id)
    if message is not None:
        db.delete(message)
    db.commit()


def _record_followup_answer(db: Session, session: Any, content: str) -> InterviewDetail:
    """落面试官那条追问回答 + 提交刷新 + 组装响应（一个完整工作单元）。"""
    add_message(
        session,
        role="interviewer",
        content=content,
        phase=MESSAGE_PHASE_FOLLOWUP,
    )
    _commit_and_refresh(db, session)
    return _to_detail(session)


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
        prep = await run_sync(_prepare_followup, db, session_id, payload.content, require_provider)

        try:
            answer = await generate_followup(
                prep.provider,
                prep.session,
                resume_text=prep.material.resume_text,
                job_text=prep.material.job_text,
            )
        except LLMError:
            # 没答出来就把这条追问撤掉：留一条"问了没人答"的记录，界面上会永远挂着
            # 一个空气泡，而用户重发一次就能得到完全相同的结果。
            await run_sync(_discard_followup_question, db, prep.question_id)
            raise HTTPException(status_code=502, detail=_FOLLOWUP_FAILED_DETAIL) from None

        detail = await run_sync(_record_followup_answer, db, prep.session, answer)
        return InterviewFollowUpResult(session=detail, answer=answer)

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

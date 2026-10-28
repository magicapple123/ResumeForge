# SPDX-License-Identifier: Apache-2.0
"""简历写作增强接口（prefix ``/api/resumes``）。

薄路由：只做校验、调 service、返回 schema。写作/润色/翻译依赖模型，未配置时返回清晰
中文错误（不做本地降级、不伪造结果）；版本对比是纯本地 difflib，不依赖模型。

**这一组端点刻意不做成任务**：它们 1–3 秒就返回，而且结果必须**当场回填到用户正在编辑
的那一栏**（选中一段话给三个改写选项、点「润色」换掉这句话）。后台化的开销（建任务 +
轮询 + 一次通知）大于收益，人走了也没有回填目标。它们改为**保证可以中途取消**：
每个模型调用都套 ``run_until_disconnect``——客户端 abort 之后服务端真的停下，
而不是把整段跑完继续烧 token。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.claim import ClaimRecord
from ..models.resume import ResumeRecord
from ..schemas.resume import ResumeContent
from ..schemas.resume_writing import (
    PhrasesOut,
    PhrasesRequest,
    PolishOut,
    PolishRequest,
    PolishSelectionOut,
    PolishSelectionRequest,
    ResumeDiffOut,
    ResumeDiffRequest,
    RewriteFieldOut,
    RewriteFieldRequest,
    StarRewriteOut,
    StarRewriteRequest,
    TranslateOut,
    TranslateRequest,
)
from ..services import trash
from ..services.llm import create_provider
from ..services.llm.base import LLMError
from ..services.resume.resume_diff import build_resume_diff
from ..services.resume.resume_field_rewrite import (
    FieldPathError,
    resolve_field_target,
    rewrite_field,
)
from ..services.resume.resume_writing import (
    generate_phrases,
    polish,
    polish_selection,
    rewrite_star,
    translate,
)
from ..services.settings_service import get_llm_config
from ._disconnect import client_gone, run_until_disconnect

router = APIRouter(prefix="/api/resumes", tags=["resume-writing"])

# 全局 AI 润色（R17）与简历无关：用户在任意输入框里选中一段文字就能用，请求体里
# 也没有简历 id。因此单独一条前缀 `/api/writing`，不塞进 `/api/resumes/{id}/...`。
selection_router = APIRouter(prefix="/api/writing", tags=["resume-writing"])

logger = logging.getLogger(__name__)


def _load_record(db: Session, resume_id: int) -> ResumeRecord:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return record


def _require_provider(db: Session):
    config = get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")
    return create_provider(config)


@router.post("/{resume_id}/writing/star", response_model=StarRewriteOut)
async def star_rewrite(
    request: Request,
    resume_id: int,
    payload: StarRewriteRequest,
    db: Session = Depends(get_db),
):
    _load_record(db, resume_id)
    claim = None
    if payload.claim_id is not None:
        candidate = db.get(ClaimRecord, payload.claim_id)
        if candidate is not None and not trash.is_deleted(candidate):
            claim = candidate
    provider = _require_provider(db)
    db.close()
    try:
        result = await run_until_disconnect(
            request, rewrite_star(provider, payload.text, claim), what="STAR 改写"
        )
        if result is None:
            raise client_gone("STAR 改写")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"STAR 改写失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 为用户提供可理解的失败提示
        logger.exception("STAR 改写发生内部错误")
        raise HTTPException(status_code=502, detail="STAR 改写失败") from exc
    return StarRewriteOut(result=result)


@router.post("/{resume_id}/writing/phrases", response_model=PhrasesOut)
async def phrases(
    request: Request,
    resume_id: int,
    payload: PhrasesRequest,
    db: Session = Depends(get_db),
):
    _load_record(db, resume_id)
    provider = _require_provider(db)
    db.close()
    try:
        result = await run_until_disconnect(
            request, generate_phrases(provider, payload.text, list(payload.modes)), what="话术生成"
        )
        if result is None:
            raise client_gone("话术生成")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"生成话术失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("生成话术发生内部错误")
        raise HTTPException(status_code=502, detail="生成话术失败") from exc
    return PhrasesOut(**result)


@router.post("/{resume_id}/writing/polish", response_model=PolishOut)
async def polish_resume(
    request: Request,
    resume_id: int,
    payload: PolishRequest,
    db: Session = Depends(get_db),
):
    _load_record(db, resume_id)
    provider = _require_provider(db)
    db.close()
    try:
        result = await run_until_disconnect(
            request, polish(provider, payload.text, payload.style), what="润色"
        )
        if result is None:
            raise client_gone("润色")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"润色失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("润色发生内部错误")
        raise HTTPException(status_code=502, detail="润色失败") from exc
    return PolishOut(result=result)


@router.post("/{resume_id}/writing/rewrite-field", response_model=RewriteFieldOut)
async def rewrite_resume_field(
    request: Request,
    resume_id: int,
    payload: RewriteFieldRequest,
    db: Session = Depends(get_db),
):
    """按用户要求重写简历里的某一栏，返回**建议**（不改动已保存的简历）。

    与 `writing/polish` 的区别：那个只知道"一段文本"，这个知道"这是哪一栏、它属于谁"，
    所以能听懂"这条要点补上数字""项目名别用缩写"这类针对具体位置的指令。

    不落库是刻意的：AI 不能静默改用户已经导出过的内容。前端把结果填进表单，
    用户看过、点保存，才算数。
    """
    record = _load_record(db, resume_id)
    content = ResumeContent.model_validate(record.content or {})
    try:
        target = resolve_field_target(content, payload.path)
    except FieldPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    provider = _require_provider(db)
    db.close()
    try:
        result = await run_until_disconnect(
            request, rewrite_field(provider, target, payload.instruction), what="改写"
        )
        if result is None:
            raise client_gone("改写")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"改写这一栏失败：{exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"改写这一栏失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 为用户提供可理解的失败提示
        logger.exception("字段改写发生内部错误")
        raise HTTPException(status_code=502, detail="改写这一栏失败") from exc
    return RewriteFieldOut(
        path=target.path,
        label=target.label,
        context=target.context,
        original=target.text,
        # 整段（lines）时 `result` 是逐条拼接版，`lines` 给逐条的原始结果；
        # 单段（text）时 `result` 就是那句改写，`lines` 留空。
        result="\n".join(result) if target.kind == "lines" else result[0],
        kind=target.kind,
        lines=result if target.kind == "lines" else [],
    )


@router.post("/{resume_id}/writing/translate", response_model=TranslateOut)
async def translate_resume(
    request: Request,
    resume_id: int,
    payload: TranslateRequest,
    db: Session = Depends(get_db),
):
    _load_record(db, resume_id)
    provider = _require_provider(db)
    db.close()
    try:
        result = await run_until_disconnect(
            request, translate(provider, payload.text, payload.direction), what="翻译"
        )
        if result is None:
            raise client_gone("翻译")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"翻译失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("翻译发生内部错误")
        raise HTTPException(status_code=502, detail="翻译失败") from exc
    return TranslateOut(result=result)


@selection_router.post("/polish-selection", response_model=PolishSelectionOut)
async def polish_selection_endpoint(
    request: Request, payload: PolishSelectionRequest, db: Session = Depends(get_db)
):
    """润色用户选中的那一段文字（全局 AI 润色）。

    **只处理请求体里的 ``text``**：这里既不读简历、也不知道这段文字属于哪一栏，
    所以不可能把整份简历送出去。结果只返回给前端，是否替换由用户点「替换选中」决定。
    """
    provider = _require_provider(db)
    db.close()
    try:
        result = await run_until_disconnect(
            request, polish_selection(provider, payload.text, payload.instruction), what="润色"
        )
        if result is None:
            raise client_gone("润色")
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=f"润色失败：{exc}") from exc
    except Exception as exc:  # noqa: BLE001 - 为用户提供可理解的失败提示
        logger.exception("选区润色发生内部错误")
        raise HTTPException(status_code=502, detail="润色失败") from exc
    return PolishSelectionOut(result=result)


@router.post("/{resume_id}/diff", response_model=ResumeDiffOut)
def diff_resume(resume_id: int, payload: ResumeDiffRequest, db: Session = Depends(get_db)):
    """两份简历的三态差异；纯本地计算，不调用模型。"""
    base = _load_record(db, resume_id)
    against = db.get(ResumeRecord, payload.against_id)
    if against is None or trash.is_deleted(against):
        raise HTTPException(status_code=404, detail="对比的简历记录不存在或已被删除")
    if against.id == base.id:
        raise HTTPException(status_code=400, detail="不能与同一份简历对比")
    return build_resume_diff(
        base.id,
        base.title,
        base.content or {},
        against.id,
        against.title,
        against.content or {},
    )


__all__ = ["router", "selection_router"]

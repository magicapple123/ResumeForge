# SPDX-License-Identifier: Apache-2.0
"""求职偏好接口（前缀 /api/job-preferences，期二 T12/T14 后端）。

薄路由：三条与助手工具同源的入口（GET / POST / PATCH）由 ActionSpec 生成
（add_action_route，与工具共用 input_model 与校验）；本文件只补工具侧没有的四个动作：

- DELETE /{pref_id}：软删进回收站（state 保持 active，只写 deleted_at）；
- POST /{pref_id}/undo：撤销到上一版（点按钮本身就是确认，**不进 proposal**，
  与"没有删除类工具"的既有口径一致）；409 稳定码 not_current / no_previous；
- POST /proposals/{proposal_id}/session：「只在这次对话」——读提案参数落一行
  kind=session_note、source=user_edited、source_proposal_id=提案，并把提案置 executed。
  「以后都这样」走既有 approve 端点（本文件不碰 api/assistant_proposals.py）。

错误形状与其他回收站/提案接口一致：404/409 用顶层 {detail, code}（前端按 code 分支），
422 来自 action 契约层（{"detail": {"code": "invalid_input", "message": ...}}）。
"""

from __future__ import annotations

import logging
from contextlib import suppress
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.assistant import AssistantWriteProposal
from ..models.profile import utcnow
from ..schemas.job_preference import (
    JobPreferenceDeleteOut,
    JobPreferenceOut,
    SessionProposalOut,
)
from ..services import job_preference_catalog as catalog
from ..services import job_preference_service as service
from ..services.actions import add_action_route
from ..services.actions.catalog import all_actions
from ..services.assistant_tools import proposal_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/job-preferences", tags=["job-preferences"])

_SESSION_NOTE_SUMMARY = "仅本次对话，未长期生效"

# 与工具同源的三条：GET 列表+目录 / POST 直接编辑 / PATCH 直接编辑。
add_action_route(router, all_actions()["get_job_preferences"], route_path="")
add_action_route(router, all_actions()["create_job_preference"], route_path="")
add_action_route(router, all_actions()["update_job_preference"])


def _conflict(message: str, code: str) -> JSONResponse:
    """409：顶层 detail + 稳定 code（与 /api/trash 的恢复冲突同一形状）。"""
    return JSONResponse(status_code=409, content={"detail": message, "code": code})


def _out(db: Session, record) -> JobPreferenceOut:
    return JobPreferenceOut.from_record(record, has_previous=service.has_previous(db, record))


@router.delete("/{pref_id}", response_model=JobPreferenceDeleteOut)
def delete_job_preference(pref_id: str, db: Session = Depends(get_db)):
    """删除一条偏好（软删进回收站；恢复走 /api/trash/job_preference/{id}/restore）。"""
    try:
        record = service.delete_preference(db, pref_id)
    except service.PreferenceConflict as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    db.commit()
    logger.info("求职偏好已移入回收站 pref_id=%s", pref_id)
    # id 是回收站恢复接口要的行 id（前端 5 秒「撤销」Toast 用它），不只是内部字段。
    return JobPreferenceDeleteOut(pref_id=pref_id, id=record.id)


@router.post("/{pref_id}/undo", response_model=JobPreferenceOut)
def undo_job_preference(pref_id: str, db: Session = Depends(get_db)):
    """撤销到上一版：当前 → undone，最近一条 superseded → active。"""
    try:
        record = service.undo_preference(db, pref_id)
    except service.PreferenceConflict as exc:
        return _conflict(exc.message, exc.code)
    return _out(db, record)


@router.post("/proposals/{proposal_id}/session", response_model=SessionProposalOut)
def record_session_only(proposal_id: str, db: Session = Depends(get_db)):
    """「只在这次对话」：把待确认提案转成 session_note，并把提案置 executed。

    - 只接受 pending 的偏好写入提案（create_job_preference / update_job_preference）；
    - 用条件 UPDATE（pending → executed）占用提案，双击并发只有一个能成功；
    - 参数校验与落库复用服务层，session_note 永不进系统提示注入块。
    """
    proposal = (
        db.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal_id)
        .one_or_none()
    )
    if proposal is None:
        raise HTTPException(status_code=404, detail="提案不存在或已失效")
    if proposal.dataset_key != service.current_dataset_key():
        return _conflict("数据集已切换，本提案失效", "dataset_mismatch")
    if utcnow() >= proposal.expires_at:
        return _conflict("提案已过期，请让助手重新发起", "proposal_not_pending")
    if proposal.status != "pending":
        return _conflict(
            f"提案当前状态为 {proposal.status}，不能只用于本次对话", "proposal_not_pending"
        )
    if proposal.tool_name not in service.PREFERENCE_WRITE_TOOLS:
        return _conflict(f"提案 {proposal.tool_name} 不是求职偏好写入", "unsupported_tool")
    arguments = dict(proposal.arguments or {})
    try:
        service.build_session_note_text(db, proposal.tool_name, arguments)
    except catalog.PreferenceValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # 条件 UPDATE 占住提案：与随后的 session_note 写入同一事务提交，失败一起回滚。
    # 条件写要读 `rowcount`；`execute` 的静态返回类型是 `Result`，显式收窄成
    # DML 的运行时真实类型（同 services/resume/document_save.py）。
    claimed = cast(
        "CursorResult[Any]",
        db.execute(
            update(AssistantWriteProposal)
            .where(
                AssistantWriteProposal.proposal_id == proposal_id,
                AssistantWriteProposal.status == "pending",
            )
            .values(
                status="executed",
                result_summary=_SESSION_NOTE_SUMMARY,
                executed_at=utcnow(),
            )
        ),
    )
    if claimed.rowcount != 1:
        db.rollback()
        return _conflict("提案状态已变化，不能只用于本次对话", "proposal_not_pending")
    try:
        result = service.record_session_note(
            db,
            proposal_id=proposal_id,
            tool_name=proposal.tool_name,
            arguments=arguments,
        )
    except Exception:
        db.rollback()
        raise
    # 派生回写（proposal_result 消息）是 best-effort：状态已落库，失败不影响本次结果。
    with suppress(Exception):
        proposal_store.mark_executed(proposal_id, _SESSION_NOTE_SUMMARY)
    logger.info("提案 %s 仅用于本次对话（pref_id=%s）", proposal_id, result.record.pref_id)
    return SessionProposalOut(
        pref=_out(db, result.record),
        proposal_id=proposal_id,
        proposal_status="executed",
        summary=_SESSION_NOTE_SUMMARY,
    )


__all__ = ["router"]

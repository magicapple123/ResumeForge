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

T2：条件 UPDATE 与校验/落库编排已下沉到 `services/job_preference_proposals.py`；
本模块只做路由装配、HTTP 错误映射与响应构造。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.job_preference import (
    JobPreferenceDeleteOut,
    JobPreferenceOut,
    SessionProposalOut,
)
from ..services import job_preference_proposals
from ..services import job_preference_service as service
from ..services.actions import add_action_route
from ..services.actions.catalog import registered_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/job-preferences", tags=["job-preferences"])

# 与工具同源的三条：GET 列表+目录 / POST 直接编辑 / PATCH 直接编辑。
add_action_route(router, registered_action("get_job_preferences"), route_path="")
add_action_route(router, registered_action("create_job_preference"), route_path="")
add_action_route(router, registered_action("update_job_preference"))


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
    try:
        result = job_preference_proposals.record_session_only(db, proposal_id)
    except job_preference_proposals.SessionProposalNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.PreferenceConflict as exc:
        return _conflict(exc.message, exc.code)
    except job_preference_proposals.SessionProposalInvalid as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return SessionProposalOut(
        pref=_out(db, result.record),
        proposal_id=proposal_id,
        proposal_status="executed",
        summary=result.summary,
    )


__all__ = ["router"]

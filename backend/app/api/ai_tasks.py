# SPDX-License-Identifier: Apache-2.0
"""通用 AI 任务接口（prefix ``/api/ai-tasks``）。

**为什么是这四支**：前端只需要"建、看、看全部、停"四件事。任务一旦建起来就与 HTTP 连接
无关（handler 在后台线程跑，见 ``services/ai_task_runner.py``），所以没有"流式响应"这种
形态——连接断了任务照跑，前端重连后照样能查到状态。

**取消是协作式**：``POST /{id}/cancel`` 先给执行体发信号（让它真的停下、别再烧 token），
再把状态落成 ``canceled``。已到终态的任务取消**幂等**——直接回当前快照，不报错，
因为"刚好跑完"不是用户的错。

路由顺序：``/active`` 必须排在 ``/{task_id}`` 之前，否则字面量段会被参数段抢先解析
（FastAPI 会尝试把 "active" 转成 int 并回 422）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.ai_task import AI_TASK_ACTIVE_STATUSES, AiTask
from ..schemas.ai_task import AiTaskCreateRequest, AiTaskOut
from ..services.ai_task_registry import get_ai_task_handler
from ..services.ai_task_runner import (
    AiTaskNotFoundError,
    AiTaskRunnerError,
    get_ai_task_runner,
)

router = APIRouter(prefix="/api/ai-tasks", tags=["ai-tasks"])
logger = logging.getLogger(__name__)


@router.post("", response_model=AiTaskOut, status_code=201)
def create_ai_task(payload: AiTaskCreateRequest, db: Session = Depends(get_db)):
    """登记并启动一次 AI 任务，立即返回 ``{id, status}``（不等它跑完）。"""
    if get_ai_task_handler(payload.kind) is None:
        # 类型不认识就直接拒绝：不猜默认 handler，也不留一条永远 pending 的行。
        raise HTTPException(status_code=400, detail=f"未注册的任务类型：{payload.kind}")
    task = AiTask(kind=payload.kind, payload=payload.payload, label=payload.label)
    db.add(task)
    db.commit()
    db.refresh(task)
    try:
        get_ai_task_runner().start(task.id)
    except (AiTaskRunnerError, AiTaskNotFoundError) as exc:
        # 启动失败也必须留下明确终态，不能制造幽灵 pending 行。
        get_ai_task_runner().mark_failed(task.id, str(exc))
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.expire_all()
    refreshed = db.get(AiTask, task.id)
    return AiTaskOut.model_validate(refreshed or task)


@router.get("/active", response_model=list[AiTaskOut])
def list_active_ai_tasks(db: Session = Depends(get_db)):
    """当前还在跑的任务（前端刷新后据此恢复页头任务面板与轮询）。"""
    rows = (
        db.query(AiTask)
        .filter(AiTask.status.in_(AI_TASK_ACTIVE_STATUSES))
        .order_by(AiTask.id.desc())
        .limit(50)
        .all()
    )
    return [AiTaskOut.model_validate(row) for row in rows]


@router.get("/{task_id}", response_model=AiTaskOut)
def get_ai_task(task_id: int, db: Session = Depends(get_db)):
    """查一次任务状态（前端 1.5s 轮询）。"""
    task = db.get(AiTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="AI 任务不存在或已被删除")
    return AiTaskOut.model_validate(task)


@router.post("/{task_id}/cancel", response_model=AiTaskOut)
def cancel_ai_task(task_id: int, db: Session = Depends(get_db)):
    """协作式取消；已完成 / 已失败的任务幂等返回当前快照。"""
    try:
        task = get_ai_task_runner().cancel(task_id)
    except AiTaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AiTaskRunnerError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # 执行器用的是自己的会话（冻结引擎），这里换回请求会话重新读一次给前端。
    db.expire_all()
    refreshed = db.get(AiTask, task_id)
    return AiTaskOut.model_validate(refreshed or task)


__all__ = ["router"]

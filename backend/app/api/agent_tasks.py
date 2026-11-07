# SPDX-License-Identifier: Apache-2.0
"""Agent 任务接口（prefix `/api/agent-tasks`，T19）。

**只做参数校验、调用服务、组装响应**：状态机、幂等与数据集归属都在
`services/agent_task_service.py`；本层的职责是把 `ValueError`（非法迁移）映射成 409、
`LookupError`（不存在/不属于当前数据集）映射成 404，不静默且不泄露跨数据集的存在性。

请求模型全部 `extra="forbid"`：多一个字段就 422，避免前端把任意参数塞进服务层。
`dataset_key` 不出现在请求里——它由服务层从 `dataset_scope.current_dataset_id()` 写入
并在每次读写时核对，调用方无法指定"改哪个数据集"。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.agent_task import AGENT_TASK_SOURCE_MANUAL
from ..services import agent_task_service
from ..services.agent_task_service import AgentTaskError, AgentTaskNotFound

router = APIRouter(prefix="/api/agent-tasks", tags=["agent-tasks"])


# ===== 请求/响应模型（本地定义：schemas/ 目录本轮不在改动范围内） =====


class AgentTaskStepIn(BaseModel):
    """建任务时的一步：字符串形式等价于只给 `title` 的对象形式。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    kind: str = Field(default="", max_length=32)


class AgentTaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    steps: list[str | AgentTaskStepIn] = Field(min_length=1, max_length=50)
    conversation_id: int | None = Field(default=None, ge=1)
    goal: str = Field(default="", max_length=2000)
    source: str = Field(default=AGENT_TASK_SOURCE_MANUAL, min_length=1, max_length=32)


class AgentTaskCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    output_ref: dict[str, Any] | None = None
    attempt: int | None = Field(default=None, ge=1)


class AgentTaskStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    step_index: int
    kind: str
    title: str
    status: str
    input_digest: str
    output_ref: dict[str, Any] | None
    attempt: int
    error: str
    started_at: datetime | None
    finished_at: datetime | None


class AgentTaskOut(BaseModel):
    """任务详情；列表接口也复用它（`steps` 就是列表需要的步骤摘要）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int | None
    title: str
    goal: str
    status: str
    resume_cursor: int
    source: str
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None
    error: str
    steps: list[AgentTaskStepOut]


# ===== 路由 =====


@router.get("", response_model=list[AgentTaskOut])
def list_agent_tasks(
    conversation_id: int | None = Query(default=None, ge=1),
    status: str | None = Query(default=None, max_length=24),
    db: Session = Depends(get_db),
):
    """当前数据集的任务列表（新→旧），可按会话 / 状态过滤。"""
    try:
        tasks = agent_task_service.list_tasks(db, conversation_id=conversation_id, status=status)
    except AgentTaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [AgentTaskOut.model_validate(task) for task in tasks]


@router.post("", response_model=AgentTaskOut, status_code=201)
def create_agent_task(payload: AgentTaskCreateRequest, db: Session = Depends(get_db)):
    """建一个 draft 任务（步骤顺序落库，`resume_cursor=0`）。"""
    steps = [step if isinstance(step, str) else step.model_dump() for step in payload.steps]
    try:
        task = agent_task_service.create_task(
            db,
            title=payload.title,
            steps=steps,
            conversation_id=payload.conversation_id,
            goal=payload.goal,
            source=payload.source,
        )
    except AgentTaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.post("/{task_id}/start", response_model=AgentTaskOut)
def start_agent_task(task_id: int, db: Session = Depends(get_db)):
    """开始任务：draft → running（幂等：已 running 时返回当前快照）。"""
    try:
        task = agent_task_service.start(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.get("/{task_id}", response_model=AgentTaskOut)
def get_agent_task(task_id: int, db: Session = Depends(get_db)):
    """任务详情（含全部步骤）。"""
    try:
        task = agent_task_service.get_task(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.post("/{task_id}/steps/{step_index}/complete", response_model=AgentTaskOut)
def complete_agent_task_step(
    task_id: int,
    step_index: int,
    payload: AgentTaskCompleteRequest,
    db: Session = Depends(get_db),
):
    """完成当前步骤并推进游标；重复调用同一步是幂等空转（不产生第二次副作用）。"""
    try:
        task = agent_task_service.advance_step(
            db,
            task_id,
            step_index,
            output_ref=payload.output_ref,
            attempt=payload.attempt,
        )
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.post("/{task_id}/steps/{step_index}/wait-approval", response_model=AgentTaskOut)
def wait_approval_agent_task_step(
    task_id: int,
    step_index: int,
    db: Session = Depends(get_db),
):
    """把**当前步骤**置 waiting_approval（任务一起进入）；重复调用幂等。

    只有用户的显式调用能进入/推进这个状态——启动恢复不会放行它（T18 §2）。
    """
    try:
        task = agent_task_service.wait_approval_for_step(db, task_id, step_index)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.post("/{task_id}/pause", response_model=AgentTaskOut)
def pause_agent_task(task_id: int, db: Session = Depends(get_db)):
    """暂停任务（幂等：已暂停时返回当前快照）。"""
    try:
        task = agent_task_service.pause(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.post("/{task_id}/resume", response_model=AgentTaskOut)
def resume_agent_task(task_id: int, db: Session = Depends(get_db)):
    """从 paused 恢复；等待审批中的步骤恢复后仍停在 waiting_approval。"""
    try:
        task = agent_task_service.resume(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


@router.post("/{task_id}/cancel", response_model=AgentTaskOut)
def cancel_agent_task(task_id: int, db: Session = Depends(get_db)):
    """取消任务（幂等：已取消时返回当前快照）；未完成步骤置 skipped。"""
    try:
        task = agent_task_service.cancel(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AgentTaskOut.model_validate(task)


__all__ = ["router"]

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

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.agent_task import AGENT_TASK_SOURCE_MANUAL, AgentTask
from ..services import agent_task_service
from ..services.agent_task_service import AgentTaskError, AgentTaskNotFound
from ..services.reminder_task_context import reminder_card_contexts
from ..services.tracker import job_ids_for_tracks

router = APIRouter(prefix="/api/agent-tasks", tags=["agent-tasks"])

# 与 task_tools.ASSISTANT_TASK_SOURCE 逐字一致：只有助手建的任务才自动跑后台执行器，
# 手动/提醒/跟进卡仍走既有 REST 状态机（行为不变）。
_ASSISTANT_TASK_SOURCE = "assistant"


def _kick_assistant_runner(task: Any) -> None:
    """助手任务进入 running 后拉起后台执行器（单例线程；已在跑则排队）。

    不丢弃这个调用：任务此刻已是 running，若执行器忙就不管它，就没有任何线程会推进它。
    执行器忙时把任务 id 排队，前一个任务到终态/暂停后自动开始下一个。

    局部导入：执行器会 import 四个 handler（连带岗位/简历/抓取服务），放在模块顶层会让
    所有只读任务接口都背上这份 import 成本。
    """
    if getattr(task, "source", "") != _ASSISTANT_TASK_SOURCE:
        return
    from ..services.assistant_task_runner import runner

    runner.start(int(task.id))


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
    # #18A 执行所需的最小输入（白名单由服务层校验）；不出现在前端展示里。
    params: dict[str, Any] | None = None


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
    # CR-19：只读派生字段——这一步指向的岗位（由 ``output_ref.track_id`` 批查询补）。
    # 首页任务卡用它把步骤行链到 ``/tracker?job_id=``；补不出来就是 None，界面不渲染链接。
    job_id: int | None = None


class AgentTaskReminderOut(BaseModel):
    """提醒来源的上下文（CR-20）：任务卡改成"提醒行"后要显示的那一行。

    只在 ``source == "reminder"`` 时下发。``due_at`` 用任务自己的
    ``occurrence_due_at``（这一张卡对应**那一次**到期），提醒后来改期不该改历史卡上的时间。
    ``deleted`` 覆盖两种"提醒不在了"：进了回收站（``deleted_at`` 非空）与行已被彻底删除
    （查不到）——两种情况卡上都不给跳转链接。
    """

    id: int
    title: str = ""
    kind: str = ""
    due_at: datetime | None = None
    company: str = ""
    job_title: str = ""
    deleted: bool = False


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
    # #18A：执行参数可选下发（前端不展示原文；执行器与排障需要时读取）。
    params: dict[str, Any] | None = None
    steps: list[AgentTaskStepOut]
    # CR-20：提醒卡的来源上下文（批查询补齐；其它来源为 None）。
    reminder: AgentTaskReminderOut | None = None


def _reminder_contexts(
    db: Session, tasks: Sequence[AgentTask]
) -> dict[int, AgentTaskReminderOut]:
    """按任务批量补齐提醒上下文（取数在 service 层，api 层不构造查询）。

    没有 ``reminder_id`` 的卡（手动、助手、巡检）不进结果，响应里就是 ``reminder=null``。
    """
    return {
        task_id: AgentTaskReminderOut(
            id=context.id,
            title=context.title,
            kind=context.kind,
            due_at=context.due_at,
            company=context.company,
            job_title=context.job_title,
            deleted=context.deleted,
        )
        for task_id, context in reminder_card_contexts(db, tasks).items()
    }


def _step_track_ids(payloads: Sequence[AgentTaskOut]) -> set[int]:
    """响应里所有步骤引用的进度 id（``output_ref.track_id``）。

    只认整数：``output_ref`` 是 JSON，历史数据里出现过字符串/布尔值，把它们当 id 去查
    等于拿脏数据换一次无意义的全表扫描。
    """
    found: set[int] = set()
    for payload in payloads:
        for step in payload.steps:
            value = (step.output_ref or {}).get("track_id")
            if isinstance(value, int) and not isinstance(value, bool):
                found.add(value)
    return found


def _attach_step_job_ids(db: Session, payloads: Sequence[AgentTaskOut]) -> None:
    """把步骤的 ``job_id`` 补上（一次批查询，不逐步骤查库）。

    ``job_id`` 落在 ``application_track`` 上；步骤只记 ``track_id``。旧卡（没有
    ``output_ref``）、进度已删除、进度没挂岗位这三种情况都补不出来——留 None，
    界面据此不渲染岗位链接，任务本身照常展示。
    """
    track_ids = _step_track_ids(payloads)
    if not track_ids:
        return
    job_by_track = job_ids_for_tracks(db, sorted(track_ids))
    for payload in payloads:
        steps = []
        for step in payload.steps:
            raw_track = (step.output_ref or {}).get("track_id")
            track_id = raw_track if isinstance(raw_track, int) else None
            steps.append(
                step.model_copy(
                    update={
                        "job_id": job_by_track.get(track_id) if track_id is not None else None
                    }
                )
            )
        payload.steps = steps


def _task_out(db: Session, task: AgentTask) -> AgentTaskOut:
    """单个任务 → 响应（附带提醒上下文与步骤岗位）。"""
    payload = AgentTaskOut.model_validate(task)
    context = _reminder_contexts(db, [task]).get(task.id)
    if context is not None:
        payload = payload.model_copy(update={"reminder": context})
    _attach_step_job_ids(db, [payload])
    return payload


def _notify_waiting_approval(db: Session, task: AgentTask, step_index: int) -> None:
    """「需要你确认」通知（CR-29）：任务卡在 waiting_approval 时写一条 inbox 行。

    通道呈现（toast / 桌面通知）由前端按同一份开关决定；这里只负责**事件落库**，
    这样"当时有没有提醒过"可回看。关掉开关时不写（决策类默认开）。
    ``dedupe_key`` 带 step_index：同一步重复调用幂等，换一步再提醒一次。
    """
    from ..services.notification_settings import notify_allowed
    from ..services.notifications import emit

    if not notify_allowed(db, "task_waiting"):
        return
    title = task.title.strip() or "助手任务"
    context = _reminder_contexts(db, [task]).get(task.id)
    body = context.title if context is not None else "有一步需要你确认后才能继续"
    emit(
        db,
        type="agent_task",
        severity="warning",
        title=f"「{title}」等你确认",
        body=body,
        deep_link="/",
        dedupe_key=f"agent-task-waiting:{task.id}:{step_index}",
    )
    db.commit()


def _task_out_many(db: Session, tasks: Sequence[AgentTask]) -> list[AgentTaskOut]:
    """列表 → 响应；提醒上下文与步骤岗位各一次批查询补齐。"""
    contexts = _reminder_contexts(db, tasks)
    payloads = [
        AgentTaskOut.model_validate(task).model_copy(update={"reminder": contexts.get(task.id)})
        if task.id in contexts
        else AgentTaskOut.model_validate(task)
        for task in tasks
    ]
    _attach_step_job_ids(db, payloads)
    return payloads


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
    return _task_out_many(db, tasks)


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
            params=payload.params,
        )
    except AgentTaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _task_out(db, task)


@router.post("/{task_id}/start", response_model=AgentTaskOut)
def start_agent_task(task_id: int, db: Session = Depends(get_db)):
    """开始任务：draft → running（幂等：已 running 时返回当前快照）。"""
    try:
        task = agent_task_service.start(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _kick_assistant_runner(task)
    return _task_out(db, task)


@router.get("/{task_id}", response_model=AgentTaskOut)
def get_agent_task(task_id: int, db: Session = Depends(get_db)):
    """任务详情（含全部步骤）。"""
    try:
        task = agent_task_service.get_task(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _task_out(db, task)


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
    return _task_out(db, task)


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
    _notify_waiting_approval(db, task, step_index)
    return _task_out(db, task)


@router.post("/{task_id}/pause", response_model=AgentTaskOut)
def pause_agent_task(task_id: int, db: Session = Depends(get_db)):
    """暂停任务（幂等：已暂停时返回当前快照）。"""
    try:
        task = agent_task_service.pause(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _task_out(db, task)


@router.post("/{task_id}/resume", response_model=AgentTaskOut)
def resume_agent_task(task_id: int, db: Session = Depends(get_db)):
    """从 paused 恢复；等待审批中的步骤恢复后仍停在 waiting_approval。"""
    try:
        task = agent_task_service.resume(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # 用户点「继续」后同样从 resume_cursor 拉起执行器（助手任务才会）。
    _kick_assistant_runner(task)
    return _task_out(db, task)


@router.post("/{task_id}/cancel", response_model=AgentTaskOut)
def cancel_agent_task(task_id: int, db: Session = Depends(get_db)):
    """取消任务（幂等：已取消时返回当前快照）；未完成步骤置 skipped。"""
    try:
        task = agent_task_service.cancel(db, task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentTaskError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _task_out(db, task)


__all__ = ["router"]

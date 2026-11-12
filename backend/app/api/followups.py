# SPDX-License-Identifier: Apache-2.0
"""跟进巡检的决策端点（``POST /api/followups/decisions``，期一 T04）。

契约见 ``D:/rf_verify/contracts/CONTRACTS.md`` A 节。三个不能退让的性质：

1. **整卡一次事务**：5 家一起提交，要么全落库、要么全不落；中途失败不能留下"前两家
   记了、后三家没记"的半张卡。
2. **幂等**：重复点提交不新增 ``application_follow_up`` 行；已 done 的 step 直接跳过，
   全部命中已处理时 ``created_rows=0``、``idempotent=true``。
3. **绝不写 ``application_track``**：决策描述"用户对这张卡做了什么"，不是漏斗推进。
   "对方已回"若映射成"筛选中"，在用户已手工推到「面试」的记录上会被 ``resolve_status``
   原样吞掉——按钮点了没反应，比改错更难查（理由详见 models/followup.py）。

**不走 ``advance_step``**：它的"不能跳步"是给有依赖的连续步骤设计的；卡里 5 家彼此
独立，强制顺序只会逼用户按顺序点。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STEP_STATUS_DONE,
    AgentTaskStep,
)
from ..models.followup import ApplicationFollowUp
from ..models.profile import utcnow
from ..schemas.followup import (
    FollowupDecisionsOut,
    FollowupDecisionsRequest,
    FollowupDecisionStepOut,
)
from ..services import agent_task_service, tracker_query
from ..services.agent_task_service import AgentTaskNotFound

router = APIRouter(prefix="/api/followups", tags=["followups"])


def _step_track_id(step: AgentTaskStep) -> int | None:
    """从 step.output_ref 里取 track_id；缺了/坏了的步骤不参与决策匹配。"""
    output_ref = step.output_ref or {}
    value = output_ref.get("track_id")
    # bool 是 int 的子类，单独排除：``{"track_id": true}`` 不是合法岗位 id。
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return None
    return value


def _step_out(step: AgentTaskStep) -> FollowupDecisionStepOut:
    return FollowupDecisionStepOut.model_validate(step)


def _join_ids(ids: list[int]) -> str:
    return "、".join(str(item) for item in ids)


@router.post("/decisions", response_model=FollowupDecisionsOut)
def decide_followups(payload: FollowupDecisionsRequest, db: Session = Depends(get_db)):
    """整卡提交：每家写一条决策 + 对应 step 置 done；全部 done 后卡转 done。"""
    try:
        task = agent_task_service.get_task(db, payload.task_id)
    except AgentTaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if task.source != AGENT_TASK_SOURCE_FOLLOWUP:
        raise HTTPException(status_code=409, detail="这张任务卡不是跟进巡检卡，不能提交跟进决策")

    steps_by_track: dict[int, AgentTaskStep] = {}
    for step in task.steps:
        track_id = _step_track_id(step)
        if track_id is not None:
            steps_by_track[track_id] = step
    unknown = [item.track_id for item in payload.decisions if item.track_id not in steps_by_track]
    if unknown:
        raise HTTPException(status_code=422, detail=f"任务卡里没有这些岗位：{_join_ids(unknown)}")

    # 外键要求进度记录存在；已软删的仍允许（历史决策与回收站恢复后语义一致）。
    decided_track_ids = [item.track_id for item in payload.decisions]
    existing_ids = tracker_query.existing_track_ids(db, decided_track_ids)
    missing = [track_id for track_id in decided_track_ids if track_id not in existing_ids]
    if missing:
        raise HTTPException(
            status_code=422, detail=f"这些岗位的进度记录不存在：{_join_ids(missing)}"
        )

    moment = utcnow()
    created_rows = 0
    for item in payload.decisions:
        step = steps_by_track[item.track_id]
        if step.status == AGENT_TASK_STEP_STATUS_DONE:
            # 幂等：这一家已经处理过，不新增行、不覆盖原有的决策时刻。
            continue
        db.add(
            ApplicationFollowUp(
                track_id=item.track_id,
                decided_at=moment,
                decision=item.decision,
                task_id=task.id,
            )
        )
        step.status = AGENT_TASK_STEP_STATUS_DONE
        step.finished_at = moment
        created_rows += 1

    if all(step.status == AGENT_TASK_STEP_STATUS_DONE for step in task.steps):
        task.status = AGENT_TASK_STATUS_DONE
        task.finished_at = task.finished_at or moment
        # 模型注释的口径：全部完成时游标等于步骤总数（这里不走 advance_step，
        # 但保持"完成度"字段与既有读法一致）。
        task.resume_cursor = len(task.steps)
    task.updated_at = moment

    db.commit()
    db.refresh(task)
    return FollowupDecisionsOut(
        task_id=task.id,
        status=task.status,
        decided=len(payload.decisions),
        created_rows=created_rows,
        idempotent=created_rows == 0,
        steps=[_step_out(step) for step in task.steps],
    )


__all__ = ["router"]

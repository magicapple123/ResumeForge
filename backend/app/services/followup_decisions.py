# SPDX-License-Identifier: Apache-2.0
"""从 ``followup_sweep`` 拆出：跟进巡检卡的整卡决策（校验 + 批量落库）。

纯搬迁：事务边界仍在路由（本模块**不提交**），巡检/建卡逻辑留在 ``followup_sweep``。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models.agent_task import (
    AGENT_TASK_SOURCE_FOLLOWUP,
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STEP_STATUS_DONE,
    AgentTask,
    AgentTaskStep,
)
from ..models.followup import ApplicationFollowUp
from ..models.profile import utcnow
from ..schemas.followup import FollowupDecisionsRequest
from . import agent_task_service, tracker_query
from .agent_task_service import AgentTaskNotFound


# ----- 整卡决策（T2：从 api/followups.py 下沉；事务边界留在路由）-----
@dataclass(frozen=True)
class FollowupDecisionResult:
    """一次整卡决策的结果：任务行 + 本次新增的决策行数（响应组装留在路由）。"""

    task: AgentTask
    decided: int
    created_rows: int


class FollowupDecisionError(Exception):
    """决策请求的前置条件不满足：status_code / detail 由路由映射成 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def decide_followups(db: Session, payload: FollowupDecisionsRequest) -> FollowupDecisionResult:
    """整卡提交：每家写一条决策 + 对应 step 置 done；全部 done 后卡转 done。

    **不提交**：整卡一次事务是路由的边界，中途失败由路由回滚。
    """
    try:
        task = agent_task_service.get_task(db, payload.task_id)
    except AgentTaskNotFound as exc:
        raise FollowupDecisionError(404, str(exc)) from exc
    if task.source != AGENT_TASK_SOURCE_FOLLOWUP:
        raise FollowupDecisionError(409, "这张任务卡不是跟进巡检卡，不能提交跟进决策")

    steps_by_track: dict[int, AgentTaskStep] = {}
    for step in task.steps:
        # 从 step.output_ref 里取 track_id；缺了/坏了的步骤不参与决策匹配。
        # bool 是 int 的子类，单独排除：{"track_id": true} 不是合法岗位 id。
        track_id = (step.output_ref or {}).get("track_id")
        if isinstance(track_id, int) and not isinstance(track_id, bool) and track_id >= 1:
            steps_by_track[track_id] = step
    unknown = [item.track_id for item in payload.decisions if item.track_id not in steps_by_track]
    if unknown:
        ids = "、".join(str(item) for item in unknown)
        raise FollowupDecisionError(422, f"任务卡里没有这些岗位：{ids}")

    # 外键要求进度记录存在；已软删的仍允许（历史决策与回收站恢复后语义一致）。
    decided_track_ids = [item.track_id for item in payload.decisions]
    existing_ids = tracker_query.existing_track_ids(db, decided_track_ids)
    missing = [track_id for track_id in decided_track_ids if track_id not in existing_ids]
    if missing:
        ids = "、".join(str(track_id) for track_id in missing)
        raise FollowupDecisionError(422, f"这些岗位的进度记录不存在：{ids}")

    moment = utcnow()
    created_rows = 0
    for item in payload.decisions:
        step = steps_by_track[item.track_id]
        if step.status == AGENT_TASK_STEP_STATUS_DONE:
            # 幂等：这一家已经处理过，不新增行、不覆盖原有的决策时刻。
            continue
        db.add(
            ApplicationFollowUp(
                track_id=item.track_id, decided_at=moment, decision=item.decision, task_id=task.id
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
    return FollowupDecisionResult(task, len(payload.decisions), created_rows)

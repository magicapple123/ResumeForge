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

T2：业务决策（校验 + 批量落库）已下沉到 ``services/followup_sweep.py::decide_followups``；
本模块只做路由装配、HTTP 错误映射与响应构造，一次提交留在本层。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.followup import (
    FollowupDecisionsOut,
    FollowupDecisionsRequest,
    FollowupDecisionStepOut,
)
from ..services.followup_sweep import (
    FollowupDecisionError,
)
from ..services.followup_sweep import (
    decide_followups as decide_followups_record,
)

router = APIRouter(prefix="/api/followups", tags=["followups"])


def _step_out(step) -> FollowupDecisionStepOut:
    return FollowupDecisionStepOut.model_validate(step)


@router.post("/decisions", response_model=FollowupDecisionsOut)
def decide_followups(payload: FollowupDecisionsRequest, db: Session = Depends(get_db)):
    """整卡提交：每家写一条决策 + 对应 step 置 done；全部 done 后卡转 done。"""
    try:
        result = decide_followups_record(db, payload)
    except FollowupDecisionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    # 事务边界在本层：服务只做 add/字段改写，提交与刷新由路由收尾（整卡一次事务）。
    db.commit()
    db.refresh(result.task)
    return FollowupDecisionsOut(
        task_id=result.task.id,
        status=result.task.status,
        decided=result.decided,
        created_rows=result.created_rows,
        idempotent=result.created_rows == 0,
        steps=[_step_out(step) for step in result.task.steps],
    )


__all__ = ["router"]

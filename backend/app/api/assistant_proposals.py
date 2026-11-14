# SPDX-License-Identifier: Apache-2.0
"""写入提案的批准/拒绝/状态端点（RF-01，PR-02/PR-03 修复版 + T01）。

批准 = "校验 → 置 approved + 签发一次性 token → 核销 → 用**存储的参数**执行
handler → 置 executed/failed/unknown"在同一次请求里完成。token 只在服务端内存流转，
不回传前端、绝不进入模型消息。

T01 在既有语义上补三处：
- **批准前重查目标**：用存储参数重算写工具预览，与创建时的目标指纹不一致就 409
  「数据已变化」，并把提案置为失效——绝不用旧快照执行；
- **状态单一事实源**：终态写回 assistant_write_proposal 表，下一轮对话据此回答；
- **派生回写**：五条终态各补一条 kind=proposal_result 的会话消息（best-effort，
  写失败不影响状态正确性，也绝不回滚已提交的写入）。

执行段的身份与租约（PR-03）保持不变：先取租约再批准执行，冻结工厂从租约身份派生，
执行与提交始终落在批准时刻的那份数据集上。

T2：批准状态机已整体下沉到 `services/assistant/proposal_approval.py`；本模块只做
HTTP 错误映射与响应组装，并把"执行段收尾提交"这一事务边界以 `commit` 回调注入服务。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.assistant.proposal_approval import (
    ProposalApprovalError,
    execute_proposal_approval,
)
from ..services.assistant_tools.authorization import (
    WriteProposalError,
    get_proposal,
    reject_proposal,
)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def _error(exc: WriteProposalError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _commit(session: Session) -> None:
    """事务边界在路由层：服务的执行段收尾提交委派回这里（提交失败由服务判 unknown）。"""
    session.commit()


@router.post("/write-proposals/{proposal_id}/approve")
async def approve_write_proposal(proposal_id: str) -> dict:
    """批准并立即执行一条写入提案（一次性）。

    返回执行结果摘要与提案终态；重复批准/重放/跨数据集/过期/目标已变化都是 409，
    不存在的提案是 404。执行与提交处于同一数据集身份（租约 + 冻结工厂），
    各类失败都进入可解释终态并如实返回。
    """
    try:
        result = await execute_proposal_approval(proposal_id, commit=_commit)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    except ProposalApprovalError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return {
        "proposal": result.proposal.model_dump(mode="json"),
        "summary": result.summary,
        "changed": result.changed,
    }


@router.post("/write-proposals/{proposal_id}/reject")
def reject_write_proposal(
    proposal_id: str, db: Session = Depends(get_db)
) -> dict:
    try:
        proposal = reject_proposal(proposal_id, db=db)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    return {"proposal": proposal.model_dump(mode="json")}


@router.get("/write-proposals/{proposal_id}")
def read_write_proposal(proposal_id: str, db: Session = Depends(get_db)) -> dict:
    """前端卡片刷新状态用：404 表示提案已失效（重启或未存在）。

    注意：提案行存在该数据集自己的库文件里，所以切换到另一个数据集后按 id 查不到，
    返回 404（不暴露其他作用域的提案详情）。同一数据集内 A→B→A 的过期提案仍由
    作用域校验返回 409。
    """
    try:
        proposal = get_proposal(proposal_id, db=db)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    return {"proposal": proposal.model_dump(mode="json")}

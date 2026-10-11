"""写入提案的批准/拒绝端点（RF-01）。

批准 = "校验 → 置 approved + 签发一次性 token → 核销 → 用**存储的参数**执行
handler → 置 executed/failed"在同一次请求里完成。token 只在服务端内存流转，
不回传前端、绝不进入模型消息。执行用的会话工厂是当前身份的冻结工厂（RF-03）：
approve 时已校验提案归属当前数据集，跨数据集提案在这里被 409 挡下。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..runtime import dataset_scope
from ..services.assistant_tools import get_tool
from ..services.assistant_tools import policy as tool_policy
from ..services.assistant_tools.authorization import (
    WriteProposalError,
    approve_proposal,
    consume,
    get_proposal,
    mark_executed,
    mark_failed,
    reject_proposal,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assistant", tags=["assistant"])


def _error(exc: WriteProposalError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/write-proposals/{proposal_id}/approve")
async def approve_write_proposal(proposal_id: str) -> dict:
    """批准并立即执行一条写入提案（一次性）。

    返回执行结果摘要与提案终态；重复批准/重放/跨数据集/过期都是 409，
    不存在的提案是 404。
    """
    try:
        grant = approve_proposal(proposal_id)
        tool_name, arguments = consume(proposal_id, grant["token"])
    except WriteProposalError as exc:
        raise _error(exc) from exc
    tool = get_tool(tool_name)
    if tool is None:
        mark_failed(proposal_id, f"工具 {tool_name} 已不存在")
        raise HTTPException(status_code=409, detail=f"工具 {tool_name} 已不存在")
    # 执行上下文：批准动作本身就是用户对这条写入的显式同意（writable=True）；
    # 数据集身份此刻重新快照（approve 已校验归属，与提案一致）。
    ctx = tool_policy.build_context(writable=True)
    with dataset_scope.frozen_session_factory() as db:
        try:
            result = tool.handler(db, arguments)
        except Exception as exc:  # noqa: BLE001 - 执行失败如实回给前端
            mark_failed(proposal_id, str(exc))
            logger.warning("提案 %s 执行失败（%s）：%s", proposal_id, tool_name, exc)
            raise HTTPException(status_code=422, detail=f"写入执行失败：{exc}") from exc
    summary = getattr(result, "summary", "")
    final = mark_executed(proposal_id, summary)
    logger.info(
        "提案 %s 已执行（%s）request_id=%s", proposal_id, tool_name, ctx.request_id
    )
    return {"proposal": final.model_dump(mode="json"), "summary": summary, "changed": getattr(result, "changed", False)}


@router.post("/write-proposals/{proposal_id}/reject")
def reject_write_proposal(proposal_id: str) -> dict:
    try:
        proposal = reject_proposal(proposal_id)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    return {"proposal": proposal.model_dump(mode="json")}


@router.get("/write-proposals/{proposal_id}")
def read_write_proposal(proposal_id: str) -> dict:
    """前端卡片刷新状态用：404 表示提案已失效（重启或未存在）。"""
    try:
        proposal = get_proposal(proposal_id)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    return {"proposal": proposal.model_dump(mode="json")}

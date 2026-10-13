"""写入提案的批准/拒绝端点（RF-01，PR-02/PR-03 修复版）。

批准 = "校验 → 置 approved + 签发一次性 token → 核销 → 用**存储的参数**执行
handler → 置 executed/failed"在同一次请求里完成。token 只在服务端内存流转，
不回传前端、绝不进入模型消息。

PR-02 修复的两处接线错误：
- 路由前缀必须是 ``/api/assistant``：前端统一请求封装按 ``/api${path}`` 发请求，
  旧前缀 ``/assistant`` 让批准请求全部 404（端点从未真正接到流量）；
- ``frozen_session_factory()`` 返回的是 sessionmaker **工厂**，必须先实例化成
  Session 再用（``with factory():`` 会抛 TypeError）。

执行段的身份与租约（PR-03）：
- 先 ``acquire_lease`` 再批准执行：切换持锁期间 409（提案保持 pending 可重试），
  租约同时封死"consume 之后、commit 之前发生切换"的窗口；
- 冻结工厂从**租约身份**派生：执行与提交始终落在批准时刻的那份数据集上，
  不重读"当前库"；
- 会话打开失败 / handler 异常 / 提交失败都把提案置为可解释终态并返回结构化
  错误（503 会话不可用 / 422 执行失败 / 409 结果未知），绝不让提案卡在
  "已核销但业务未执行"的不可知状态。
"""

from __future__ import annotations

import logging
from contextlib import suppress

from fastapi import APIRouter, HTTPException

from ..runtime import dataset_scope
from ..runtime.dataset_scope import DatasetScopeError
from ..services.assistant_tools import get_tool
from ..services.assistant_tools import policy as tool_policy
from ..services.assistant_tools.authorization import (
    WriteProposalError,
    approve_proposal,
    consume,
    get_proposal,
    mark_executed,
    mark_failed,
    mark_unknown,
    reject_proposal,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def _error(exc: WriteProposalError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/write-proposals/{proposal_id}/approve")
async def approve_write_proposal(proposal_id: str) -> dict:
    """批准并立即执行一条写入提案（一次性）。

    返回执行结果摘要与提案终态；重复批准/重放/跨数据集/过期都是 409，
    不存在的提案是 404。执行与提交处于同一数据集身份（租约 + 冻结工厂），
    各类失败都进入可解释终态并如实返回。
    """
    # 租约先行：切换持锁期间取不到 → 409（提案仍是 pending，稍后可重试）；
    # 取到之后身份在本次执行期间被钉住。
    try:
        lease = dataset_scope.acquire_lease("assistant-proposal")
    except DatasetScopeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    try:
        try:
            grant = approve_proposal(proposal_id)
        except WriteProposalError as exc:
            raise _error(exc) from exc
        tool = get_tool(grant["tool_name"])
        if tool is None:
            mark_failed(proposal_id, f"工具 {grant['tool_name']} 已不存在")
            raise HTTPException(status_code=409, detail=f"工具 {grant['tool_name']} 已不存在")
        # 核销用**存储的参数**执行；租约在手，consume 的作用域校验与执行之间
        # 不存在切换窗口（切换必须等租约释放）。
        tool_name, arguments = consume(proposal_id, grant["token"])
        # 执行上下文：批准动作本身就是用户对这条写入的显式同意（writable=True）；
        # 冻结工厂从租约身份派生——consume 到 commit 之间不重新猜当前库。
        ctx = tool_policy.build_context(writable=True)
        factory = dataset_scope.frozen_session_factory(lease.identity)
        try:
            db = factory()
        except Exception as exc:  # noqa: BLE001 - 会话打不开是明确"未执行"
            mark_failed(proposal_id, f"会话打开失败：{exc}")
            logger.warning("提案 %s 会话打开失败（%s）：%s", proposal_id, tool_name, exc)
            raise HTTPException(
                status_code=503,
                detail=f"写入暂不可用（数据库会话打开失败），提案已置为失败，请稍后重试：{exc}",
            ) from exc
        try:
            try:
                result = tool.handler(db, arguments)
            except Exception as exc:  # noqa: BLE001 - 执行失败如实回给前端
                with suppress(Exception):
                    db.rollback()
                mark_failed(proposal_id, str(exc))
                logger.warning("提案 %s 执行失败（%s）：%s", proposal_id, tool_name, exc)
                raise HTTPException(status_code=422, detail=f"写入执行失败：{exc}") from exc
            try:
                # 收尾提交（写服务的 handler 一般已自行提交；此处幂等且把
                # "提交失败"与"handler 失败"分开：前者结果未知，后者未执行）。
                db.commit()
            except Exception as exc:  # noqa: BLE001 - 提交结果无法断言
                with suppress(Exception):
                    db.rollback()
                mark_unknown(proposal_id, f"写入结果未知：{exc}")
                logger.warning("提案 %s 提交结果未知（%s）：%s", proposal_id, tool_name, exc)
                raise HTTPException(
                    status_code=409,
                    detail="写入结果未知（提交阶段失败），请核对数据后重新发起；本提案不会再次执行",
                ) from exc
        finally:
            db.close()
    finally:
        lease.release()
    summary = getattr(result, "summary", "")
    final = mark_executed(proposal_id, summary)
    logger.info(
        "提案 %s 已执行（%s）request_id=%s dataset=%s",
        proposal_id,
        tool_name,
        ctx.request_id,
        lease.identity.dataset_id,
    )
    return {
        "proposal": final.model_dump(mode="json"),
        "summary": summary,
        "changed": getattr(result, "changed", False),
    }


@router.post("/write-proposals/{proposal_id}/reject")
def reject_write_proposal(proposal_id: str) -> dict:
    try:
        proposal = reject_proposal(proposal_id)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    return {"proposal": proposal.model_dump(mode="json")}


@router.get("/write-proposals/{proposal_id}")
def read_write_proposal(proposal_id: str) -> dict:
    """前端卡片刷新状态用：404 表示提案已失效（重启或未存在）。

    数据集身份已切换的提案返回 409 而不是详情（PR-03）：状态读取不暴露
    其他作用域的提案内容。
    """
    try:
        proposal = get_proposal(proposal_id)
    except WriteProposalError as exc:
        raise _error(exc) from exc
    return {"proposal": proposal.model_dump(mode="json")}

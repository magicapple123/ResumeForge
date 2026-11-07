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
"""

from __future__ import annotations

import logging
from contextlib import suppress

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import event
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime import dataset_scope
from ..runtime.dataset_scope import DatasetScopeError
from ..runtime.log_fields import safe_log_text
from ..services.assistant_tools import get_tool
from ..services.assistant_tools import policy as tool_policy
from ..services.assistant_tools.authorization import (
    WriteProposalError,
    approve_proposal,
    consume,
    ensure_target_unchanged,
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


class _CommitWatcher:
    """记录这条会话是否**已经真的提交过**（RR-05）。

    写工具的服务层仍各自 ``db.commit()``（历史实现，短期不收敛为单一 Unit of Work）。
    于是"handler 抛异常"有两种截然不同的后果：提交前抛 = 什么都没发生（可以说"执行
    失败"），提交后抛（典型是 commit 之后的 ``db.refresh`` / 结果构造） = 数据已经
    落库，再说"执行失败"就是**误报**——用户会重发一次，从而二次写入。

    这里挂一个会话级 ``after_commit`` 监听器（只影响这一条会话，不动全局
    ``Session`` 类），异常路径据此把终态从 failed 改成 unknown。
    """

    def __init__(self, session) -> None:
        self.happened = False
        self._session = session
        event.listen(session, "after_commit", self._on_commit)

    def _on_commit(self, _session) -> None:  # noqa: ANN001 - SQLAlchemy 事件签名
        self.happened = True

    def detach(self) -> None:
        with suppress(Exception):
            event.remove(self._session, "after_commit", self._on_commit)


@router.post("/write-proposals/{proposal_id}/approve")
async def approve_write_proposal(proposal_id: str) -> dict:
    """批准并立即执行一条写入提案（一次性）。

    返回执行结果摘要与提案终态；重复批准/重放/跨数据集/过期/目标已变化都是 409，
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
        # 先批准（只动提案表，不碰写入目标）：终态提案（已失败/已执行/已失效/已拒绝）
        # 在这里就返回 409，不会因为"会话打不开"被误报成 503——重放语义必须稳定。
        try:
            grant = approve_proposal(proposal_id, factory=None)
        except WriteProposalError as exc:
            raise _error(exc) from exc
        # 冻结工厂从**租约身份**派生：执行与提交始终落在批准时刻的那份数据集上。
        try:
            factory = dataset_scope.frozen_session_factory(lease.identity)
        except Exception as exc:  # noqa: BLE001 - 冻结失败是明确"未执行"
            mark_failed(proposal_id, "写入暂不可用（数据集身份冻结失败），提案已置为失败")
            logger.warning(
                "提案 %s 数据集身份冻结失败 error_type=%s",
                safe_log_text(proposal_id),
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=503,
                detail="写入暂不可用（数据集身份冻结失败），提案已置为失败",
            ) from exc
        try:
            db = factory()
        except Exception as exc:  # noqa: BLE001 - 会话打不开是明确"未执行"
            mark_failed(proposal_id, "会话打开失败，未执行写入，请稍后重试")
            logger.warning(
                "提案 %s 会话打开失败 error_type=%s",
                safe_log_text(proposal_id),
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=503,
                detail="写入暂不可用（数据库会话打开失败），提案已置为失败",
            ) from exc
        try:
            tool = get_tool(grant["tool_name"])
            if tool is None:
                mark_failed(
                    proposal_id,
                    f"工具 {grant['tool_name']} 不存在或已被删除",
                    factory=factory,
                )
                raise HTTPException(
                    status_code=409, detail=f"工具 {grant['tool_name']} 不存在或已被删除"
                )
            # T01：批准前重查目标。目标已变（预览指纹不一致）就 409 并置失效，
            # 绝不拿创建时的旧快照去写库。
            try:
                ensure_target_unchanged(db, proposal_id, tool)
            except WriteProposalError as exc:
                raise _error(exc) from exc
            # 核销用**存储的参数**执行；租约在手，consume 的作用域校验与执行之间
            # 不存在切换窗口（切换必须等租约释放）。
            try:
                tool_name, arguments = consume(
                    proposal_id, grant["token"], db=db, factory=factory
                )
            except WriteProposalError as exc:
                raise _error(exc) from exc
            ctx = tool_policy.build_context(writable=True)
            watcher = _CommitWatcher(db)
            try:
                try:
                    result = tool.handler(db, arguments)
                except Exception as exc:  # noqa: BLE001 - 执行失败如实回给前端
                    with suppress(Exception):
                        db.rollback()
                    # RR-05：handler 已经在内部提交过就不能说"执行失败"——数据已经落库，
                    # 说失败会让用户重发，从而二次写入。这种情况只报"结果未知"并封死重放。
                    if watcher.happened:
                        mark_unknown(
                            proposal_id,
                            "执行中断但写入可能已提交，请先核对数据",
                            factory=factory,
                        )
                        logger.warning(
                            "提案 %s 执行中断但已提交过（%s）error_type=%s",
                            safe_log_text(proposal_id),
                            safe_log_text(tool_name),
                            type(exc).__name__,
                        )
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "写入结果未知（执行过程中数据已经提交，随后步骤失败），"
                                "本提案不会再次执行"
                            ),
                        ) from exc
                    mark_failed(proposal_id, "写入执行失败，本次未提交", factory=factory)
                    logger.warning(
                        "提案 %s 执行失败（%s）error_type=%s",
                        safe_log_text(proposal_id),
                        safe_log_text(tool_name),
                        type(exc).__name__,
                    )
                    raise HTTPException(
                        status_code=422, detail="写入执行失败，本次未提交"
                    ) from exc
                try:
                    # 收尾提交（写服务的 handler 一般已自行提交；此处幂等且把
                    # "提交失败"与"handler 失败"分开：前者结果未知，后者未执行）。
                    db.commit()
                except Exception as exc:  # noqa: BLE001 - 提交结果无法断言
                    with suppress(Exception):
                        db.rollback()
                    mark_unknown(
                        proposal_id,
                        "写入结果未知，请核对数据，本提案不会再次执行",
                        factory=factory,
                    )
                    logger.warning(
                        "提案 %s 提交结果未知（%s）error_type=%s",
                        safe_log_text(proposal_id),
                        safe_log_text(tool_name),
                        type(exc).__name__,
                    )
                    raise HTTPException(
                        status_code=409,
                        detail="写入结果未知（提交阶段失败），本提案不会再次执行",
                    ) from exc
            finally:
                watcher.detach()
        finally:
            db.close()
    finally:
        lease.release()
    summary = getattr(result, "summary", "")
    final = mark_executed(proposal_id, summary, factory=factory)
    logger.info(
        "提案 %s 已执行（%s）request_id=%s dataset=%s",
        safe_log_text(proposal_id),
        safe_log_text(tool_name),
        safe_log_text(ctx.request_id),
        safe_log_text(lease.identity.dataset_id),
    )
    return {
        "proposal": final.model_dump(mode="json"),
        "summary": summary,
        "changed": getattr(result, "changed", False),
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

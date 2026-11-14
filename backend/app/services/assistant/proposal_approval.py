# SPDX-License-Identifier: Apache-2.0
"""写入提案的「批准并执行」状态机（T2：从 `api/assistant_proposals.py` 下沉）。

批准 = "校验 → 置 approved + 签发一次性 token → 核销 → 用**存储的参数**执行
handler → 置 executed/failed/unknown"在同一次请求里完成。token 只在服务端内存流转，
不回传前端、绝不进入模型消息。

T01 的三处语义与原实现逐字一致：

- **批准前重查目标**：用存储参数重算写工具预览，与创建时的目标指纹不一致就 409
  「数据已变化」，并把提案置为失效——绝不用旧快照执行；
- **状态单一事实源**：终态写回 assistant_write_proposal 表，下一轮对话据此回答；
- **派生回写**：五条终态各补一条 kind=proposal_result 的会话消息（best-effort，
  写失败不影响状态正确性，也绝不回滚已提交的写入）。

执行段的身份与租约（PR-03）保持不变：先取租约再批准执行，冻结工厂从租约身份派生，
执行与提交始终落在批准时刻的那份数据集上。

**事务边界**：执行段的收尾提交与"提交失败 = 结果未知"的判定不可分（handler 可能已自行
提交），它无法拆给路由；服务因此接收路由传入的 `commit` 回调来执行这一步提交——
提交策略仍由路由持有，本模块不直接调用 `db.commit()`。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.orm import Session

from ...runtime import dataset_scope
from ...runtime.dataset_scope import DatasetScopeError
from ...runtime.log_fields import safe_log_text
from ..assistant_tools import get_tool
from ..assistant_tools import policy as tool_policy
from ..assistant_tools.authorization import (
    WriteProposalOut,
    approve_proposal,
    consume,
    ensure_target_unchanged,
    mark_executed,
    mark_failed,
    mark_unknown,
)

logger = logging.getLogger(__name__)


class ProposalApprovalError(Exception):
    """批准流程中可直接映射为 HTTP 错误的领域异常（路由负责 status/detail 映射）。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class ProposalApprovalResult:
    """一次批准执行的结果：提案终态 + 结果摘要 + handler 是否改动数据。"""

    proposal: WriteProposalOut
    summary: str
    changed: bool


class _CommitWatcher:
    """记录这条会话是否**已经真的提交过**（RR-05）。

    写工具的服务层仍各自 `db.commit()`（历史实现，短期不收敛为单一 Unit of Work）。
    于是"handler 抛异常"有两种截然不同的后果：提交前抛 = 什么都没发生（可以说"执行
    失败"），提交后抛（典型是 commit 之后的 `db.refresh` / 结果构造） = 数据已经
    落库，再说"执行失败"就是**误报**——用户会重发一次，从而二次写入。

    这里挂一个会话级 `after_commit` 监听器（只影响这一条会话，不动全局
    `Session` 类），异常路径据此把终态从 failed 改成 unknown。
    """

    def __init__(self, session: Session) -> None:
        self.happened = False
        self._session = session
        event.listen(session, "after_commit", self._on_commit)

    def _on_commit(self, _session) -> None:  # noqa: ANN001 - SQLAlchemy 事件签名
        self.happened = True

    def detach(self) -> None:
        with suppress(Exception):
            event.remove(self._session, "after_commit", self._on_commit)


async def execute_proposal_approval(
    proposal_id: str, *, commit: Callable[[Session], None]
) -> ProposalApprovalResult:
    """批准并立即执行一条写入提案（一次性），返回提案终态与执行摘要。

    重复批准/重放/跨数据集/过期/目标已变化都是 409，不存在的提案是 404；各类失败都
    进入可解释终态并如实返回。`commit` 由路由传入：它绑定"这条执行会话的收尾提交"，
    提交失败会被翻译成 unknown 终态（数据可能已落库，不允许再说"失败"让用户重发）。
    """
    # 租约先行：切换持锁期间取不到 → 409（提案仍是 pending，稍后可重试）；
    # 取到之后身份在本次执行期间被钉住。
    try:
        lease = dataset_scope.acquire_lease("assistant-proposal")
    except DatasetScopeError as exc:
        raise ProposalApprovalError(exc.status_code, str(exc)) from exc
    try:
        # 先批准（只动提案表，不碰写入目标）：终态提案（已失败/已执行/已失效/已拒绝）
        # 在这里就返回 409，不会因为"会话打不开"被误报成 503——重放语义必须稳定。
        grant = approve_proposal(proposal_id, factory=None)
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
            raise ProposalApprovalError(
                503, "写入暂不可用（数据集身份冻结失败），提案已置为失败"
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
            raise ProposalApprovalError(
                503, "写入暂不可用（数据库会话打开失败），提案已置为失败"
            ) from exc
        try:
            result, tool_name, ctx = _execute_handler(
                db,
                proposal_id=proposal_id,
                grant=grant,
                factory=factory,
                commit=commit,
            )
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
    return ProposalApprovalResult(
        proposal=final, summary=summary, changed=getattr(result, "changed", False)
    )


def _execute_handler(
    db: Session, *, proposal_id: str, grant: dict, factory, commit: Callable[[Session], None]
):
    """核销并用存储参数执行 handler；失败按"是否已提交过"分 failed / unknown 终态。"""
    tool = get_tool(grant["tool_name"])
    if tool is None:
        mark_failed(
            proposal_id,
            f"工具 {grant['tool_name']} 不存在或已被删除",
            factory=factory,
        )
        raise ProposalApprovalError(409, f"工具 {grant['tool_name']} 不存在或已被删除")
    # T01：批准前重查目标。目标已变（预览指纹不一致）就 409 并置失效，
    # 绝不拿创建时的旧快照去写库。（WriteProposalError 由路由统一映射。）
    ensure_target_unchanged(db, proposal_id, tool)
    # 核销用**存储的参数**执行；租约在手，consume 的作用域校验与执行之间
    # 不存在切换窗口（切换必须等租约释放）。
    tool_name, arguments = consume(proposal_id, grant["token"], db=db, factory=factory)
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
                raise ProposalApprovalError(
                    409,
                    "写入结果未知（执行过程中数据已经提交，随后步骤失败），本提案不会再次执行",
                ) from exc
            mark_failed(proposal_id, "写入执行失败，本次未提交", factory=factory)
            logger.warning(
                "提案 %s 执行失败（%s）error_type=%s",
                safe_log_text(proposal_id),
                safe_log_text(tool_name),
                type(exc).__name__,
            )
            raise ProposalApprovalError(422, "写入执行失败，本次未提交") from exc
        try:
            # 收尾提交（写服务的 handler 一般已自行提交；此处幂等且把
            # "提交失败"与"handler 失败"分开：前者结果未知，后者未执行）。
            commit(db)
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
            raise ProposalApprovalError(
                409, "写入结果未知（提交阶段失败），本提案不会再次执行"
            ) from exc
    finally:
        watcher.detach()
    return result, tool_name, ctx


__all__ = [
    "ProposalApprovalError",
    "ProposalApprovalResult",
    "execute_proposal_approval",
]

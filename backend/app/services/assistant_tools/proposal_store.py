# SPDX-License-Identifier: Apache-2.0
"""助手写操作提案的持久化存储（T01 单一事实源）。

为什么单独一层：提案状态从"进程内存"改为"数据库单一事实源"后，读写、终态转换、
启动清理、下一轮注入都围绕同一张表；授权模块保留对外 API 并委托到这里。

三条不变式：1) 状态以表为准（卡片/下一轮/重启后读同一行）；2) 派生回写是
best-effort（写消息失败不影响状态，也不回滚已提交写入）；3) 跨重启只认稳定标识
（dataset_key 是 main/16 位 hex；generation 只拦同进程 A→B→A，启动清理 pending/approved）。

派生回写与状态注入在 proposal_writeback.py（同为 500 行预算拆分的产物）。
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult

from ...models.assistant import AssistantWriteProposal
from ...models.profile import utcnow
from ...runtime import dataset_scope
from .proposal_writeback import (
    INJECT_LIMIT,
    purge_expired_payloads,
    recent_proposals,
    render_status_block,
    safe_writeback,
)

if TYPE_CHECKING:  # 仅类型标注用，避免运行期循环导入
    from sqlalchemy.orm import Session

    from .policy import ToolExecutionContext

logger = logging.getLogger(__name__)

# 提案有效期（秒）以 authorization 模块的常量为准（测试会 monkeypatch 它），这里只在
# 万一被删除时兜底，不复制第二份真相。
PROPOSAL_TTL_SECONDS_DEFAULT = 1800
# 一次会话最多回写/注入多少条：注入用 INJECT_LIMIT，接口查询上限 50。
MAX_LIST_LIMIT = 50

# 一次性 token：批准时签发、同一请求内核销；不落库、不进消息。重启即丢（pending/approved
# 启动时全置 expired，与"内存 token 丢了"的事实一致）。
_TOKENS: dict[str, str] = {}
_TOKEN_LOCK = threading.Lock()

# 本进程启动时刻：启动清理只清上一次进程遗留的 pending/approved，不误清本进程刚创建、
# 等用户确认的提案（测试里 TestClient 每次启动都会跑 lifespan 清理）。
_PROCESS_STARTED_AT = utcnow()


@dataclass
class ProposalView:
    """对外视图（authorization 层再转换成 pydantic 的 WriteProposalOut）。"""

    proposal_id: str
    tool_name: str
    dataset_id: str
    preview: dict[str, Any]
    created_at: Any
    expires_at: Any
    status: str
    result_summary: str = ""


def fingerprint_payload(payload: dict[str, Any]) -> str:
    """canonical JSON（排序键）的 sha256：用于参数摘要与目标版本指纹。"""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def preview_fingerprint(preview: Any) -> str:
    """写入预览摘要：预览带着目标对象的版本证据，批准前重算比对即可发现目标漂移。"""
    payload = preview.model_dump(mode="json") if hasattr(preview, "model_dump") else dict(preview)
    return fingerprint_payload(payload)


def _view(record: AssistantWriteProposal) -> ProposalView:
    return ProposalView(
        proposal_id=record.proposal_id,
        tool_name=record.tool_name,
        dataset_id=record.dataset_key,
        preview=dict(record.preview or {}),
        created_at=record.created_at,
        expires_at=record.expires_at,
        status=record.status,
        result_summary=record.result_summary or "",
    )


@contextmanager
def _session_scope(
    db: Session | None = None, factory: Any = None
) -> Iterator[tuple[Session, bool]]:
    """有调用方会话就复用（不关闭），否则自开一条（用冻结工厂或全局会话）。"""
    if db is not None:
        yield db, False
        return
    from ...database import SessionLocal  # 函数级导入：拿到 rebind 后的最新绑定

    session = (factory or SessionLocal)()
    try:
        yield session, True
    finally:
        session.close()


def _ttl_seconds() -> int:
    from . import authorization as auth  # 函数级导入：测试 monkeypatch 的常量要实时读到

    return int(getattr(auth, "PROPOSAL_TTL_SECONDS", PROPOSAL_TTL_SECONDS_DEFAULT))


def _get(session: Session, proposal_id: str) -> AssistantWriteProposal:
    from .authorization import WriteProposalError

    record = (
        session.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal_id)
        .one_or_none()
    )
    if record is None:
        raise WriteProposalError("提案不存在或已失效", status_code=404)
    return record


def _scope_error(record: AssistantWriteProposal) -> Any:
    from .authorization import WriteProposalError

    if record.dataset_key != dataset_scope.current_dataset_id():
        return WriteProposalError("数据集已切换，本提案失效", status_code=409)
    if record.dataset_generation != dataset_scope.current_generation():
        return WriteProposalError("数据集已切换，本提案失效", status_code=409)
    return None


def _writeback(proposal_id: str, factory: Any = None) -> None:
    from ...database import SessionLocal  # 函数级导入：与 _session_scope 同一理由

    safe_writeback(factory or SessionLocal, proposal_id)


def _ensure_usable(session: Session, record: AssistantWriteProposal, factory: Any = None) -> None:
    """惰性过期 + 作用域校验（与旧内存实现语义一致）。"""
    from .authorization import WriteProposalError

    now = utcnow()
    if record.status == "pending" and now >= record.expires_at:
        record.status = "expired"
        session.commit()
        _writeback(record.proposal_id, factory)
        raise WriteProposalError("提案已过期，请让助手重新发起", status_code=409)
    if record.status == "expired" or (record.status != "pending" and now >= record.expires_at):
        raise WriteProposalError("提案已过期，请让助手重新发起", status_code=409)
    mismatch = _scope_error(record)
    if mismatch is not None:
        raise mismatch


def create(
    ctx: ToolExecutionContext,
    tool_name: str,
    arguments: dict[str, Any],
    preview: Any,
    *,
    conversation_id: int | None = None,
    message_id: int | None = None,
    batch_id: str | None = None,
    db: Session | None = None,
    factory: Any = None,
) -> ProposalView:
    """登记一条待确认的写入提案（不执行任何写入）。"""
    created = utcnow()
    # 数据集身份优先取调用方快照（工具执行上下文/端点在各自时点读到的事实），缺省才
    # 读当前作用域——这样"创建时绑哪份库"有单一来源，也方便测试注入。
    dataset_key = getattr(ctx, "dataset_id", None) or dataset_scope.current_dataset_id()
    generation = getattr(ctx, "dataset_generation", None)
    if generation is None:
        generation = dataset_scope.current_generation()
    record = AssistantWriteProposal(
        proposal_id=secrets.token_hex(8),
        conversation_id=conversation_id,
        message_id=message_id,
        dataset_key=dataset_key,
        dataset_generation=generation,
        tool_name=tool_name,
        arguments=dict(arguments),
        arguments_digest=fingerprint_payload(arguments),
        preview=preview.model_dump(mode="json"),
        target_fingerprint=preview_fingerprint(preview),
        status="pending",
        created_at=created,
        expires_at=created + timedelta(seconds=_ttl_seconds()),
        batch_id=batch_id,
    )
    with _session_scope(db, factory) as (session, _own):
        session.add(record)
        session.commit()
        session.refresh(record)
        return _view(record)


def get(proposal_id: str, *, db: Session | None = None, factory: Any = None) -> ProposalView:
    """读取提案状态；不存在 404，作用域不一致 409（不暴露其他作用域的详情）。"""
    with _session_scope(db, factory) as (session, _own):
        record = _get(session, proposal_id)
        if record.status == "pending" and utcnow() >= record.expires_at:
            record.status = "expired"
            session.commit()
            _writeback(proposal_id, factory)
        mismatch = _scope_error(record)
        if mismatch is not None:
            raise mismatch
        return _view(record)


def approve(proposal_id: str, *, db: Session | None = None, factory: Any = None) -> dict[str, Any]:
    """用户批准：校验后置 approved 并签发一次性 token（不落库）。"""
    from .authorization import WriteProposalError

    with _session_scope(db, factory) as (session, _own):
        record = _get(session, proposal_id)
        _ensure_usable(session, record, factory)
        if record.status != "pending":
            raise WriteProposalError(f"提案当前状态为 {record.status}，不能批准", status_code=409)
        # 数据库条件写：并发两次批准时第二个 UPDATE 的 rowcount=0 → 409。只在内存里
        # 读-改-写挡不住"两会话都读到 pending、各自签发 token"的双执行（真实回归）。
        claimed = cast(
            "CursorResult[Any]",
            session.execute(
                update(AssistantWriteProposal)
                .where(
                    AssistantWriteProposal.proposal_id == proposal_id,
                    AssistantWriteProposal.status == "pending",
                )
                .values(status="approved")
            ),
        )
        if claimed.rowcount != 1:
            session.rollback()
            current = _get(session, proposal_id)
            raise WriteProposalError(f"提案当前状态为 {current.status}，不能批准", status_code=409)
        session.commit()
        record = _get(session, proposal_id)
        token = secrets.token_hex(16)
        with _TOKEN_LOCK:
            _TOKENS[proposal_id] = token
        return {
            "token": token,
            "tool_name": record.tool_name,
            "arguments": dict(record.arguments),
        }


def reject(proposal_id: str, *, db: Session | None = None, factory: Any = None) -> ProposalView:
    """用户拒绝：pending → rejected（终态，不可复活）。"""
    from .authorization import WriteProposalError

    with _session_scope(db, factory) as (session, _own):
        record = _get(session, proposal_id)
        _ensure_usable(session, record, factory)
        if record.status != "pending":
            raise WriteProposalError(f"提案当前状态为 {record.status}，不能拒绝", status_code=409)
        record.status = "rejected"
        session.commit()
        view = _view(record)
    _writeback(proposal_id, factory)
    return view


def consume(
    proposal_id: str, token: str, *, db: Session | None = None, factory: Any = None
) -> tuple[str, dict[str, Any]]:
    """一次性核销：token 匹配、状态 approved、同一数据集缺一不可。"""
    from .authorization import WriteProposalError

    with _TOKEN_LOCK:
        expected = _TOKENS.get(proposal_id)
        if expected is None:
            raise WriteProposalError("提案当前状态不可执行（未批准）", status_code=409)
        if not token or not secrets.compare_digest(token, expected):
            raise WriteProposalError("提案令牌不匹配", status_code=409)
        del _TOKENS[proposal_id]
    with _session_scope(db, factory) as (session, _own):
        record = _get(session, proposal_id)
        if record.status != "approved":
            raise WriteProposalError(f"提案当前状态为 {record.status}，不能执行", status_code=409)
        if utcnow() >= record.expires_at:
            record.status = "expired"
            session.commit()
            _writeback(proposal_id, factory)
            raise WriteProposalError("提案已过期，请让助手重新发起", status_code=409)
        mismatch = _scope_error(record)
        if mismatch is not None:
            raise mismatch
        return record.tool_name, dict(record.arguments)


def verify_arguments(proposal_id: str, arguments: dict[str, Any], *, factory: Any = None) -> None:
    """校验执行参数与存储摘要一致（端点用存储参数执行，这里防内部误用）。"""
    from .authorization import WriteProposalError

    with _session_scope(None, factory) as (session, _own):
        record = _get(session, proposal_id)
        if fingerprint_payload(arguments) != record.arguments_digest:
            raise WriteProposalError("执行参数与批准的提案不一致", status_code=409)


def ensure_target_unchanged(session: Session, proposal_id: str, tool: Any) -> None:
    """批准前重算写入预览并比对目标指纹：目标变了就 409，绝不用旧快照执行。

    preview 是"只读复刻写入意图"的既有实现（如 update_resume 带当前正文与 revision），
    重算差异即漂移证据；没有 preview 的工具跳过（writes=True 必须有 preview 由守卫钉住）。
    """
    from .authorization import WriteProposalError

    record = _get(session, proposal_id)
    preview_fn = getattr(tool, "preview", None)
    if preview_fn is None or not record.target_fingerprint:
        return
    try:
        digest = preview_fingerprint(preview_fn(session, dict(record.arguments)))
    except Exception as exc:  # noqa: BLE001 - 目标读不到/预览失败都按"已变化"处理
        record.status = "expired"
        session.commit()
        with _TOKEN_LOCK:
            _TOKENS.pop(proposal_id, None)
        logger.info(
            "提案 %s 目标已不可读，按数据已变化处理 error_type=%s",
            record.proposal_id,
            type(exc).__name__,
        )
        _writeback(record.proposal_id)
        raise WriteProposalError("数据已变化，请让助手重新生成提案", status_code=409) from exc
    if digest != record.target_fingerprint:
        record.status = "expired"
        session.commit()
        with _TOKEN_LOCK:
            _TOKENS.pop(proposal_id, None)
        _writeback(record.proposal_id)
        raise WriteProposalError("数据已变化，请让助手重新生成提案", status_code=409)


def _transition(
    proposal_id: str,
    status: str,
    *,
    result_summary: str = "",
    error: str = "",
    factory: Any = None,
) -> ProposalView:
    with _session_scope(None, factory) as (session, _own):
        record = _get(session, proposal_id)
        record.status = status
        record.result_summary = result_summary
        record.error = error
        if status == "executed":
            record.executed_at = utcnow()
        session.commit()
        view = _view(record)
    _writeback(proposal_id, factory)
    return view


def mark_executed(proposal_id: str, summary: str = "", *, factory: Any = None) -> ProposalView:
    return _transition(proposal_id, "executed", result_summary=summary, factory=factory)


def mark_failed(proposal_id: str, error: str = "", *, factory: Any = None) -> ProposalView:
    return _transition(proposal_id, "failed", result_summary=error, error=error, factory=factory)


def mark_unknown(proposal_id: str, summary: str = "", *, factory: Any = None) -> ProposalView:
    return _transition(proposal_id, "unknown", result_summary=summary, factory=factory)


def expire_stale(*, factory: Any = None) -> int:
    """启动清理：pending/approved 一律置 expired（内存 token 已丢），并回写。

    跨重启语义核心：重启后不存在"还能执行"的旧提案——必须如实显示已失效、点击 409。
    """
    expired_ids: list[str] = []
    with _session_scope(None, factory) as (session, _own):
        rows = (
            session.query(AssistantWriteProposal)
            .filter(
                AssistantWriteProposal.status.in_(("pending", "approved")),
                AssistantWriteProposal.created_at < _PROCESS_STARTED_AT,
            )
            .all()
        )
        for record in rows:
            record.status = "expired"
            expired_ids.append(record.proposal_id)
        if expired_ids:
            session.commit()
    if expired_ids:
        with _TOKEN_LOCK:
            _TOKENS.clear()
        for proposal_id in expired_ids:
            _writeback(proposal_id, factory)
        logger.info("启动清理：%d 条未完成写入提案已置为失效", len(expired_ids))
    return len(expired_ids)


def list_conversation(
    conversation_id: int, *, limit: int = INJECT_LIMIT, db: Session | None = None
) -> list[ProposalView]:
    """会话内最近 N 条提案状态（前端/状态接口用）。"""
    with _session_scope(db, None) as (session, _own):
        rows = recent_proposals(session, conversation_id, limit=min(limit, MAX_LIST_LIMIT))
        return [_view(row) for row in rows]


def status_block(session: Session, conversation_id: int | None) -> str:
    """下一轮注入用：渲染权威状态块（B）。"""
    return render_status_block(session, conversation_id)


def reset_store() -> None:
    """清空提案与 token（仅测试用）。"""
    from ...models.assistant import ChatMessage
    from .proposal_writeback import RESULT_MESSAGE_KIND

    with _session_scope(None, None) as (session, _own):
        session.query(AssistantWriteProposal).delete()
        session.query(ChatMessage).filter(ChatMessage.kind == RESULT_MESSAGE_KIND).delete()
        session.commit()
    with _TOKEN_LOCK:
        _TOKENS.clear()


__all__ = [
    "INJECT_LIMIT",
    "MAX_LIST_LIMIT",
    "ProposalView",
    "approve",
    "consume",
    "create",
    "ensure_target_unchanged",
    "expire_stale",
    "fingerprint_payload",
    "get",
    "list_conversation",
    "mark_executed",
    "mark_failed",
    "mark_unknown",
    "preview_fingerprint",
    "purge_expired_payloads",
    "reject",
    "reset_store",
    "status_block",
    "verify_arguments",
]

# SPDX-License-Identifier: Apache-2.0
"""写操作提案的派生回写与下一轮状态注入（T01-A / T01-B）。

A（回写）是**派生、best-effort**：五条终态各写一条 role=assistant / kind=proposal_result
的消息；用 (proposal_id, kind) 唯一索引做幂等键，重复写入不产生第二条。消息写失败
不影响状态正确性——B 读表，下一轮照样答对；只损失一条历史记录，所以这里绝不为了
"消息必须写成"把已提交的写入回滚。

B（注入）是**权威视图**：每轮查表，渲染本会话最近 10 条写操作状态追加进系统提示，
并写明"历史那句话说待确认、这里显示已执行，以本块为准；不要重复执行"。
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models.assistant import AssistantWriteProposal, ChatConversation, ChatMessage
from ...models.profile import utcnow

logger = logging.getLogger(__name__)

#: expired / rejected 的 arguments 与 preview 保留 24 小时后清除（隐私最小化）。
PAYLOAD_RETENTION_HOURS = 24
RESULT_MESSAGE_KIND = "proposal_result"
INJECT_LIMIT = 10
TERMINAL_STATUSES = ("executed", "failed", "unknown", "rejected", "expired")
_STATUS_LABELS = {
    "pending": "待确认",
    "approved": "已批准（执行中）",
    "executed": "已执行",
    "failed": "执行失败",
    "unknown": "结果未知",
    "rejected": "已拒绝",
    "expired": "已失效",
}


def recent_proposals(session: Session, conversation_id: int, limit: int = INJECT_LIMIT):
    """本会话最近 N 条提案（按创建时间倒序）。"""
    return (
        session.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.conversation_id == conversation_id)
        .order_by(AssistantWriteProposal.created_at.desc(), AssistantWriteProposal.id.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )


def render_status_block(session: Session, conversation_id: int | None) -> str:
    """注入进系统提示的权威状态块；本会话没有任何提案时返回空串（不注入）。"""
    if conversation_id is None:
        return ""
    rows = recent_proposals(session, conversation_id)
    if not rows:
        return ""
    lines = [
        "【本会话写操作状态（权威）】",
        "以下内容直接来自服务端提案表，是本会话最近写操作的真实状态；以此为准。",
        "历史消息若说等待用户确认、而此处显示已执行，以本块为准；不要重复执行已执行、"
        "已拒绝或已失效的写操作。待确认的提案只能由用户在界面上确认，你不能替用户确认。",
    ]
    for record in rows:
        target = str((record.preview or {}).get("target") or record.tool_name)
        label = _STATUS_LABELS.get(record.status, record.status)
        when = record.created_at.strftime("%m-%d %H:%M")
        detail = ""
        if record.result_summary:
            detail = "：" + str(record.result_summary)[:120]
        suffix = "（已失效，需要时请重新发起）" if record.status == "expired" else ""
        lines.append(f"- {when} 工具 {record.tool_name} 目标「{target}」：{label}{detail}{suffix}")
    lines.append("【本会话写操作状态结束】")
    return "\n".join(lines)


def _result_content(record: AssistantWriteProposal) -> str:
    target = str((record.preview or {}).get("target") or record.tool_name)
    if record.status == "executed":
        detail = f"：{record.result_summary}" if record.result_summary else ""
        return f"已执行写操作：{target}{detail}"
    if record.status == "failed":
        return f"写操作执行失败（未提交）：{target}"
    if record.status == "unknown":
        return f"写操作结果未知（可能已提交，请先核对数据）：{target}"
    if record.status == "rejected":
        return f"已拒绝写操作：{target}"
    return f"写操作提案已失效，需要时请重新发起：{target}"


def writeback_terminal_message(session: Session, proposal_id: str) -> bool:
    """幂等回写一条派生消息；返回是否真的新写入（已存在/无会话归属返回 False）。"""
    record = (
        session.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal_id)
        .one_or_none()
    )
    if record is None or record.conversation_id is None:
        return False  # 内部/测试调用可能没有会话归属：没有可回写的地方，不算失败
    if record.status not in TERMINAL_STATUSES:
        return False
    message = ChatMessage(
        conversation_id=record.conversation_id,
        role="assistant",
        content=_result_content(record),
        kind=RESULT_MESSAGE_KIND,
        proposal_id=record.proposal_id,
        status="complete",
        context={
            "proposal_result": {
                "proposal_id": record.proposal_id,
                "tool_name": record.tool_name,
                "status": record.status,
                "target": str((record.preview or {}).get("target") or record.tool_name),
                "summary": record.result_summary,
            }
        },
    )
    session.add(message)
    try:
        session.commit()
    except Exception:  # noqa: BLE001 - 唯一索引命中（已有回写）或写失败：都不影响状态
        session.rollback()
        return False
    conversation = session.get(ChatConversation, record.conversation_id)
    if conversation is not None:
        conversation.updated_at = utcnow()
        session.commit()
    return True


def safe_writeback(session_factory, proposal_id: str) -> None:
    """best-effort 包一层：任何异常只记日志，绝不向上抛。"""
    try:
        with session_factory() as session:
            writeback_terminal_message(session, proposal_id)
    except Exception:  # noqa: BLE001 - 消息只是历史，状态才是事实
        logger.warning(
            "写操作提案 %s 的派生消息回写失败（状态不受影响）", proposal_id, exc_info=True
        )


def purge_expired_payloads(*, factory=None) -> int:
    """隐私最小化：expired / rejected 超过 24 小时的提案清掉 arguments 与 preview。

    只在启动清理时调用（与 expire_stale 同一时机）；保留 tool_name 与摘要，便于排查
    "当时想做什么"，但不再保留可能含用户数据的参数与预览。
    """
    from ...database import SessionLocal

    cutoff = utcnow() - timedelta(hours=PAYLOAD_RETENTION_HOURS)
    cleared = 0
    with (factory or SessionLocal)() as session:
        rows = (
            session.query(AssistantWriteProposal)
            .filter(
                AssistantWriteProposal.status.in_(("expired", "rejected")),
                AssistantWriteProposal.created_at < cutoff,
                or_(
                    AssistantWriteProposal.arguments != {},
                    AssistantWriteProposal.preview != {},
                ),
            )
            .all()
        )
        for record in rows:
            record.arguments = {}
            record.preview = {}
            cleared += 1
        if cleared:
            session.commit()
    if cleared:
        logger.info("清理 %d 条过期提案的参数与预览（仅保留工具名与摘要）", cleared)
    return cleared


__all__ = [
    "INJECT_LIMIT",
    "PAYLOAD_RETENTION_HOURS",
    "RESULT_MESSAGE_KIND",
    "TERMINAL_STATUSES",
    "purge_expired_payloads",
    "recent_proposals",
    "render_status_block",
    "safe_writeback",
    "writeback_terminal_message",
]

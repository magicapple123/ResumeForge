# SPDX-License-Identifier: Apache-2.0
"""T01：写操作提案落库后的状态权威性与派生回写。

这份文件守的是 P0 修复的四条性质（与 tests/test_assistant_authorization.py 的
授权语义、test_assistant_proposals_endpoint.py 的 HTTP 路径互补）：

1. **B 注入**：下一轮系统提示里的"本会话写操作状态"来自提案表；没有提案不注入，
   别的会话不串入，且不泄露参数正文（只给目标 + 摘要）；
2. **A 回写**：五条终态各写一条 kind=proposal_result 的消息，幂等；回写失败不影响
   状态正确性（B 不依赖消息）；
3. **跨重启语义**：启动清理把 pending/approved 置 expired 并封死再执行；
4. **目标漂移**：批准前重算预览指纹，目标变了就 409 并置失效。
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from app.models.assistant import ChatConversation, ChatMessage
from app.models.profile import utcnow
from app.models.resume import ResumeRecord
from app.runtime import dataset_scope
from app.schemas.assistant import ChatMessageOut
from app.services.assistant_tools import authorization as auth
from app.services.assistant_tools import get_tool, proposal_store, proposal_writeback
from app.services.assistant_tools.authorization import (
    WritePreview,
    WriteProposalError,
    create_proposal,
)
from app.services.assistant_tools.policy import ToolExecutionContext

_TOOL = "create_reminder"
_ARGUMENTS = {"title": "复盘", "remind_at": "2026-10-12T10:00:00"}


@pytest.fixture(autouse=True)
def _clean_store():
    auth.reset_store()
    yield
    auth.reset_store()


def _ctx() -> ToolExecutionContext:
    return ToolExecutionContext(
        dataset_id=dataset_scope.current_dataset_id(),
        dataset_generation=dataset_scope.current_generation(),
        web_search=False,
        fetch_pages=0,
        relaxed=False,
        writable=False,
    )


def _preview(target: str = "日历提醒新提醒") -> WritePreview:
    return WritePreview(target=target, scope="新增 1 条", changes=[])


def _conversation(db_session, title: str = "状态注入测试") -> int:
    conversation = ChatConversation(title=title)
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    return conversation.id


def _proposal(
    db_session,
    conversation_id: int | None = None,
    *,
    tool: str = _TOOL,
    preview: WritePreview | None = None,
    arguments: dict | None = None,
):
    return create_proposal(
        _ctx(),
        tool,
        arguments if arguments is not None else dict(_ARGUMENTS),
        preview or _preview(),
        conversation_id=conversation_id,
        db=db_session,
    )


def _result_messages(db_session, proposal_id: str) -> list[ChatMessage]:
    return (
        db_session.query(ChatMessage)
        .filter(
            ChatMessage.kind == "proposal_result",
            ChatMessage.proposal_id == proposal_id,
        )
        .all()
    )


def test_status_block_is_absent_without_proposals(db_session):
    conversation_id = _conversation(db_session)
    assert proposal_store.status_block(db_session, conversation_id) == ""
    assert proposal_store.status_block(db_session, None) == ""


def test_status_block_tracks_the_authoritative_state(db_session):
    conversation_id = _conversation(db_session)
    proposal = _proposal(db_session, conversation_id)
    block = proposal_store.status_block(db_session, conversation_id)
    assert "待确认" in block
    assert "不要重复执行" in block

    auth.mark_executed(proposal.proposal_id, "新增了 1 条日历提醒")
    block = proposal_store.status_block(db_session, conversation_id)
    assert "已执行" in block
    assert "：待确认" not in block  # 说明性句子里的"待确认"不算状态行
    assert "新增了 1 条日历提醒" in block


def test_system_prompt_contains_the_status_block_only_for_its_conversation(db_session):
    """注入接线（B）：_system_prompt 必须真的把状态块拼进去；没有会话就不注入。"""
    from app.api.assistant import _system_prompt

    conversation_id = _conversation(db_session)
    _proposal(db_session, conversation_id)
    prompt = _system_prompt(db_session, conversation_id=conversation_id)
    assert "本会话写操作状态（权威）" in prompt
    assert "待确认" in prompt
    # 没有会话上下文的调用（如旧调用点/测试）不得凭空注入"当前写操作状态"。
    assert "本会话写操作状态" not in _system_prompt(db_session)


def test_status_block_is_per_conversation_and_does_not_leak_arguments(db_session):
    first = _conversation(db_session, "会话一")
    second = _conversation(db_session, "会话二")
    secret = "绝不能出现在注入块里的参数正文"
    _proposal(
        db_session,
        first,
        preview=_preview("目标岗位卡片"),
        arguments={"title": secret, "remind_at": "2026-10-12T10:00:00"},
    )
    assert secret not in proposal_store.status_block(db_session, first)
    assert proposal_store.status_block(db_session, second) == ""


def test_terminal_state_writes_exactly_one_derived_message(db_session):
    conversation_id = _conversation(db_session)
    proposal = _proposal(db_session, conversation_id)
    auth.mark_executed(proposal.proposal_id, "改了 1 个字段")
    auth.mark_executed(proposal.proposal_id, "改了 1 个字段")  # 重复调用不得产生第二条

    messages = _result_messages(db_session, proposal.proposal_id)
    assert len(messages) == 1
    message = messages[0]
    assert message.role == "assistant"
    assert message.status == "complete"
    assert "已执行" in message.content
    assert message.context["proposal_result"]["status"] == "executed"

    # 消息 schema 如实透出类别与提案 id（前端据此渲染成状态行而不是普通回复）。
    out = ChatMessageOut.model_validate(message)
    assert out.kind == "proposal_result"
    assert out.proposal_id == proposal.proposal_id


def test_writeback_failure_keeps_status_authoritative(db_session, monkeypatch):
    conversation_id = _conversation(db_session)
    proposal = _proposal(db_session, conversation_id)

    def _explode(*_args, **_kwargs):
        raise RuntimeError("模拟：派生消息写失败")

    monkeypatch.setattr(proposal_writeback, "writeback_terminal_message", _explode)
    final = auth.mark_executed(proposal.proposal_id, "写入成功")

    # 状态仍如实是 executed（B 读表），只是丢了一条历史记录（A）。
    assert final.status == "executed"
    assert auth.get_proposal(proposal.proposal_id).status == "executed"
    assert _result_messages(db_session, proposal.proposal_id) == []
    block = proposal_store.status_block(db_session, conversation_id)
    assert "已执行" in block


def test_startup_expiry_marks_unfinished_proposals_expired(db_session, monkeypatch):
    conversation_id = _conversation(db_session)
    pending = _proposal(db_session, conversation_id)
    approved = _proposal(db_session, conversation_id)
    grant = auth.approve_proposal(approved.proposal_id)

    # 模拟"这些提案是上一次进程留下的"：把本进程启动时刻推到它们之后，
    # 与真实重启时 proposal_store 模块重新导入的时间边界一致。
    monkeypatch.setattr(proposal_store, "_PROCESS_STARTED_AT", utcnow() + timedelta(seconds=1))
    expired = proposal_store.expire_stale()
    assert expired == 2

    assert auth.get_proposal(pending.proposal_id).status == "expired"
    assert auth.get_proposal(approved.proposal_id).status == "expired"
    # 重启后不存在"还能执行"的旧提案：批准 409、已批准的 token 也被清掉。
    with pytest.raises(WriteProposalError) as approve_error:
        auth.approve_proposal(pending.proposal_id)
    assert approve_error.value.status_code == 409
    with pytest.raises(WriteProposalError) as consume_error:
        auth.consume(approved.proposal_id, grant["token"])
    assert consume_error.value.status_code == 409
    assert len(_result_messages(db_session, pending.proposal_id)) == 1
    assert len(_result_messages(db_session, approved.proposal_id)) == 1


def test_expired_payloads_are_purged_after_retention(db_session):
    proposal = _proposal(db_session)
    row = (
        db_session.query(proposal_store.AssistantWriteProposal)
        .filter(proposal_store.AssistantWriteProposal.proposal_id == proposal.proposal_id)
        .one()
    )
    row.status = "expired"
    row.created_at = utcnow() - timedelta(hours=25)
    db_session.commit()

    assert proposal_store.purge_expired_payloads() == 1
    db_session.expire_all()
    row = db_session.get(proposal_store.AssistantWriteProposal, row.id)
    assert row.arguments == {}
    assert row.preview == {}
    assert row.tool_name == _TOOL


def test_target_drift_blocks_approval_and_expires_the_proposal(db_session):
    record = ResumeRecord(title="漂移验证简历", content={}, note="原备注")
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)

    tool = get_tool("update_resume")
    arguments = {"resume_id": record.id, "note": "提案里的备注"}
    preview = tool.preview(db_session, dict(arguments))
    proposal = _proposal(
        db_session, None, tool="update_resume", preview=preview, arguments=arguments
    )

    # 用户先在界面上改了目标对象：批准前重查必须发现差异。
    record.note = "用户在提案之后改的备注"
    db_session.commit()

    with pytest.raises(WriteProposalError) as drift:
        proposal_store.ensure_target_unchanged(db_session, proposal.proposal_id, tool)
    assert drift.value.status_code == 409
    assert "数据已变化" in str(drift.value)
    assert auth.get_proposal(proposal.proposal_id).status == "expired"


def test_changed_dataset_generation_blocks_approval(db_session, monkeypatch):
    proposal = _proposal(db_session)
    base_generation = dataset_scope.current_generation()
    monkeypatch.setattr(
        "app.services.assistant_tools.proposal_store.dataset_scope.current_generation",
        lambda: base_generation + 1,
    )
    with pytest.raises(WriteProposalError) as mismatch:
        auth.approve_proposal(proposal.proposal_id)
    assert mismatch.value.status_code == 409
    assert "数据集" in str(mismatch.value)


def test_rejected_proposal_writes_its_derived_message(db_session):
    conversation_id = _conversation(db_session)
    proposal = _proposal(db_session, conversation_id)
    auth.reject_proposal(proposal.proposal_id)
    messages = _result_messages(db_session, proposal.proposal_id)
    assert len(messages) == 1
    assert "已拒绝" in messages[0].content
    assert messages[0].context["proposal_result"]["status"] == "rejected"

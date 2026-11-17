# SPDX-License-Identifier: Apache-2.0
"""T25 压缩摘要可见：会话详情与 ``GET /context-usage`` 下发同一份摘要。

两条验收：
- 同一段压缩状态在两个接口里逐字一致（消息流「查看摘要」与用量面板不能各说各话）；
- 摘要正文按 4,000 字符截断（展开面板不做无界下发）。
"""

from app.models.assistant import ChatConversation, ChatMessage
from app.models.profile import utcnow

TEXT_LIMIT = 4000


def _conversation(db_session) -> ChatConversation:
    conversation = ChatConversation(title="压缩摘要")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    return conversation


def _message(db_session, conversation: ChatConversation, role: str, content: str) -> ChatMessage:
    message = ChatMessage(
        conversation_id=conversation.id,
        role=role,
        content=content,
        status="complete",
        created_at=utcnow(),
    )
    db_session.add(message)
    db_session.commit()
    db_session.refresh(message)
    return message


def _attach_compaction(db_session, conversation: ChatConversation, summary: dict, covered_id: int):
    """整列重写（JSON 列不做原地变更追踪，改字段不会落库）。"""
    conversation.compaction = {
        "summary": summary,
        "covered_until_message_id": covered_id,
        "tokens_before": 900,
        "tokens_after": 300,
        "model": "test-model",
        "created_at": "2026-11-16T00:00:00Z",
    }
    db_session.commit()


def test_compaction_summary_is_identical_in_detail_and_context_usage(client, db_session):
    """会话详情与 context-usage 的 compaction 来自同一个投影函数。"""
    conversation = _conversation(db_session)
    _message(db_session, conversation, "user", "帮我找工作")
    second = _message(db_session, conversation, "assistant", "好的")
    _attach_compaction(
        db_session,
        conversation,
        {
            "goal": "找到后端岗位",
            "constraints": ["只看上海"],
            "facts": [{"k": "工作年限", "v": "5 年"}],
            "decisions": [],
            "open_questions": ["是否接受远程"],
            "next_steps": ["投递三家"],
            "compacted": {"from": 1, "to": 2, "turns": 3},
        },
        second.id,
    )

    detail = client.get(f"/api/assistant/conversations/{conversation.id}").json()
    usage = client.get(f"/api/assistant/conversations/{conversation.id}/context-usage").json()

    assert detail["compaction"] is not None
    assert detail["compaction"]["covered_until_message_id"] == second.id
    assert detail["compaction"]["turns"] == 3
    assert "找到后端岗位" in detail["compaction"]["summary"]
    assert "只看上海" in detail["compaction"]["summary"]
    assert detail["compaction"]["summary"] == usage["compaction"]["summary"]


def test_compaction_summary_is_truncated_to_4000_chars(client, db_session):
    """超长摘要按 4,000 字符截断；两个接口给出同一个截断结果。"""
    huge = {
        "goal": "长" * 200,
        "constraints": [f"约束{i}：" + "内容" * 60 for i in range(12)],
        "facts": [{"k": f"键{i}", "v": "值" * 80} for i in range(12)],
        "decisions": [f"决定{i}：" + "内容" * 60 for i in range(12)],
        "open_questions": [f"问题{i}：" + "内容" * 60 for i in range(12)],
        "next_steps": [f"下一步{i}：" + "内容" * 60 for i in range(12)],
        "compacted": {"from": 1, "to": 9, "turns": 8},
    }
    conversation = _conversation(db_session)
    message = _message(db_session, conversation, "assistant", "好的")
    _attach_compaction(db_session, conversation, huge, message.id)

    detail = client.get(f"/api/assistant/conversations/{conversation.id}").json()
    usage = client.get(f"/api/assistant/conversations/{conversation.id}/context-usage").json()

    assert len(detail["compaction"]["summary"]) == TEXT_LIMIT
    assert detail["compaction"]["summary"] == usage["compaction"]["summary"]

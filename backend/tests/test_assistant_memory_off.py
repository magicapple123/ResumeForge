# SPDX-License-Identifier: Apache-2.0
"""F34 临时对话：`memory_off` 在注入、抽取与列表三条链路上的语义。

三条验收：
- 开启后这段对话**不注入**已有记忆（系统提示里没有记忆块）；
- 开启后**不产生**新记忆（空闲调度不排任务；已经在跑的任务执行体也会跳过）；
- 关闭开关**不删除**任何已有记忆，列表里能看到状态改回 False。
"""

import asyncio
from datetime import timedelta

from app.models.assistant import ChatConversation, ChatMessage
from app.models.assistant_memory import MEMORY_STATUS_ACTIVE, AssistantMemory
from app.models.profile import utcnow
from app.services.assistant import memory
from app.services.assistant.memory_extract import run_extraction, should_schedule


class _FakeProvider:
    """只实现 chat() 的假模型：任何调用都会留下记录（被跳过时应该一次都不调）。"""

    def __init__(self, response: str) -> None:
        self.response = response
        self.calls = 0

    async def chat(self, messages: list[dict]) -> str:
        self.calls += 1
        return self.response


def _conversation(db_session, *, memory_off: bool = False) -> ChatConversation:
    conversation = ChatConversation(title="临时对话", memory_off=memory_off)
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    return conversation


def _message(
    db_session,
    conversation: ChatConversation,
    role: str,
    content: str,
    *,
    minutes_ago: int = 0,
) -> ChatMessage:
    message = ChatMessage(
        conversation_id=conversation.id,
        role=role,
        content=content,
        status="complete",
        created_at=utcnow() - timedelta(minutes=minutes_ago),
    )
    db_session.add(message)
    db_session.commit()
    db_session.refresh(message)
    return message


def test_memory_off_skips_injection(db_session):
    """同一段对话：关着时注入、开着时不注入（记忆本身仍然在库里）。"""
    conversation = _conversation(db_session)
    memory.create_memory(db_session, kind="city", value="杭州")
    _message(db_session, conversation, "user", "我只看杭州的机会")

    assert "【关于用户的长期记忆】" in memory.render_memory_block(db_session, conversation.id)

    conversation.memory_off = True
    db_session.commit()
    assert memory.render_memory_block(db_session, conversation.id) == ""
    assert db_session.query(AssistantMemory).count() == 1


def test_memory_off_blocks_scheduling(db_session):
    """空闲满足条件也不排抽取任务：临时对话不产生新记忆。"""
    conversation = _conversation(db_session)
    _message(db_session, conversation, "user", "我只看杭州", minutes_ago=11)
    _message(db_session, conversation, "assistant", "好的", minutes_ago=10)
    _message(db_session, conversation, "user", "帮我看看岗位")
    memory.set_auto_extract(db_session, True)
    try:
        assert should_schedule(db_session, conversation.id) is True

        conversation.memory_off = True
        db_session.commit()
        assert should_schedule(db_session, conversation.id) is False
    finally:
        memory.set_auto_extract(db_session, False)


def test_run_extraction_is_skipped_when_memory_off(db_session):
    """执行体的第二道闸：排队后才打开开关的会话也不能写入。"""
    conversation = _conversation(db_session, memory_off=True)
    _message(db_session, conversation, "user", "我只看杭州", minutes_ago=6)
    _message(db_session, conversation, "assistant", "好的", minutes_ago=5)
    provider = _FakeProvider('[{"op": "ADD", "kind": "city", "value": "杭州"}]')

    counts = asyncio.run(
        run_extraction(db_session, conversation_id=conversation.id, provider=provider)
    )

    assert counts == {"parsed": False, "reason": "memory_off"}
    assert provider.calls == 0
    assert db_session.query(AssistantMemory).count() == 0


def test_api_toggle_memory_off_keeps_existing_memories(client):
    """PATCH 开关：列表/详情如实返回；关闭后记忆还在（关闭不等于删除）。"""
    conversation = client.post("/api/assistant/conversations", json={"title": "临时"}).json()
    assert conversation["memory_off"] is False

    patched = client.patch(
        f"/api/assistant/conversations/{conversation['id']}",
        json={"memory_off": True},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["memory_off"] is True
    listed = client.get("/api/assistant/conversations").json()
    assert listed[0]["memory_off"] is True

    created = client.post("/api/assistant/memories", json={"kind": "city", "value": "杭州"})
    assert created.status_code == 201, created.text

    restored = client.patch(
        f"/api/assistant/conversations/{conversation['id']}",
        json={"memory_off": False},
    )
    assert restored.json()["memory_off"] is False
    rows = client.get("/api/assistant/memories").json()
    assert [row["status"] for row in rows] == [MEMORY_STATUS_ACTIVE]

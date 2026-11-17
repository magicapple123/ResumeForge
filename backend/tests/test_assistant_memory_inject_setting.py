# SPDX-License-Identifier: Apache-2.0
"""T23 记忆注入总开关：默认开、关掉后系统提示没有记忆块、与会话级开关是与关系。

三条验收：
- ``inject=false`` → 系统提示（base 段）里没有记忆块；
- ``inject`` 默认 true（库里没有这一行时仍然注入）——升级不能改变已有行为；
- 与「本次不记忆」（``memory_off``）是**与**关系：任一关闭就不注入。
"""

from app.models.assistant import ChatConversation, ChatMessage
from app.models.profile import utcnow
from app.services.assistant import memory
from app.services.assistant.assistant_system_prompt import build_system_prompt_parts

MEMORY_HEADER = "【关于用户的长期记忆】"


def _conversation(db_session, *, memory_off: bool = False) -> ChatConversation:
    conversation = ChatConversation(title="记忆开关", memory_off=memory_off)
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    return conversation


def _user_message(db_session, conversation: ChatConversation, content: str) -> ChatMessage:
    message = ChatMessage(
        conversation_id=conversation.id,
        role="user",
        content=content,
        status="complete",
        created_at=utcnow(),
    )
    db_session.add(message)
    db_session.commit()
    db_session.refresh(message)
    return message


def _base_prompt(db_session, conversation_id: int) -> str:
    return build_system_prompt_parts(db_session, conversation_id=conversation_id)["base"]


def test_injection_switch_off_removes_memory_block(db_session):
    """inject=false：系统提示里一个字都不出现（记忆仍在库里，只是不注入）。"""
    conversation = _conversation(db_session)
    memory.create_memory(db_session, kind="city", value="杭州")
    _user_message(db_session, conversation, "我只看杭州的机会")
    assert MEMORY_HEADER in _base_prompt(db_session, conversation.id)

    memory.set_memory_injection(db_session, False)
    assert memory.render_memory_block(db_session, conversation.id) == ""
    assert MEMORY_HEADER not in _base_prompt(db_session, conversation.id)


def test_injection_defaults_to_true_without_setting_row(db_session):
    """升级场景：库中**没有** ``assistant_memory_inject`` 这一行时仍然注入。

    缺行 = 默认开。把这个默认值写成 false，本用例必须变红——它是"升级后不倒退"
    的唯一守卫。
    """
    conversation = _conversation(db_session)
    memory.create_memory(db_session, kind="city", value="杭州")
    _user_message(db_session, conversation, "我只看杭州的机会")

    from app.models.setting import AppSetting

    assert db_session.get(AppSetting, "assistant_memory_inject") is None
    assert memory.memory_injection_enabled(db_session) is True
    assert MEMORY_HEADER in _base_prompt(db_session, conversation.id)


def test_injection_and_conversation_memory_off_are_and_related(db_session):
    """两个开关是与关系：任一关闭都不注入，两个都开才注入。"""
    conversation = _conversation(db_session)
    memory.create_memory(db_session, kind="city", value="杭州")
    _user_message(db_session, conversation, "我只看杭州的机会")

    try:
        conversation.memory_off = True
        db_session.commit()
        assert memory.render_memory_block(db_session, conversation.id) == ""

        conversation.memory_off = False
        db_session.commit()
        assert MEMORY_HEADER in memory.render_memory_block(db_session, conversation.id)

        memory.set_memory_injection(db_session, False)
        assert memory.render_memory_block(db_session, conversation.id) == ""
    finally:
        memory.set_memory_injection(db_session, True)


def test_settings_endpoint_updates_only_the_given_switch(client):
    """两个开关共用 PUT：只改送来的一项，另一项保持原值。"""
    initial = client.get("/api/assistant/memories/settings").json()
    assert initial == {"auto_extract": False, "inject": True}

    assert client.put("/api/assistant/memories/settings", json={"inject": False}).json() == {
        "auto_extract": False,
        "inject": False,
    }
    assert client.put("/api/assistant/memories/settings", json={"auto_extract": True}).json() == {
        "auto_extract": True,
        "inject": False,
    }

    # 复原，避免影响同库的其它用例。
    client.put("/api/assistant/memories/settings", json={"auto_extract": False, "inject": True})

# SPDX-License-Identifier: Apache-2.0
"""T24：技能改为**消息级**（只作用于下一条消息，发送后清空）。

四条核心性质（验收口径）：

1. 带 ``skill_ids`` 发送后，**用户消息**的 ``context.skill_prompt`` 非空、
   ``context.skills`` 是 ``[{id, name}]``，且系统提示里不再出现技能（不双重注入）；
2. 第二条消息不带 ``skill_ids`` 时，发给模型的请求里**第一条**的技能提示仍在
   ——历史消息各自带着自己的技能提示，续轮不断；
3. 不带 ``skill_ids`` 的**新会话首条**不注入任何技能。反证：如果实现回落到
   ``assistant_conversation_skill``（旧表已通过 PUT 写入了技能），本用例必须变红；
4. 待验证技能 → 409，且消息行不落库（不留半截状态）。
"""

from __future__ import annotations

from app.models.assistant import AssistantSkill, ChatConversation, ChatMessage
from app.services.assistant.assistant_compaction_skills import (
    COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS,
    build_compaction_skill_prompt,
)
from app.services.llm.base import LLMDelta
from test_assistant import (  # noqa: E402 - 测试 helper 复用（与其余拆分文件同款）
    _configure_llm,
    _create_conversation,
    _ScriptedProvider,
    _send,
)


def _skill(
    db_session,
    *,
    name: str,
    prompt: str = "先连问三道八股题，再逐条点评。",
    generated: bool = False,
    validation_status: str = "",
) -> AssistantSkill:
    skill = AssistantSkill(
        name=name,
        description="练面试时使用",
        prompt=prompt,
        source_name="测试技能",
        generated=generated,
        validation_status=validation_status,
    )
    db_session.add(skill)
    db_session.commit()
    db_session.refresh(skill)
    return skill


def _legacy_enable(client, conversation_id: int, skill_ids: list[int]) -> None:
    """旧接口写入 ``assistant_conversation_skill``（T24 后仅供兼容/反证用）。"""
    response = client.put(
        f"/api/assistant/conversations/{conversation_id}/skills",
        json={"skill_ids": skill_ids},
    )
    assert response.status_code == 200, response.text


def _plain_provider(monkeypatch, reply: str = "好。") -> _ScriptedProvider:
    provider = _ScriptedProvider([[LLMDelta(text=reply)]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    return provider


def _user_messages(request: dict) -> list[dict]:
    return [message for message in request["messages"] if message["role"] == "user"]


def test_skill_ids_are_stored_on_the_user_message(client, db_session, monkeypatch):
    """① 带 ids 发送：提示词落在这一条用户消息上，助手消息没有技能记录。"""
    _configure_llm(client)
    provider = _plain_provider(monkeypatch)
    skill = _skill(db_session, name="面试模拟官")
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "用这个技能提问", "skill_ids": [skill.id]},
    )
    assert response.status_code == 200, response.text

    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    user_message = detail["messages"][0]
    assistant_message = detail["messages"][1]
    assert user_message["role"] == "user"
    assert "面试模拟官" in user_message["context"]["skill_prompt"]
    assert "先连问三道八股题" in user_message["context"]["skill_prompt"]
    assert user_message["context"]["skills"] == [{"id": skill.id, "name": "面试模拟官"}]
    # 技能提示词**不进** API 返回的正文（只拼给模型）。
    assert "面试模拟官" not in user_message["content"]
    # 助手消息不再挂技能（T24：技能属于用户那条消息）。
    assert "skills" not in assistant_message["context"]

    # 系统提示里不再出现技能：同一份提示只从消息正文注入一次。
    system = provider.requests[0]["messages"][0]
    assert system["role"] == "system"
    assert "面试模拟官" not in system["content"]
    # 模型侧看到的当前用户消息：技能提示在正文之前。
    current = _user_messages(provider.requests[0])[-1]
    assert current["content"].startswith("[已导入的技能]")
    assert current["content"].index("面试模拟官") < current["content"].index("用这个技能提问")


def test_previous_message_skill_prompt_survives_the_next_turn(client, db_session, monkeypatch):
    """② 第二条不带 ids：第一条的技能提示仍在发给模型的请求里（续轮不断）。"""
    _configure_llm(client)
    provider = _plain_provider(monkeypatch)
    skill = _skill(db_session, name="面试模拟官")
    conversation = _create_conversation(client)

    first = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "第一问", "skill_ids": [skill.id]},
    )
    assert first.status_code == 200, first.text
    _send(client, conversation["id"], "第二问")

    second_request = provider.requests[1]
    history_user = _user_messages(second_request)[0]
    assert history_user["content"].startswith("[已导入的技能]")
    assert "面试模拟官" in history_user["content"]
    assert history_user["content"].index("[已导入的技能]") < history_user["content"].index("第一问")

    # 第二条自己没勾技能：它自己的正文里不能凭空冒出技能提示。
    current = _user_messages(second_request)[-1]
    assert "面试模拟官" not in current["content"]

    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    second_user_message = detail["messages"][2]
    assert "skill_prompt" not in (second_user_message["context"] or {})


def test_first_message_without_skill_ids_injects_nothing(client, db_session, monkeypatch):
    """③ 新会话首条不带 ids：零技能注入。

    反证：先通过旧接口 PUT 把技能写进 ``assistant_conversation_skill``。如果实现把
    ``skill_ids`` 回落到这张旧表，下面的断言会立刻变红。
    """
    _configure_llm(client)
    provider = _plain_provider(monkeypatch)
    skill = _skill(db_session, name="旧对话技能")
    conversation = _create_conversation(client)
    _legacy_enable(client, conversation["id"], [skill.id])

    _send(client, conversation["id"], "新会话的第一条")

    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    user_message = detail["messages"][0]
    assert "skill_prompt" not in (user_message["context"] or {})
    assert "skills" not in (user_message["context"] or {})
    # 旧关联行仍以只读字段回显（前端据此提示一次），但它不参与提示词。
    assert detail["legacy_skills"] == [{"id": skill.id, "name": "旧对话技能"}]
    request = provider.requests[0]
    assert "旧对话技能" not in request["messages"][0]["content"]
    assert all(
        "旧对话技能" not in str(message.get("content") or "") for message in request["messages"]
    )


def test_pending_skill_is_rejected_with_409(client, db_session, monkeypatch):
    """④ 待验证技能 → 409；消息行不落库。"""
    _configure_llm(client)
    _plain_provider(monkeypatch)
    pending = _skill(
        db_session,
        name="待验证技能",
        generated=True,
        validation_status="pending",
    )
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "试试待验证技能", "skill_ids": [pending.id]},
    )

    assert response.status_code == 409, response.text
    assert "待验证" in response.json()["detail"]
    assert (
        db_session.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation["id"])
        .count()
        == 0
    )


def test_regenerate_replays_the_original_message_skill_prompt(client, db_session, monkeypatch):
    """重新生成沿用原消息的技能提示：那条消息的 skill_ids 是发送时的一次性输入。"""
    _configure_llm(client)
    provider = _plain_provider(monkeypatch, "第一版")
    # 重新生成路由有自己的 provider 构造点（api 层两个模块各自导入），只打一个补丁会
    # 让这个用例退回真实网络调用——那会把"技能提示有没有重放"测成超时。
    monkeypatch.setattr(
        "app.api.assistant_regenerate_api.create_provider", lambda _config: provider
    )
    skill = _skill(db_session, name="面试模拟官")
    conversation = _create_conversation(client)

    first = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "第一问", "skill_ids": [skill.id]},
    )
    assert first.status_code == 200, first.text
    messages = client.get(f"/api/assistant/conversations/{conversation['id']}").json()["messages"]
    assistant_id = messages[-1]["id"]

    regenerated = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages/{assistant_id}/regenerate"
    )
    assert regenerated.status_code == 200, regenerated.text

    replay_user = _user_messages(provider.requests[1])[-1]
    assert replay_user["content"].startswith("[已导入的技能]")
    assert "面试模拟官" in replay_user["content"]


def test_compaction_rebuilds_skill_prompt_from_recent_messages(db_session):
    """⑤ 压缩后重挂：从最近消息的 context.skills 去重取技能，按标题/预算拼回提示。"""
    skill = _skill(db_session, name="面试模拟官", prompt="甲" * 8_000)
    conversation = ChatConversation(title="压缩会话")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    db_session.add_all(
        [
            ChatMessage(
                conversation_id=conversation.id,
                role="user",
                content="第一问",
                context={"skills": [{"id": skill.id, "name": "面试模拟官"}]},
                status="complete",
            ),
            ChatMessage(
                conversation_id=conversation.id,
                role="user",
                content="第二问",
                context={"skills": [{"id": skill.id, "name": "面试模拟官"}]},
                status="complete",
            ),
        ]
    )
    db_session.commit()

    prompt = build_compaction_skill_prompt(db_session, conversation.id)

    assert prompt.count("## 技能：面试模拟官") == 1  # 去重
    assert "甲" * 10 in prompt
    # 每个技能只取提示词前 5,000 字符（表头/包装另算），不会把 8,000 字原样挂回。
    assert "甲" * COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS in prompt
    assert "甲" * (COMPACTION_SKILL_PROMPT_PER_SKILL_CHARS + 1) not in prompt

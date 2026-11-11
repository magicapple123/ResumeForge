# SPDX-License-Identifier: Apache-2.0
"""#13A 重新生成：只重跑最后一条助手回答，旧回答标 superseded 并从列表过滤。

守四件事：
- 新端点不插入新的用户消息（history 里问题只出现一次、旧回答不进模型历史）；
- 旧消息 status=superseded + context.superseded_by=新消息 id，DB 保留；
- 会话详情与 messages_total 过滤被取代项；
- 非最后一条 / 用户消息 / 不存在的消息分别被拒（409/422/404），且不产生副作用。
"""

from __future__ import annotations

import json

from app.models.assistant import ChatMessage
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider

REPLY = "这是重新生成的回答"


def _configure_llm(client) -> None:
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="assistant-secret",
        model="assistant-model",
    )
    response = client.put("/api/settings/llm", json=config.model_dump())
    assert response.status_code == 200


def _create_conversation(client) -> int:
    response = client.post("/api/assistant/conversations", json={"title": "重生成验证"})
    assert response.status_code == 201
    return response.json()["id"]


def _seed_turn(session, conversation_id: int, question: str, answer: str) -> tuple[int, int]:
    user = ChatMessage(
        conversation_id=conversation_id,
        role="user",
        content=question,
        attachments=[],
        context={"web_search": False},
        status="complete",
    )
    assistant = ChatMessage(
        conversation_id=conversation_id,
        role="assistant",
        content=answer,
        attachments=[],
        context={},
        status="complete",
    )
    session.add_all([user, assistant])
    session.commit()
    return int(user.id), int(assistant.id)


class _CaptureProvider(BaseLLMProvider):
    """只回一段正文，并记录真正发给模型的 messages（用来验证历史口径）。"""

    def __init__(self, _config=None, captured: dict | None = None):
        self.captured = captured

    async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover
        raise NotImplementedError

    async def stream_chat(self, messages):
        if self.captured is not None:
            self.captured["messages"] = messages
        yield REPLY[:2]
        yield REPLY[2:]


def _patch_provider(monkeypatch, captured: dict | None = None) -> None:
    monkeypatch.setattr(
        "app.api.assistant_regenerate_api.create_provider",
        lambda _config: _CaptureProvider(captured=captured),
    )


def _events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def _regenerate(client, conversation_id: int, message_id: int, body: dict | None = None):
    return client.post(
        f"/api/assistant/conversations/{conversation_id}/messages/{message_id}/regenerate",
        json=body or {},
    )


def test_regenerate_replaces_last_answer_and_filters_it_out(client, db_session, monkeypatch):
    _configure_llm(client)
    captured: dict = {}
    _patch_provider(monkeypatch, captured)
    conversation_id = _create_conversation(client)
    _user_id, old_assistant_id = _seed_turn(db_session, conversation_id, "帮我看看简历", "旧回答")

    response = _regenerate(client, conversation_id, old_assistant_id)
    assert response.status_code == 200, response.text
    event_types = [event["type"] for event in _events(response)]
    assert event_types[0] == "start"
    assert event_types[-1] == "done"
    done = _events(response)[-1]["message"]
    new_id = int(done["id"])
    assert new_id != old_assistant_id
    assert done["content"] == REPLY

    db_session.expire_all()
    old_row = db_session.get(ChatMessage, old_assistant_id)
    assert old_row is not None  # DB 保留：不过滤底层行，只过滤列表
    assert old_row.status == "superseded"
    assert old_row.content == "旧回答"
    assert old_row.context["superseded_by"] == new_id

    detail = client.get(f"/api/assistant/conversations/{conversation_id}").json()
    visible_ids = [message["id"] for message in detail["messages"]]
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert new_id in visible_ids
    assert old_assistant_id not in visible_ids
    assert detail["messages_total"] == 2
    # 模型历史：问题只出现一次、旧回答不出现（重新生成不是"再插一条用户消息"）。
    flattened = json.dumps(captured["messages"], ensure_ascii=False)
    assert flattened.count("帮我看看简历") == 1
    assert "旧回答" not in flattened


def test_regenerate_rejects_non_last_answer(client, db_session, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch)
    conversation_id = _create_conversation(client)
    _user_id, first_assistant = _seed_turn(db_session, conversation_id, "第一个问题", "第一个回答")
    _seed_turn(db_session, conversation_id, "第二个问题", "第二个回答")

    response = _regenerate(client, conversation_id, first_assistant)
    assert response.status_code == 409
    db_session.expire_all()
    assert db_session.get(ChatMessage, first_assistant).status == "complete"
    assert db_session.query(ChatMessage).filter_by(conversation_id=conversation_id).count() == 4


def test_regenerate_rejects_user_message_and_unknown_message(client, db_session, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch)
    conversation_id = _create_conversation(client)
    user_id, assistant_id = _seed_turn(db_session, conversation_id, "问题", "回答")

    assert _regenerate(client, conversation_id, user_id).status_code == 422
    assert _regenerate(client, conversation_id, 999_999).status_code == 404
    assert _regenerate(client, conversation_id + 1, assistant_id).status_code == 404


def test_regenerate_chain_keeps_single_visible_answer(client, db_session, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch)
    conversation_id = _create_conversation(client)
    _user_id, first_assistant = _seed_turn(db_session, conversation_id, "问题", "第一版回答")
    first = _regenerate(client, conversation_id, first_assistant)
    assert first.status_code == 200, first.text
    second_assistant = int(_events(first)[-1]["message"]["id"])

    second = _regenerate(client, conversation_id, second_assistant)
    assert second.status_code == 200, second.text
    third_assistant = int(_events(second)[-1]["message"]["id"])

    # 已被取代的回答不能再点一次（否则会在历史里叠两条"被取代"），返回 409。
    assert _regenerate(client, conversation_id, second_assistant).status_code == 409

    detail = client.get(f"/api/assistant/conversations/{conversation_id}").json()
    visible_ids = [message["id"] for message in detail["messages"]]
    assert first_assistant not in visible_ids
    assert second_assistant not in visible_ids
    assert third_assistant in visible_ids
    assert len(visible_ids) == 2
    assert detail["messages_total"] == 2
    db_session.expire_all()
    kept = db_session.query(ChatMessage).filter_by(conversation_id=conversation_id).count()
    assert kept == 4  # user + 三条助手回答，DB 一行不删


def test_proposal_result_message_does_not_block_regenerate(client, db_session, monkeypatch):
    _configure_llm(client)
    _patch_provider(monkeypatch)
    conversation_id = _create_conversation(client)
    _user_id, assistant_id = _seed_turn(db_session, conversation_id, "问题", "回答")
    db_session.add(
        ChatMessage(
            conversation_id=conversation_id,
            role="assistant",
            content="写操作结果",
            attachments=[],
            context={},
            status="complete",
            kind="proposal_result",
        )
    )
    db_session.commit()

    response = _regenerate(client, conversation_id, assistant_id)
    assert response.status_code == 200, response.text

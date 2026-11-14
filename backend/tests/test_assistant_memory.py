# SPDX-License-Identifier: Apache-2.0
"""#31A/#31B/#31C + #18D 助手语义记忆：白名单、冲突版本、相关性注入、API 与抽取。

验收判据（问题清单 #31 验证段）：
- 说「我只看杭州和上海的机会」→ 抽取后 assistant_memory 出现 city，source_conversation_id 正确；
- 再说「上海太远了，只看杭州」→ 旧条 superseded、新条 active，两条都可回溯；
- 注入只出现与当前消息相关的记忆（top 5），未相关的不出现；
- 生成的记忆默认不可自动写入（开关默认关），用户可在设置页逐条编辑/删除/永不使用。
"""

import asyncio
from datetime import timedelta

import pytest
from app.models.ai_task import AI_TASK_KIND_ASSISTANT_MEMORY, AiTask
from app.models.assistant import ChatConversation, ChatMessage
from app.models.assistant_memory import (
    MEMORY_STATUS_ACTIVE,
    MEMORY_STATUS_SUPERSEDED,
    AssistantMemory,
)
from app.models.profile import utcnow
from app.services.ai_task_registry import registered_ai_task_kinds
from app.services.assistant import memory
from app.services.assistant.memory_extract import (
    mark_extracted,
    parse_extraction_response,
    run_extraction,
    should_schedule,
)


def _conversation(db_session, *, title: str = "测试对话") -> ChatConversation:
    conversation = ChatConversation(title=title)
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
    status: str = "complete",
) -> ChatMessage:
    message = ChatMessage(
        conversation_id=conversation.id,
        role=role,
        content=content,
        status=status,
        created_at=utcnow() - timedelta(minutes=minutes_ago),
    )
    db_session.add(message)
    db_session.commit()
    db_session.refresh(message)
    return message


class _FakeProvider:
    """只实现 chat() 的假模型：返回一条 ADD city 的 JSON。"""

    def __init__(self, response: str) -> None:
        self.response = response
        self.calls: list[list[dict]] = []

    async def chat(self, messages: list[dict]) -> str:
        self.calls.append(messages)
        return self.response


def test_kind_whitelist_and_sensitive_values_are_rejected():
    """只记七类求职事实；手机号/身份证/密钥一律拒绝（长期注入上下文的护栏）。"""
    with pytest.raises(memory.MemoryValidationError):
        memory.validate_memory("favorite_color", "蓝色")
    with pytest.raises(memory.MemoryValidationError):
        memory.validate_memory("city", "我的手机号是 13812345678")
    with pytest.raises(memory.MemoryValidationError):
        memory.validate_memory("constraint", "身份证 110101199001011234")
    with pytest.raises(memory.MemoryValidationError):
        memory.validate_memory("city", "   ")
    kind, key, value = memory.validate_memory("city", "  杭州  ", "  杭州  ")
    assert (kind, key, value) == ("city", "杭州", "杭州")


def test_create_memory_supersedes_conflicting_value(db_session):
    """冲突不删除：旧条 superseded、新条 active，两条都留着（可回溯当时说了什么）。"""
    first = memory.create_memory(db_session, kind="city", value="杭州")
    second = memory.create_memory(db_session, kind="city", value="上海")

    db_session.refresh(first)
    assert first.status == MEMORY_STATUS_SUPERSEDED
    assert second.status == MEMORY_STATUS_ACTIVE
    assert db_session.query(AssistantMemory).count() == 2


def test_duplicate_value_is_idempotent(db_session):
    """同一事实重复说一次不新增行：只刷新置信度。"""
    first = memory.create_memory(db_session, kind="city", value="杭州", confidence=0.5)
    again = memory.create_memory(db_session, kind="city", value="杭州", confidence=0.9)

    assert again.id == first.id
    assert db_session.query(AssistantMemory).count() == 1
    assert again.confidence == 0.9


def test_apply_operations_handles_all_four_kinds(db_session):
    """ADD / UPDATE / SUPERSEDE / NOOP / 非法条目：逐条计数，脏数据不拖垮整批。"""
    conversation = _conversation(db_session)
    memory.create_memory(db_session, kind="city", value="杭州")

    counts = memory.apply_operations(
        db_session,
        [
            {"op": "NOOP", "kind": "city", "value": "杭州"},
            {"op": "ADD", "kind": "salary_floor", "value": "不低于 18K"},
            {"op": "SUPERSEDE", "kind": "city", "value": "上海"},
            {"op": "ADD", "kind": "not-a-kind", "value": "x"},
            {"op": "ADD", "kind": "city", "value": "13812345678"},
        ],
        source_conversation_id=conversation.id,
        source_message_id=None,
    )

    assert counts["noop"] == 1
    assert counts["add"] == 1
    assert counts["supersede"] == 1
    assert counts["invalid"] == 2
    active_city = (
        db_session.query(AssistantMemory)
        .filter(AssistantMemory.kind == "city", AssistantMemory.status == MEMORY_STATUS_ACTIVE)
        .one()
    )
    assert active_city.value == "上海"
    assert active_city.source == "extracted"
    assert active_city.source_conversation_id == conversation.id


def test_relevant_memories_returns_top_five_and_empty_when_unrelated(db_session):
    """#31B：按当前消息相关性取 top 5；完全无关时不注入。"""
    # 每座城市用不同的 key，否则同 kind 同 key 会被判成冲突（旧的 superseded）。
    for value in ("杭州", "上海", "北京", "深圳", "广州", "成都"):
        memory.create_memory(db_session, kind="city", value=value, key=value)

    matched = memory.relevant_memories(db_session, "我只看杭州的机会")
    assert matched and len(matched) <= memory.INJECTION_TOP_N
    assert matched[0].value == "杭州"

    unrelated = memory.relevant_memories(db_session, "今天天气怎么样")
    assert unrelated == []


def test_render_memory_block_uses_latest_user_message(db_session):
    """注入块只出现在相关时；内容是固定区块格式。"""
    conversation = _conversation(db_session)
    memory.create_memory(db_session, kind="city", value="杭州")

    _message(db_session, conversation, "user", "我只看杭州的机会")
    block = memory.render_memory_block(db_session, conversation.id)
    assert "【关于用户的长期记忆】" in block
    assert "杭州" in block

    _message(db_session, conversation, "user", "帮我看看这个岗位的 JD")
    assert memory.render_memory_block(db_session, conversation.id) == ""


def test_api_create_list_edit_delete_and_never_use(client):
    """#31C：可见可改——创建、列表、编辑、删除、永不使用。"""
    assert client.get("/api/assistant/memories/settings").json() == {"auto_extract": False}

    created = client.post(
        "/api/assistant/memories",
        json={"kind": "city", "value": "杭州"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["kind"] == "city"
    assert body["kind_label"] == "意向城市"
    assert body["source"] == "manual"
    assert body["status"] == "active"

    listed = client.get("/api/assistant/memories").json()
    assert [item["id"] for item in listed] == [body["id"]]

    edited = client.patch(
        f"/api/assistant/memories/{body['id']}",
        json={"value": "杭州、上海", "confidence": 0.9},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["value"] == "杭州、上海"
    assert edited.json()["confidence"] == 0.9

    # F33：永不使用 = 停用（suppressed），条目仍留在列表里，可恢复；不是删除。
    never_used = client.post(f"/api/assistant/memories/{body['id']}/never-use")
    assert never_used.status_code == 200
    assert never_used.json()["status"] == "suppressed"
    listed = client.get("/api/assistant/memories").json()
    assert [item["id"] for item in listed] == [body["id"]]
    assert listed[0]["status"] == "suppressed"

    restored = client.post(f"/api/assistant/memories/{body['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"

    # 删除才是从列表消失（仍可回溯，不再注入）。
    assert client.delete(f"/api/assistant/memories/{body['id']}").status_code == 204
    assert client.get("/api/assistant/memories").json() == []


def test_api_rejects_unknown_kind_and_sensitive_value(client):
    bad_kind = client.post(
        "/api/assistant/memories", json={"kind": "favorite_color", "value": "蓝色"}
    )
    assert bad_kind.status_code == 422
    secret = client.post(
        "/api/assistant/memories", json={"kind": "city", "value": "电话 13812345678"}
    )
    assert secret.status_code == 422


def test_settings_switch_controls_auto_extract(client, db_session):
    """自动抽取默认关；打开后持久化（31C 的控制项）。"""
    assert client.put("/api/assistant/memories/settings", json={"auto_extract": True}).json() == {
        "auto_extract": True
    }
    assert memory.auto_extract_enabled(db_session) is True
    assert client.put("/api/assistant/memories/settings", json={"auto_extract": False}).json() == {
        "auto_extract": False
    }


def test_parse_extraction_response_tolerates_fences_and_rejects_garbage():
    text = '```json\n[{"op":"ADD","kind":"city","value":"杭州"}]\n```'
    operations = parse_extraction_response(text)
    assert operations == [{"op": "ADD", "kind": "city", "value": "杭州"}]
    assert parse_extraction_response("我不知道该记什么") is None
    assert parse_extraction_response("") is None


def test_run_extraction_learns_from_conversation(db_session):
    """#31A：一段对话 → ADD city，来源会话正确、cursor 前进。"""
    conversation = _conversation(db_session)
    _message(db_session, conversation, "user", "我只看杭州和上海的机会", minutes_ago=6)
    last = _message(db_session, conversation, "assistant", "好的，只记杭州和上海。", minutes_ago=5)
    provider = _FakeProvider(
        '[{"op": "ADD", "kind": "city", "key": "", "value": "杭州、上海", "confidence": 0.8}]'
    )

    counts = asyncio.run(
        run_extraction(db_session, conversation_id=conversation.id, provider=provider)
    )

    assert counts["parsed"] is True
    assert counts["add"] == 1
    learned = db_session.query(AssistantMemory).one()
    assert learned.value == "杭州、上海"
    assert learned.source == "extracted"
    assert learned.source_conversation_id == conversation.id
    assert learned.source_message_id == last.id
    assert provider.calls and "我只看杭州和上海的机会" in provider.calls[0][1]["content"]


def test_should_schedule_requires_switch_idle_and_cursor(db_session):
    """#31A 触发条件：开关 + 上一条助手回复已过 5 分钟 + 尚未抽取过。"""
    conversation = _conversation(db_session)
    _message(db_session, conversation, "user", "我只看杭州", minutes_ago=11)
    _message(db_session, conversation, "assistant", "好的", minutes_ago=10)
    db_session.add(
        ChatMessage(
            conversation_id=conversation.id,
            role="user",
            content="帮我看看岗位",
            status="complete",
        )
    )
    db_session.commit()

    assert should_schedule(db_session, conversation.id) is False, "默认关闭时不应登记"
    memory.set_auto_extract(db_session, True)
    assert should_schedule(db_session, conversation.id) is True

    mark_extracted(db_session, conversation.id, 3)
    assert should_schedule(db_session, conversation.id) is False, "已抽取的段落不重复抽"
    memory.set_auto_extract(db_session, False)


def test_should_schedule_blocks_when_a_task_is_already_running(db_session):
    conversation = _conversation(db_session)
    _message(db_session, conversation, "user", "我只看杭州", minutes_ago=11)
    _message(db_session, conversation, "assistant", "好的", minutes_ago=10)
    _message(db_session, conversation, "user", "帮我看看岗位")
    memory.set_auto_extract(db_session, True)
    db_session.add(
        AiTask(
            kind=AI_TASK_KIND_ASSISTANT_MEMORY,
            payload={"conversation_id": conversation.id},
            label="整理助手记忆",
        )
    )
    db_session.commit()

    assert should_schedule(db_session, conversation.id) is False


def test_memory_extract_handler_is_registered():
    """#31A 接 ai_task 执行器：kind 必须已登记（否则 API 层会 400）。"""
    assert AI_TASK_KIND_ASSISTANT_MEMORY in registered_ai_task_kinds()


def test_suppressed_is_not_reinjected_and_blocks_reextraction(db_session):
    """F33 最关键的一条：停用后不再注入，且同一事实不会被再次抽取出来。"""
    created = memory.create_memory(db_session, kind="city", value="杭州", source="manual")
    memory.suppress_memory(db_session, created)

    assert memory.active_memories(db_session) == []
    # 抽取器再看到同一句「我只考虑杭州」：必须当 NOOP，而不是把停用条目又变回生效。
    counts = memory.apply_operations(
        db_session,
        [{"op": "ADD", "kind": "city", "value": "杭州", "confidence": 0.9}],
    )
    assert counts["add"] == 0
    assert counts["noop"] == 1
    db_session.refresh(created)
    assert created.status == "suppressed"

    memory.restore_memory(db_session, created)
    assert [item.value for item in memory.active_memories(db_session)] == ["杭州"]


def test_memory_history_records_each_action_in_reverse_order(client):
    """历史按时间倒序：create → update → suppress → restore。"""
    created = client.post("/api/assistant/memories", json={"kind": "city", "value": "杭州"}).json()
    mid = created["id"]
    client.patch(f"/api/assistant/memories/{mid}", json={"value": "杭州、上海"})
    client.post(f"/api/assistant/memories/{mid}/never-use")
    client.post(f"/api/assistant/memories/{mid}/restore")

    history = client.get(f"/api/assistant/memories/{mid}/history")
    assert history.status_code == 200, history.text
    actions = [item["action"] for item in history.json()]
    assert actions == ["restore", "suppress", "update", "create"]
    update = history.json()[2]
    assert update["before"] == "杭州"
    assert update["after"] == "杭州、上海"


def test_source_excerpt_is_returned_for_extracted_memory(client, db_session):
    """来源摘录：让人看见"这句话是从哪儿学来的"，最多 60 字。"""
    conversation = _conversation(db_session)
    message = _message(
        db_session,
        conversation,
        "user",
        "我只考虑杭州的机会，最好离地铁近一点，通勤别超过四十分钟，谢谢。",
    )
    record = memory.create_memory(
        db_session,
        kind="city",
        value="杭州",
        source="extracted",
        conversation_id=conversation.id,
        message_id=message.id,
    )
    listed = client.get("/api/assistant/memories").json()
    row = next(item for item in listed if item["id"] == record.id)
    assert row["source_excerpt"].startswith("我只考虑杭州")
    assert len(row["source_excerpt"]) <= 60

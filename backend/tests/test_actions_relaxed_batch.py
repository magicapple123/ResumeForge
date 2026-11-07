# SPDX-License-Identifier: Apache-2.0
"""T28 收尾：relaxed spec + p3_tools 四对的奇偶校验（旧实现委托范式）。

迁移对（run/run_tool 都直接委托既有实现，本文件只验证接线与行为一致性）：

- list_chat_conversations ↔ GET /api/assistant/conversations
- get_chat_conversation  ↔ GET /api/assistant/conversations/{conversation_id}
- list_web_form_fills    ↔ GET /api/webform/records
- list_match_analyses    ↔ GET /api/jobs/match-batches

get_web_form_fill 未迁移（路由参数 record_id vs 工具参数 fill_id），见 domains/webform.py。

每个用例对着**真实路由 + 真实工具**跑同一份输入：
- spec.run 的 data 经 response_model 序列化后与原路由 JSON 逐字段相同；
- spec.run_tool 的 text/summary/link/changed 与 execute_tool 一致；
- 缺失对象两侧都是 404（委托路由保留 HTTPException，不转 ActionError）；
- 非法输入路由 422、契约层 invalid_input；
- 工具 schema 不出现 tool_fields 剪掉的路由专属参数；
- 旧工具默认值（limit=20 / limit=5）由 tool_defaults 保留。
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest
from app.models.assistant import ChatConversation, ChatMessage
from app.models.job_match_batch import JobMatchBatch
from app.models.web_form_record import WebFormFillRecord
from app.services.actions import action_names
from app.services.actions.domains.chat import chat_actions
from app.services.actions.domains.match_analyses import match_analysis_actions
from app.services.actions.domains.webform import webform_actions
from app.services.actions.spec import ActionError, validate_input
from app.services.assistant_tools import execute_tool, get_tool, tool_definitions
from fastapi import HTTPException
from pydantic import TypeAdapter

EXPECTED = {
    "list_chat_conversations": ("GET", "/api/assistant/conversations", True),
    "get_chat_conversation": (
        "GET",
        "/api/assistant/conversations/{conversation_id}",
        True,
    ),
    "list_web_form_fills": ("GET", "/api/webform/records", True),
    "list_match_analyses": ("GET", "/api/jobs/match-batches", False),
    "get_web_form_fill": ("GET", "/api/webform/records/{record_id}", True),
}


def _actions() -> dict:
    return {**chat_actions(), **webform_actions(), **match_analysis_actions()}


def _jsonable(spec, data: Any) -> Any:
    """按路由 response_model 把 spec.run 的 data 序列化成与 HTTP JSON 可比的形状。"""
    adapter = TypeAdapter(spec.http.response_model)
    return adapter.dump_python(adapter.validate_python(data), mode="json")


def _make_conversation(
    db_session, title: str, *, surface: str = "page", messages: tuple[tuple[str, str], ...] = ()
) -> ChatConversation:
    conversation = ChatConversation(title=title, surface=surface)
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    for role, content in messages:
        db_session.add(
            ChatMessage(
                conversation_id=conversation.id,
                role=role,
                content=content,
                status="complete",
            )
        )
    if messages:
        db_session.commit()
    return conversation


def _make_fill(
    db_session, page_title: str, url: str = "https://example.com/apply"
) -> WebFormFillRecord:
    record = WebFormFillRecord(
        page_title=page_title,
        url=url,
        items=[{"index": 0, "field": "phone", "value": "138-0000-0000", "status": "filled"}],
        filled=1,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _batch_items() -> list[dict]:
    return [
        {
            "job_id": 1,
            "job_title": "后端开发",
            "company": "示例科技",
            "status": "completed",
            "reference_score": {"score": 87},
            "rank": 1,
            "result": {
                "hard_gate": "met",
                "admission": "allow",
                "advice": "匹配度 87 分，建议强化项目描述",
                "hard_conditions": [{"status": "matched"}],
            },
        }
    ]


def _make_batch(db_session, requested: int = 2) -> JobMatchBatch:
    batch = JobMatchBatch(
        requested_count=requested,
        completed_count=1,
        failed_count=0,
        items=_batch_items(),
        model="demo",
    )
    db_session.add(batch)
    db_session.commit()
    db_session.refresh(batch)
    return batch


def test_actions_registered_as_route_tool_pairs():
    actions = _actions()
    assert set(actions) == set(EXPECTED)
    names = set(action_names())
    assert set(EXPECTED) <= names
    for name, (method, path, relaxed) in EXPECTED.items():
        spec = actions[name]
        assert (spec.http.method, spec.http.path) == (method, path)
        assert spec.http.status_code == 200
        tool = get_tool(name)
        assert tool is not None and tool.permission is spec.permission
        assert tool.requires_relaxed is relaxed, name
        assert spec.run is not None and spec.run_tool is not None
    # 放宽门控确实生效：不开放宽模式时三条敏感工具不下发，只读匹配分析照常下发。
    visible = {
        item["function"]["name"] for item in tool_definitions(web_search=False, relaxed=False)
    }
    assert "list_match_analyses" in visible
    for name in ("list_chat_conversations", "get_chat_conversation", "list_web_form_fills"):
        assert name not in visible


def test_list_chat_conversations_route_matches_action_run(client, db_session):
    _make_conversation(db_session, "检索方案讨论", messages=(("user", "怎么优化检索"),))
    _make_conversation(db_session, "简历修改")
    _make_conversation(db_session, "悬浮球里的对话", surface="floating")
    spec = _actions()["list_chat_conversations"]
    response = client.get("/api/assistant/conversations")
    assert response.status_code == 200, response.text
    outcome = spec.run(db_session, spec.input_model())
    assert _jsonable(spec, outcome.data) == response.json()
    assert {item["title"] for item in response.json()} == {"检索方案讨论", "简历修改"}
    # keyword 过滤两侧同源（路由 handler 与 run 是同一份实现）。
    filtered = client.get("/api/assistant/conversations", params={"keyword": "检索"})
    filtered_outcome = spec.run(db_session, spec.input_model(keyword="检索"))
    assert _jsonable(spec, filtered_outcome.data) == filtered.json()
    assert [item["title"] for item in filtered.json()] == ["检索方案讨论"]


def test_get_chat_conversation_route_matches_action_run(client, db_session):
    conversation = _make_conversation(
        db_session, "面试复盘对话", messages=(("user", "一面问了什么"), ("assistant", "索引与事务"))
    )
    spec = _actions()["get_chat_conversation"]
    response = client.get(f"/api/assistant/conversations/{conversation.id}")
    assert response.status_code == 200, response.text
    outcome = spec.run(db_session, spec.input_model(conversation_id=conversation.id))
    assert _jsonable(spec, outcome.data) == response.json()
    assert [message["role"] for message in response.json()["messages"]] == ["user", "assistant"]
    # message_limit 是路由专属参数：工具 schema 里不出现，但 run 侧仍按 route handler 语义工作。
    limited = client.get(
        f"/api/assistant/conversations/{conversation.id}", params={"message_limit": 1}
    )
    limited_outcome = spec.run(
        db_session, spec.input_model(conversation_id=conversation.id, message_limit=1)
    )
    assert _jsonable(spec, limited_outcome.data) == limited.json()
    assert limited.json()["has_earlier"] is True


def test_chat_missing_conversation_is_404_on_both_sides(client, db_session):
    response = client.get("/api/assistant/conversations/999999")
    assert response.status_code == 404
    spec = _actions()["get_chat_conversation"]
    with pytest.raises(HTTPException) as info:
        spec.run(db_session, spec.input_model(conversation_id=999999))
    assert info.value.status_code == response.status_code == 404
    with pytest.raises(ValueError):  # 工具侧仍是旧 handler 的 ValueError
        execute_tool(db_session, "get_chat_conversation", {"conversation_id": 999999})


def test_list_web_form_fills_route_matches_action_run(client, db_session):
    _make_fill(db_session, "某银行网申", "https://bank.example.com/apply")
    _make_fill(db_session, "某大厂网申", "https://corp.example.com/jobs/1")
    spec = _actions()["list_web_form_fills"]
    response = client.get("/api/webform/records")
    assert response.status_code == 200, response.text
    outcome = spec.run(db_session, spec.input_model())
    assert _jsonable(spec, outcome.data) == response.json()
    # keyword 是工具专属参数：旧路由 handler 没有它（路由侧忽略），工具侧按关键词过滤。
    filtered = client.get("/api/webform/records", params={"keyword": "银行"})
    filtered_outcome = spec.run(db_session, spec.input_model(keyword="银行"))
    assert _jsonable(spec, filtered_outcome.data) == filtered.json()
    assert len(filtered.json()) == 2
    import json

    tool_payload = json.loads(
        execute_tool(db_session, "list_web_form_fills", {"keyword": "银行"}).text
    )
    assert [item["页面"] for item in tool_payload["填充记录"]] == ["某银行网申"]


def test_list_match_analyses_route_matches_action_run(client, db_session):
    _make_batch(db_session)
    spec = _actions()["list_match_analyses"]
    response = client.get("/api/jobs/match-batches")
    assert response.status_code == 200, response.text
    outcome = spec.run(db_session, spec.input_model())
    assert _jsonable(spec, outcome.data) == response.json()
    # 产品红线：路由摘要含 top_score（界面既有行为），工具返回里必须剔除分数。
    assert response.json()[0]["top_score"] == 87
    text = execute_tool(db_session, "list_match_analyses", {}).text
    assert "87" not in text
    assert "top_score" not in text and "reference_score" not in text


def test_run_tool_matches_execute_tool(client, db_session):
    conversation = _make_conversation(
        db_session, "回看对话", messages=(("user", "上次说的方案"), ("assistant", "方案如下"))
    )
    _make_fill(db_session, "网申记录")
    _make_batch(db_session)
    actions = _actions()
    cases = [
        ("list_chat_conversations", {"keyword": "回看"}),
        ("get_chat_conversation", {"conversation_id": conversation.id}),
        ("list_web_form_fills", {"keyword": "网申"}),
        ("list_match_analyses", {"limit": 1}),
    ]
    for name, arguments in cases:
        spec = actions[name]
        expected = execute_tool(db_session, name, dict(arguments))
        outcome = spec.run_tool(db_session, spec.input_model(**arguments))
        assert outcome.text == expected.text, name
        assert outcome.summary == expected.summary, name
        assert outcome.link == expected.link, name
        assert outcome.changed is expected.changed, name


def test_tool_defaults_are_the_old_values(client, db_session):
    for index in range(25):
        _make_conversation(db_session, f"对话-{index:02d}")
    for index in range(25):
        _make_fill(db_session, f"网申-{index:02d}")
    for _index in range(7):
        _make_batch(db_session)
    # chat：工具默认 20，路由默认 100（路由返回 25 条）。
    chat_payload = execute_tool(db_session, "list_chat_conversations", {})
    import json

    chat_text = json.loads(chat_payload.text)
    assert chat_text["返回"] == 20 and chat_text["总数"] == 25
    assert len(client.get("/api/assistant/conversations").json()) == 25
    assert (
        execute_tool(db_session, "list_chat_conversations", {"limit": 20}).text == chat_payload.text
    )
    # webform：工具与路由的默认都是 20，显式 20 与缺省一致。
    fill_payload = execute_tool(db_session, "list_web_form_fills", {})
    assert json.loads(fill_payload.text)["返回"] == 20
    assert execute_tool(db_session, "list_web_form_fills", {"limit": 20}).text == fill_payload.text
    # match_analyses：工具默认 5（旧 handler 口径），路由默认 30。
    match_text = json.loads(execute_tool(db_session, "list_match_analyses", {}).text)
    assert match_text["总批次"] == 5
    assert match_text == json.loads(
        execute_tool(db_session, "list_match_analyses", {"limit": 5}).text
    )
    assert len(client.get("/api/jobs/match-batches").json()) == 7


def test_route_only_fields_are_hidden_from_tool_schema():
    expected = {
        "list_chat_conversations": (["keyword", "limit"], []),
        "get_chat_conversation": (["conversation_id"], ["conversation_id"]),
        "list_web_form_fills": (["keyword", "limit"], []),
        "list_match_analyses": (["limit"], []),
    }
    for name, (properties, required) in expected.items():
        tool = get_tool(name)
        assert sorted(tool.parameters["properties"]) == sorted(properties), name
        assert tool.parameters["required"] == required, name
    # 路由专属参数没有漏进工具 schema。
    for name in EXPECTED:
        properties = get_tool(name).parameters["properties"]
        assert "surface" not in properties and "message_limit" not in properties


def test_input_model_defaults_match_old_route_defaults():
    from app.api.assistant import list_conversations as list_handler
    from app.api.assistant import read_conversation as read_handler
    from app.api.job_match import get_match_batch_history
    from app.api.webform.fill_routes import list_records

    def query_default(handler, name: str):
        default = inspect.signature(handler).parameters[name].default
        return getattr(default, "default", default)

    chat_actions_map = _actions()
    chat_list = chat_actions_map["list_chat_conversations"].input_model
    assert chat_list.model_fields["limit"].default == query_default(list_handler, "limit") == 100
    assert chat_list.model_fields["keyword"].default == query_default(list_handler, "keyword")
    chat_get = chat_actions_map["get_chat_conversation"].input_model
    assert chat_get.model_fields["message_limit"].default == query_default(
        read_handler, "message_limit"
    )
    webform = chat_actions_map["list_web_form_fills"].input_model
    assert webform.model_fields["limit"].default == query_default(list_records, "limit") == 20
    assert webform.model_json_schema()["properties"]["limit"]["maximum"] == 200
    match = chat_actions_map["list_match_analyses"].input_model
    assert (
        match.model_fields["limit"].default == query_default(get_match_batch_history, "limit") == 30
    )


def test_invalid_input_route_422_and_contract_invalid_input(client, db_session):
    cases = [
        ("list_chat_conversations", {"limit": "abc"}, "/api/assistant/conversations"),
        ("list_web_form_fills", {"limit": "abc"}, "/api/webform/records"),
        ("list_match_analyses", {"limit": "abc"}, "/api/jobs/match-batches"),
    ]
    actions = _actions()
    for name, bad, path in cases:
        spec = actions[name]
        response = client.get(path, params=bad)
        assert response.status_code == 422, (name, response.text)
        with pytest.raises(ActionError) as info:
            validate_input(spec, bad)
        assert info.value.code == "invalid_input"
        assert info.value.http_status == response.status_code
    # 路径参数非整数：旧路由 422；契约层同样是 invalid_input（422）。
    response = client.get("/api/assistant/conversations/not-an-int")
    assert response.status_code == 422
    with pytest.raises(ActionError) as info:
        validate_input(_actions()["get_chat_conversation"], {"conversation_id": "not-an-int"})
    assert info.value.code == "invalid_input"


def test_unknown_arguments_are_ignored_like_before(db_session):
    """旧路由忽略未知 query、旧工具 handler 忽略声明外参数：委托范式保持同一行为。"""
    spec = _actions()["list_match_analyses"]
    payload = validate_input(spec, {"limit": 3, "unknown_query": "x"})
    assert payload.limit == 3
    tool = get_tool("list_match_analyses")
    assert set(tool.parameters["properties"]) == {"limit"}
    stripped = execute_tool(db_session, "list_match_analyses", {"unknown_argument": "x"})
    assert stripped.text == execute_tool(db_session, "list_match_analyses", {}).text

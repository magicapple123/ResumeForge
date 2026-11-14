# SPDX-License-Identifier: Apache-2.0
"""R-18 上下文策略的边界：请求级阈值只作用于这次请求、超限闸门、存储用量的重算。

三件最容易出错的事：

- 绝对阈值（token 数）要按当前窗口夹取，且**不能**改到全局默认；
- 压缩后仍超窗口，必须在调用模型**之前**抛错，错误码要脱敏（不回显 body）；
- 流结束后重开对话，用量要按**当前模型**的窗口重算，不能沿用旧模型的比例。
"""

import json
from unittest.mock import AsyncMock

import pytest
from app.database import SessionLocal
from app.models.assistant import ChatMessage
from app.models.setting import AppSetting
from app.schemas.assistant import AssistantMessageCreate
from app.schemas.setting import LLMConfig
from app.services.assistant import assistant_compaction_store as store
from app.services.assistant.assistant_compaction_plan import CompactionLimits
from app.services.assistant.assistant_context_policy import (
    ContextWindowExceeded,
    compact_turn_context,
    ensure_context_fits,
    model_error_event,
    request_compaction_limits,
    with_window_policy,
)
from app.services.llm.base import LLMError
from app.services.model_context_windows import ModelWindow
from pydantic import ValidationError
from test_assistant import _create_conversation, _events, _successful_provider


def _configure(client, *, window=1_000_000, model="assistant-model"):
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="assistant-secret",
        model=model,
        context_window_tokens=window,
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _usage(tokens):
    return {
        "total": tokens,
        "buckets": [{"key": "conversation", "tokens": tokens}],
        "percent": None,
        "window": 0,
        "partial": False,
        "usage_actual": None,
    }


def test_absolute_override_is_precise_clamped_and_leaves_defaults_unchanged():
    defaults = CompactionLimits(60, 75)
    early = request_compaction_limits(1_000_000, defaults, 200_000)
    assert early == CompactionLimits(20, 20)
    assert defaults == CompactionLimits(60, 75)
    assert request_compaction_limits(128_000, defaults, 200_000).summary_percent == 90
    assert request_compaction_limits(128_000, CompactionLimits(95, 99)).summary_percent == 90
    precise = request_compaction_limits(1_047_576, defaults, 200_000)
    usage = with_window_policy(_usage(100), ModelWindow(1_047_576, "reference"), precise)
    assert usage["trigger_tokens"] == 200_000


@pytest.mark.parametrize("value", [0, -1, 2_000_001])
def test_invalid_runtime_threshold_rejected_by_schema(value):
    with pytest.raises(ValidationError):
        AssistantMessageCreate(content="hello", compaction_threshold_tokens=value)


@pytest.mark.asyncio
async def test_a_override_and_b_global_are_independent_and_never_saved(
    client, db_session, monkeypatch
):
    _configure(client)
    conversation_a = _create_conversation(client)["id"]
    conversation_b = _create_conversation(client)["id"]
    before = {row.key: row.value for row in db_session.query(AppSetting).all()}
    compact = AsyncMock(side_effect=lambda messages, **_kwargs: (messages, {}))
    monkeypatch.setattr(store, "compact_before_model", compact)
    for conversation_id, threshold in [(conversation_a, 200_000), (conversation_b, None)]:
        _messages, _flags, usage = await compact_turn_context(
            [{"role": "user", "content": "hello"}],
            usage=_usage(5),
            window=ModelWindow(1_000_000, "manual"),
            threshold_tokens=threshold,
            factory=SessionLocal,
            conversation_id=conversation_id,
            provider=None,
            history=[],
            history_count=0,
        )
        assert usage["trigger_tokens"] == (threshold or 750_000)
        assert usage["default_trigger_tokens"] == 750_000
    assert [call.kwargs["limits"].summary_percent for call in compact.await_args_list] == [20, 75]
    db_session.expire_all()
    assert {row.key: row.value for row in db_session.query(AppSetting).all()} == before


@pytest.mark.asyncio
async def test_model_switch_compacts_before_final_check(client, monkeypatch):
    _configure(client)
    conversation_id = _create_conversation(client)["id"]
    shrunk = [{"role": "user", "content": "界" * 100}]
    compact = AsyncMock(return_value=(shrunk, {"compacted": True}))
    monkeypatch.setattr(store, "compact_before_model", compact)
    result, flags, _usage_out = await compact_turn_context(
        [{"role": "user", "content": "界" * 950}],
        usage=_usage(990),
        window=ModelWindow(1_000, "manual"),
        threshold_tokens=200_000,
        factory=SessionLocal,
        conversation_id=conversation_id,
        provider=None,
        history=[],
        history_count=0,
    )
    compact.assert_awaited_once()
    assert compact.await_args.kwargs["limits"].summary_percent == 90
    assert result == shrunk and flags["compacted"] is True


@pytest.mark.asyncio
async def test_remaining_oversize_includes_tool_schema_and_rejects(client, monkeypatch):
    _configure(client)
    conversation_id = _create_conversation(client)["id"]
    compact = AsyncMock(return_value=([{"role": "user", "content": "界" * 100}], {}))
    monkeypatch.setattr(store, "compact_before_model", compact)
    with pytest.raises(ContextWindowExceeded, match="新建对话"):
        await compact_turn_context(
            [{"role": "user", "content": "界" * 950}],
            usage=_usage(1_800),
            window=ModelWindow(1_000, "manual"),
            threshold_tokens=None,
            factory=SessionLocal,
            conversation_id=conversation_id,
            provider=None,
            history=[],
            history_count=0,
        )
    compact.assert_awaited_once()
    ensure_context_fits([{"content": "界" * 900}], 1_000)


def test_stream_rejects_oversize_without_calling_model(client, monkeypatch):
    _configure(client, window=1)
    captured = {}
    _successful_provider(monkeypatch, captured)
    conversation_id = _create_conversation(client)["id"]
    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/messages", json={"content": "hello"}
    )
    error = next(event for event in _events(response) if event["type"] == "error")
    assert error["code"] == "context_window"
    assert "新建对话" in error["message"]
    assert captured == {}


def test_runtime_threshold_sse_is_not_in_db_and_reopen_uses_global(client, db_session, monkeypatch):
    _configure(client)
    _successful_provider(monkeypatch)
    conversation_id = _create_conversation(client)["id"]
    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": "hello", "compaction_threshold_tokens": 200_000},
    )
    usage = next(event["usage"] for event in _events(response) if event["type"] == "context_usage")
    assert usage["trigger_tokens"] == 200_000
    assert usage["default_trigger_tokens"] == 750_000
    db_session.expire_all()
    for message in db_session.query(ChatMessage).filter_by(conversation_id=conversation_id):
        assert "trigger_tokens" not in json.dumps(message.context)
        assert "compaction_threshold_tokens" not in json.dumps(message.context)
    reopened = client.get(f"/api/assistant/conversations/{conversation_id}/context-usage").json()
    assert reopened["trigger_tokens"] == reopened["default_trigger_tokens"] == 750_000


def test_stored_usage_recalculates_current_model_window_and_source(client, monkeypatch):
    _configure(client, window=200_000)
    _successful_provider(monkeypatch)
    conversation_id = _create_conversation(client)["id"]
    client.post(
        f"/api/assistant/conversations/{conversation_id}/messages", json={"content": "hello"}
    )
    _configure(client, window=0, model="vendor/gpt-4.1")
    usage = client.get(f"/api/assistant/conversations/{conversation_id}/context-usage").json()
    assert usage["window"] == 1_047_576
    assert usage["window_source"] == "reference"
    assert usage["trigger_tokens"] == 785_682
    assert usage["percent"] == round(usage["total"] / 1_047_576 * 100, 1)
    _configure(client, window=0, model="unknown")
    fallback = client.get(f"/api/assistant/conversations/{conversation_id}/context-usage").json()
    assert fallback["window"] == 128_000
    assert fallback["window_source"] == "fallback"


def test_context_length_error_code_is_sanitized_and_regular_errors_stay_generic():
    error = LLMError("provider secret/raw request data")
    error.context_length_error = True
    event = model_error_event(error)
    assert event["code"] == "context_length"
    assert "secret" not in event["message"]
    regular = model_error_event(LLMError("context length text alone does not classify"))
    assert "code" not in regular


def test_regeneration_uses_runtime_threshold_only():
    from app.api.assistant_regenerate_api import AssistantRegenerateRequest, _replay_payload

    message = ChatMessage(content="hello", context={"compaction_threshold_tokens": 99})
    replay = _replay_payload(
        message, AssistantRegenerateRequest(compaction_threshold_tokens=200_000)
    )
    assert replay.compaction_threshold_tokens == 200_000
    assert (
        _replay_payload(message, AssistantRegenerateRequest()).compaction_threshold_tokens is None
    )


@pytest.mark.asyncio
async def test_override_reaches_real_compaction_planner_while_b_remains_uncompacted(
    client, db_session
):
    from test_assistant_compaction import VALID_SUMMARY, _StubProvider

    _configure(client)
    ids = [_create_conversation(client)["id"] for _ in range(2)]
    for conversation_id in ids:
        for index in range(10):
            for role in ("user", "assistant"):
                db_session.add(
                    ChatMessage(
                        conversation_id=conversation_id,
                        role=role,
                        status="complete",
                        content=f"round {index} " + "界" * 1_000,
                    )
                )
    db_session.commit()
    provider = _StubProvider(VALID_SUMMARY)
    for conversation_id, threshold in zip(ids, [10_000, None], strict=True):
        history = [
            {"id": message.id, "role": message.role, "content": message.content}
            for message in db_session.query(ChatMessage)
            .filter_by(conversation_id=conversation_id)
            .order_by(ChatMessage.id)
        ]
        messages = [{"role": "system", "content": "pinned"}] + [
            {"role": entry["role"], "content": entry["content"]} for entry in history
        ]
        _current, flags, _context = await compact_turn_context(
            messages,
            usage=_usage(20_500),
            window=ModelWindow(1_000_000, "manual"),
            threshold_tokens=threshold,
            factory=SessionLocal,
            conversation_id=conversation_id,
            provider=provider,
            history=history,
            history_count=len(history),
        )
        assert bool(flags.get("compacted")) is (threshold is not None)
    assert len(provider.calls) == 1
    db_session.expire_all()
    assert store.load_compaction(db_session, ids[0])["covered_until_message_id"] is not None
    assert store.load_compaction(db_session, ids[1]) == {}
    assert db_session.query(ChatMessage).filter(ChatMessage.conversation_id.in_(ids)).count() == 40

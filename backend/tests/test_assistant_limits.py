# SPDX-License-Identifier: Apache-2.0
"""求职助手的运行上限（需求 #5）：轮次上限默认 30、整链预算默认 1800 秒。

钉住的性质：
- GET 在 DB 空时给出默认值，且与 ``services/assistant_limits`` 的常量逐项一致；
- PUT 写后 GET 读回同一组值（DB 优先），跨请求持久；
- 越界/类型不对直接 422，脏数据（库里躺着坏 JSON）读回默认而不是 500；
- 轮次上限**真的**落在编排层：设成 2 就只发起 2 次模型调用，并下发 round_limit
  事件（前端据此给「继续」入口）。
"""

import pytest
from app.config import Settings
from app.models.setting import AppSetting
from app.schemas.setting import AssistantLimitSetting
from app.services import assistant_limits
from test_assistant import (
    _configure_llm,
    _create_conversation,
    _events,
    _ScriptedProvider,
    _tool_call,
)

DEFAULTS = {"max_tool_rounds": 30, "stream_budget_seconds": 1800}


def test_module_defaults_match_the_request_schema():
    """两处默认值必须一致：服务层是行为真相，schema 是接口文档，漂移了就该红。"""
    assert DEFAULTS["max_tool_rounds"] == assistant_limits.DEFAULT_MAX_TOOL_ROUNDS
    schema = AssistantLimitSetting()
    assert schema.max_tool_rounds == DEFAULTS["max_tool_rounds"]
    assert schema.stream_budget_seconds == DEFAULTS["stream_budget_seconds"]
    # 声明的部署默认（不看环境变量）必须是 1800：它是 DB 缺省时的预算兜底。
    assert Settings.model_fields["assistant_stream_budget_seconds"].default == 1800


def test_empty_db_reads_defaults(client):
    response = client.get("/api/settings/assistant-limits")

    assert response.status_code == 200
    assert response.json() == DEFAULTS


def test_put_persists_and_reads_back(client):
    response = client.put(
        "/api/settings/assistant-limits",
        json={"max_tool_rounds": 7, "stream_budget_seconds": 900},
    )

    assert response.status_code == 200
    assert response.json() == {"max_tool_rounds": 7, "stream_budget_seconds": 900}
    # 重新 GET：值来自 AppSetting，不是内存态。
    assert client.get("/api/settings/assistant-limits").json() == {
        "max_tool_rounds": 7,
        "stream_budget_seconds": 900,
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"max_tool_rounds": 0, "stream_budget_seconds": 900},
        {"max_tool_rounds": 101, "stream_budget_seconds": 900},
        {"max_tool_rounds": 5, "stream_budget_seconds": 0},
        {"max_tool_rounds": 5, "stream_budget_seconds": 86401},
        # 类型不对（字符串）也要拒绝，不靠 pydantic 的宽松转换。
        {"max_tool_rounds": "many", "stream_budget_seconds": 900},
    ],
)
def test_out_of_range_is_rejected_and_nothing_is_written(client, payload):
    response = client.put("/api/settings/assistant-limits", json=payload)

    assert response.status_code == 422
    # 拒绝就是拒绝：库里的值不能被半写（此前一次成功也没发生）。
    assert client.get("/api/settings/assistant-limits").json() == DEFAULTS


@pytest.mark.parametrize(
    ("key", "raw"),
    [
        (assistant_limits.MAX_TOOL_ROUNDS_KEY, "not-json"),  # 坏 JSON
        (assistant_limits.MAX_TOOL_ROUNDS_KEY, "true"),  # bool 是 int 子类，不能当 1 轮
        (assistant_limits.STREAM_BUDGET_SECONDS_KEY, "0"),  # 越界
        (assistant_limits.STREAM_BUDGET_SECONDS_KEY, "[]"),  # 类型不对
    ],
)
def test_corrupted_values_fall_back_to_defaults(client, db_session, key, raw):
    """库里躺着坏值时不抛 500，也不拿着脏值跑对话——回默认是唯一安全侧。"""
    db_session.add(AppSetting(key=key, value=raw))
    db_session.commit()

    assert client.get("/api/settings/assistant-limits").json() == DEFAULTS


def test_tool_round_loop_honours_the_configured_limit(client, monkeypatch):
    """设成 2 轮：模型调用只有 2 次、正文有截断说明、SSE 下发 round_limit。"""
    _configure_llm(client)
    assert (
        client.put(
            "/api/settings/assistant-limits",
            json={"max_tool_rounds": 2, "stream_budget_seconds": 1800},
        ).status_code
        == 200
    )
    # 每一轮都要求调用工具，永不收敛。
    provider = _ScriptedProvider([[_tool_call("get_overview", {})]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "一直查下去"},
    )
    events = _events(response)

    assert len(provider.requests) == 2
    limit_events = [event for event in events if event["type"] == "round_limit"]
    assert limit_events == [{"type": "round_limit", "rounds": 2}]
    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assistant = detail["messages"][1]
    assert "先停在这里" in assistant["content"]
    assert "继续" in assistant["content"]


def test_round_limit_is_reread_on_every_round(client, monkeypatch):
    """生成途中把上限改小，**下一轮立刻生效**（逐轮重读，不靠请求开始时的快照）。

    第 1 轮读到 3 → 允许；这一轮的模型调用里把 DB 改成 1；第 2 轮重读到 1，已经跑过
    1 轮，于是停下——所以模型调用总数是 1，而 round_limit 报的是 1。
    """
    from app.database import SessionLocal

    _configure_llm(client)
    assert (
        client.put(
            "/api/settings/assistant-limits",
            json={"max_tool_rounds": 3, "stream_budget_seconds": 1800},
        ).status_code
        == 200
    )

    class _ShrinkingProvider(_ScriptedProvider):
        async def stream_chat_events(self, messages, tools=None):
            self.requests.append({"messages": list(messages), "tools": tools})
            # 用户在生成途中把轮次上限从 3 改到 1（走同一套服务层写口）。
            with SessionLocal() as db:
                assistant_limits.save_max_tool_rounds(db, 1)
            for delta in self.rounds[0]:
                yield delta

    provider = _ShrinkingProvider([[_tool_call("get_overview", {})]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "一直查下去"},
    )
    events = _events(response)

    assert len(provider.requests) == 1
    assert [event for event in events if event["type"] == "round_limit"] == [
        {"type": "round_limit", "rounds": 1}
    ]


def test_budget_override_reaches_the_stream_tracker(client):
    """DB 里设过的预算优先于 config 默认（部署侧配置不被顶掉靠的是 None 分支）。"""
    from app.config import get_settings
    from app.database import SessionLocal

    with SessionLocal() as db:
        assert assistant_limits.get_stream_budget_override(db) is None
        assert (
            assistant_limits.get_stream_budget_seconds(db)
            == get_settings().assistant_stream_budget_seconds
        )
        assistant_limits.save_stream_budget_seconds(db, 42)
        assert assistant_limits.get_stream_budget_override(db) == 42
        assert assistant_limits.get_stream_budget_seconds(db) == 42
        # 预算「下一次请求生效」：运行中的流持有自己的 OperationBudget 快照。
        from app.services.assistant.assistant_stream_budget import AssistantStreamBudget

        assert AssistantStreamBudget(stream_budget_seconds=42).operation_budget is not None
        assert AssistantStreamBudget().operation_budget is not None


# ===== 详册 #5 的 5.3：L1 单条工具结果上限 =====


def test_tool_result_limit_defaults_to_8000_and_zero_means_unlimited(db_session):
    """默认值来自服务常量；0 是"用户主动不限"，不是漏配。"""
    assert assistant_limits.get_tool_result_max_chars(db_session) == (
        assistant_limits.DEFAULT_TOOL_RESULT_MAX_CHARS
    )
    assistant_limits.save_tool_result_max_chars(db_session, 0)
    assert assistant_limits.get_tool_result_max_chars(db_session) == 0


def test_tool_result_limit_rejects_out_of_range(db_session):
    with pytest.raises(ValueError):
        assistant_limits.save_tool_result_max_chars(db_session, 200_001)
    with pytest.raises(ValueError):
        assistant_limits.save_tool_result_max_chars(db_session, -1)


def test_truncate_tool_result_keeps_short_text_verbatim():
    text = "短结果"
    assert assistant_limits.truncate_tool_result(text, 8000) == text
    # 0 = 不限，长文本也原样返回。
    long_text = "x" * 20_000
    assert assistant_limits.truncate_tool_result(long_text, 0) == long_text


def test_truncate_tool_result_writes_recoverable_note():
    """截断必须写明原长与重读方式——否则模型不知道要不要重读。"""
    out = assistant_limits.truncate_tool_result("x" * 20_000, 8000)
    assert len(out) < 20_000
    assert out.startswith("x" * 8000)
    assert "原 20,000 字符" in out
    assert "上限 8,000" in out
    assert "重读" in out


def test_tool_result_truncation_is_applied_at_the_call_site(client, monkeypatch):
    """端到端：工具结果进 messages 之前**真的**过了一遍截断，且上限来自设置。

    做法：把截断函数换成会记录入参的哨兵，然后看下一轮发给模型的 tool 消息内容——
    比造一个返回 2 万字的假工具更稳（`run_tool_call` 的返回还要满足 run_trace 的字段）。
    """
    _configure_llm(client)
    assistant_limits.save_tool_result_max_chars(
        __import__("app.database", fromlist=["SessionLocal"]).SessionLocal(), 1234
    )
    seen: list[tuple[int, int]] = []
    real = assistant_limits.truncate_tool_result

    def _spy(text: str, limit: int) -> str:
        seen.append((len(text), limit))
        return real(text, limit)

    monkeypatch.setattr("app.services.assistant.assistant_stream_turns.truncate_tool_result", _spy)
    provider = _ScriptedProvider([[_tool_call("get_overview", {})], []])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "看一眼概览"},
    )

    # 至少被调用一次，且每次带的都是设置里那个上限。
    assert seen, "工具结果没有经过截断函数"
    assert all(limit == 1234 for _, limit in seen)
    assert any(length > 0 for length, _ in seen)


# ===== 详册 #5 的 5.3：上下文窗口字段（#6 的百分比分母）=====


def test_llm_config_accepts_context_window_and_defaults_to_zero():
    """默认 0 = 未知；上限 2,000,000（够 2M 窗口的模型），越界由 pydantic 拒。"""
    from app.schemas.setting import LLMConfig
    from pydantic import ValidationError

    assert LLMConfig().context_window_tokens == 0
    assert LLMConfig(context_window_tokens=64_000).context_window_tokens == 64_000
    with pytest.raises(ValidationError):
        LLMConfig(context_window_tokens=-1)
    with pytest.raises(ValidationError):
        LLMConfig(context_window_tokens=2_000_001)

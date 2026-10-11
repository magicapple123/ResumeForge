"""助手流整链预算（RF-14 §2.1.b）：毫秒级注入，全离线假 Provider。

两档等待预算纪律（AGENTS）：期望**超时**的用例预算/节奏是毫秒级（预算真到期）；
期望**成功**的用例 READY_WAIT 2s（就绪即刻返回，预算只是安全网）。

钉住的性质：
- 流进行中预算到期 → 不再处理后续 delta，在下一边界收尾：status=error、
  SSE 有可读的 error 事件（不冒充网络错误）、结束原因记 budget_exhausted；
- 预算到期不进入 asyncio.CancelledError（用户断开）分支，语义不混淆；
- 每轮工具循环开始 / 每个工具调用发起前的检查点真的挡得住；
- 预算只决定"还发不发起下一次调用"，运行中的工具不强制中断（协作式）。
"""
import asyncio
import json
from types import SimpleNamespace

from app.schemas.setting import LLMConfig

# 期望成功的用例统一用这一档：预算远大于用例耗时，只是安全网。
READY_WAIT_BUDGET_SECONDS = 600


def _configure_llm(client) -> None:
    config = LLMConfig(base_url="https://api.example.com/v1", api_key="k", model="m1")
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200


def _events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def _stub_settings(monkeypatch, *, budget_seconds: float, estimate: bool = False) -> None:
    """毫秒级预算注入：替换 assistant_budget 命名空间里的 get_settings。

    设置读取随横切关注点下沉到了 ``app/api/assistant_budget.py``
    （AssistantStreamBudget 构造器与 estimate_prompt_tokens 都读那个命名空间），
    锚点必须跟着走——patch assistant_stream 命名空间早已不存在该符号。
    """
    from app.api import assistant_budget

    stub = SimpleNamespace(
        assistant_stream_budget_seconds=budget_seconds,
        llm_token_estimate_enabled=estimate,
    )
    monkeypatch.setattr(assistant_budget, "get_settings", lambda: stub)


def _conversation(client) -> dict:
    response = client.post("/api/assistant/conversations", json={"title": ""})
    assert response.status_code == 201
    return response.json()


class _AssistantFake:
    """预算测试共用的假 Provider 底座：补齐基类要求的 stream_chat。"""

    async def stream_chat(self, messages):
        async for delta in self.stream_chat_events(messages):
            if delta.text:
                yield delta.text


def test_budget_exhausted_mid_stream_ends_with_error_and_budget_reason(client, monkeypatch):
    """慢流超预算：下一事件边界收尾、status=error、结束原因 budget_exhausted。"""
    from tests.test_assistant import _FakeProvider

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=0.05)

    class _SlowFake(_AssistantFake, _FakeProvider):
        def __init__(self):
            self.rounds = 0

        async def stream_chat_events(self, messages, tools=None):
            self.rounds += 1
            from app.services.llm.base import LLMDelta

            index = 0
            while True:
                await asyncio.sleep(0.02)
                yield LLMDelta(text=f"第{index}段")
                index += 1

    provider = _SlowFake()
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "讲个长故事"},
    )
    events = _events(response)

    # SSE 有可读的收尾：error 事件且文案是预算语义，不是网络超时。
    error_events = [event for event in events if event["type"] == "error"]
    assert len(error_events) == 1
    assert "预算" in error_events[0]["message"]
    assert not any(event["type"] == "done" for event in events)

    # 落库 status=error，context.usage 的结束原因如实记 budget_exhausted。
    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assistant = detail["messages"][1]
    assert assistant["status"] == "error"
    assert assistant["error"] == "回复超出时间预算，已中止"
    usage = assistant["context"]["usage"]
    assert usage["finish_reason"] == "budget_exhausted"
    # 缺真实用量：token 字段是 null（不是 0）。
    assert usage["prompt_tokens"] is None


def test_budget_exhausted_between_tool_rounds_blocks_next_model_call(client, monkeypatch):
    """检查点 1：每轮工具循环开始——预算到期就不放过下一次模型调用。"""
    from tests.test_assistant import _FakeProvider, _tool_call

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=0.05)

    class _RoundAwareProvider(_AssistantFake, _FakeProvider):
        def __init__(self):
            self.requests = []

        async def stream_chat_events(self, messages, tools=None):
            self.requests.append({"messages": list(messages), "tools": tools})
            from app.services.llm.base import LLMDelta

            yield LLMDelta(text="先查一下。")
            yield _tool_call("get_overview", {})

    provider = _RoundAwareProvider()

    async def slow_tool(db, name, arguments, *, numberer=None, ctx=None):
        await asyncio.sleep(0.12)  # 工具执行期间预算耗尽（协作式：不打断它）
        return SimpleNamespace(summary="概览", link="", text="ok", changed=False, sources=[])

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    monkeypatch.setattr("app.api.assistant_tool_exec.execute_tool_async", slow_tool)
    conversation = _conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "查总览"},
    )
    events = _events(response)

    # 第一轮工具执行完，第二轮模型调用从未发起（检查点 1 挡住）。
    assert len(provider.requests) == 1
    assert any(event["type"] == "tool" for event in events)
    assert any(
        event["type"] == "error" and "预算" in event["message"] for event in events
    )


def test_budget_exhausted_before_second_tool_call(client, monkeypatch):
    """检查点 2：每个工具调用发起前——预算到期就不发起下一次工具调用。"""
    from tests.test_assistant import _FakeProvider, _tool_call

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=0.05)

    class _TwoCallsProvider(_AssistantFake, _FakeProvider):
        def __init__(self):
            self.requests = []

        async def stream_chat_events(self, messages, tools=None):
            self.requests.append({"messages": list(messages), "tools": tools})
            from app.services.llm.base import LLMDelta

            yield _tool_call("get_overview", {}, call_id="call_1")
            yield _tool_call("get_overview", {}, call_id="call_2")
            yield LLMDelta(text="查完了。")

    provider = _TwoCallsProvider()

    async def slow_tool(db, name, arguments, *, numberer=None, ctx=None):
        await asyncio.sleep(0.12)
        return SimpleNamespace(summary="概览", link="", text="ok", changed=False, sources=[])

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    monkeypatch.setattr("app.api.assistant_tool_exec.execute_tool_async", slow_tool)
    conversation = _conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "查两次总览"},
    )
    events = _events(response)

    tool_events = [event for event in events if event["type"] == "tool"]
    # 第一个工具执行完（协作式不中断），第二个调用发起前被检查点 2 挡住。
    assert len(tool_events) == 1
    assert any(
        event["type"] == "error" and "预算" in event["message"] for event in events
    )


def test_successful_reply_within_generous_budget(client, monkeypatch):
    """成功路径（READY_WAIT 2s 档）：大预算下完整走完，usage 进 done 事件与 context。"""
    from app.services.llm.base import LLMDelta
    from app.services.llm.usage import build_usage
    from tests.test_assistant import _FakeProvider

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=READY_WAIT_BUDGET_SECONDS)

    class _UsageProvider(_AssistantFake, _FakeProvider):
        def __init__(self):
            self.requests = []

        async def stream_chat_events(self, messages, tools=None):
            self.requests.append({"messages": list(messages), "tools": tools})
            yield LLMDelta(text="你好")
            self.last_usage = build_usage(
                "m1",
                elapsed_ms=12,
                finish_reason="stop",
                prompt_tokens=7,
                completion_tokens=3,
            )

    provider = _UsageProvider()
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "打个招呼"},
    )
    events = _events(response)

    done = next(event for event in events if event["type"] == "done")
    assert done["usage"] is not None
    assert done["usage"]["prompt_tokens"] == 7
    assert done["usage"]["completion_tokens"] == 3
    assert done["usage"]["total_tokens"] == 10
    assert done["usage"]["finish_reason"] == "stop"

    detail = client.get(f"/api/assistant/conversations/{conversation['id']}").json()
    assistant = detail["messages"][1]
    assert assistant["status"] == "complete"
    assert assistant["context"]["usage"]["prompt_tokens"] == 7

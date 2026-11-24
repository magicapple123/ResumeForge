# SPDX-License-Identifier: Apache-2.0
"""助手流整链预算（RF-14 §2.1.b）：确定性到期注入，全离线假 Provider。

等待预算纪律（AGENTS）：期望**超时**的用例不与墙钟赛跑——``OperationBudget.start`` 被换成
"远期 deadline + 把预算交给用例"，到期时机由用例在需要的那一刻**显式注入**（见
:func:`_deterministic_budget` / :func:`_expire_now`），与机器快慢、调度抖动无关；
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
import threading
import time
from types import SimpleNamespace

from app.schemas.setting import LLMConfig

# 期望成功的用例统一用这一档：预算远大于用例耗时，只是安全网。
READY_WAIT_BUDGET_SECONDS = 600

# 期望**到期**的用例也用远期 deadline：到期由用例在指定位置把 deadline 改到过去来制造
# （见 _expire_now），这个数字只表示"到期不靠它发生"，不参与任何断言。
FAR_DEADLINE_SECONDS = 600


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
    """预算/遥测的配置注入：替换 assistant_stream_budget 命名空间里的 get_settings。

    ``AssistantStreamBudget`` 的构造器与 ``estimate_prompt_tokens`` 都读**该模块**的
    ``get_settings``；实现下沉到 ``app/services/assistant/assistant_stream_budget.py``
    后锚点必须跟着走——patch 旧的 ``app.api.assistant_budget`` 命名空间会让注入静默失效。
    """
    from app.services.assistant import assistant_stream_budget

    stub = SimpleNamespace(
        assistant_stream_budget_seconds=budget_seconds,
        llm_token_estimate_enabled=estimate,
    )
    monkeypatch.setattr(assistant_stream_budget, "get_settings", lambda: stub)


def _deterministic_budget(monkeypatch) -> list:
    """把 ``OperationBudget.start`` 换成"远期 deadline + 把预算交给用例"的确定性时钟。

    返回 holder（单元素列表）：流建起来后 ``holder[0]`` 就是这次回答的活预算，用例在
    需要"预算此刻已到期"的位置调 :func:`_expire_now` 改写它的 ``deadline``——到期时机
    由用例**决定**，不再由"建会话 + provider 首包吃掉了多少秒"决定。慢 runner 上不会
    再出现"检查点先于第一次工具执行就判定过期"。

    只在 :class:`OperationBudget` 这一层做手脚：**不** monkeypatch 全局
    ``time.monotonic``——asyncio 事件循环也用它，跳时钟会让定时器异常触发。
    """
    from app.runtime.operation_budget import OperationBudget

    holder: list = []

    def _start(cls, seconds, *, cancel_event=None):
        # 语义与真实 start 一致（秒数必须为正、deadline 是 time.monotonic() 的绝对值），
        # 只把秒数换成远期值，并把造出来的预算暴露给用例。
        if seconds <= 0:
            raise ValueError(f"预算秒数必须为正数，收到 {seconds!r}")
        budget = OperationBudget(
            deadline=time.monotonic() + FAR_DEADLINE_SECONDS,
            cancel_event=cancel_event if cancel_event is not None else threading.Event(),
        )
        holder.append(budget)
        return budget

    monkeypatch.setattr(OperationBudget, "start", classmethod(_start))
    return holder


def _expire_now(holder: list) -> None:
    """让本次回答的预算**从这一刻起必然已到期**（确定性的"预算耗尽"）。"""
    assert holder, "还没有预算实例：OperationBudget.start 未被调用（注入锚点失效）"
    holder[0].deadline = time.monotonic() - 1


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
    """慢流超预算：下一事件边界收尾、status=error、结束原因 budget_exhausted。

    到期时机由用例注入：假 Provider 流到第 3 段之前把 deadline 改到过去，"流进行中到期"
    因此必然发生——断言的仍是"到期后不再处理后续 delta、下一边界收尾"。
    """
    from tests.test_assistant import _FakeProvider

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=FAR_DEADLINE_SECONDS)
    holder = _deterministic_budget(monkeypatch)

    class _SlowFake(_AssistantFake, _FakeProvider):
        def __init__(self):
            self.rounds = 0

        async def stream_chat_events(self, messages, tools=None):
            self.rounds += 1
            from app.services.llm.base import LLMDelta

            index = 0
            while True:
                if index == 2:
                    # 第 3 段之前预算到期：这一段就是"流进行中到期"的收尾边界。
                    _expire_now(holder)
                yield LLMDelta(text=f"第{index}段")
                index += 1
                # 只让出事件循环，不靠墙钟推进；实现没挡住时以断言失败收场而不是挂死。
                await asyncio.sleep(0)
                if index > 50:
                    return

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
    """检查点 1：每轮工具循环开始——预算到期就不放过下一次模型调用。

    第一轮模型调用必然已经发生过（deadline 是远期值，建会话/provider 首包再慢也吃不掉
    它），到期点注入在**工具桩内部**：第一次工具执行期间预算到期，于是下一轮模型调用
    发起前的检查点 1 必然挡住它——不再靠"工具睡 0.65s vs 预算 0.5s"的赛跑。
    """
    from tests.test_assistant import _FakeProvider, _tool_call

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=FAR_DEADLINE_SECONDS)
    holder = _deterministic_budget(monkeypatch)

    class _RoundAwareProvider(_AssistantFake, _FakeProvider):
        def __init__(self):
            self.requests = []

        async def stream_chat_events(self, messages, tools=None):
            self.requests.append({"messages": list(messages), "tools": tools})
            from app.services.llm.base import LLMDelta

            yield LLMDelta(text="先查一下。")
            yield _tool_call("get_overview", {})

    provider = _RoundAwareProvider()

    async def expiring_tool(db, name, arguments, *, numberer=None, ctx=None):
        # 工具执行期间预算耗尽（协作式：不打断运行中的工具）；到期时刻由用例指定。
        _expire_now(holder)
        return SimpleNamespace(
            summary="概览", link="", text="ok", changed=False, sources=[], preview=None
        )

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    monkeypatch.setattr(
        "app.services.assistant.assistant_tool_exec.execute_tool_async", expiring_tool
    )
    conversation = _conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "查总览"},
    )
    events = _events(response)

    # 第一轮工具执行完，第二轮模型调用从未发起（检查点 1 挡住）。
    assert len(provider.requests) == 1
    assert any(event["type"] == "tool" for event in events)
    assert any(event["type"] == "error" and "预算" in event["message"] for event in events)


def test_budget_exhausted_before_second_tool_call(client, monkeypatch):
    """检查点 2：每个工具调用发起前——预算到期就不发起下一次工具调用。

    与上一条同一套确定性手段：第一次工具调用**必然**真的发生（deadline 远期），到期点
    注入在该工具桩内部，于是第二次调用发起前的检查点 2 必然挡住它。"第一次真的发生了"
    不再取决于慢机器上建会话吃掉了多少毫秒。
    """
    from tests.test_assistant import _FakeProvider, _tool_call

    _configure_llm(client)
    _stub_settings(monkeypatch, budget_seconds=FAR_DEADLINE_SECONDS)
    holder = _deterministic_budget(monkeypatch)

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

    async def expiring_tool(db, name, arguments, *, numberer=None, ctx=None):
        # 第一次工具调用期间预算到期（协作式不打断它），第二次调用发起前被检查点 2 挡下。
        _expire_now(holder)
        return SimpleNamespace(
            summary="概览", link="", text="ok", changed=False, sources=[], preview=None
        )

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    monkeypatch.setattr(
        "app.services.assistant.assistant_tool_exec.execute_tool_async", expiring_tool
    )
    conversation = _conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "查两次总览"},
    )
    events = _events(response)

    tool_events = [event for event in events if event["type"] == "tool"]
    # 第一个工具执行完（协作式不中断），第二个调用发起前被检查点 2 挡住。
    assert len(tool_events) == 1
    assert any(event["type"] == "error" and "预算" in event["message"] for event in events)


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

# SPDX-License-Identifier: Apache-2.0
"""助手流五条收尾路径的 SSE 事件序列基线（T1 拆分前的行为快照）。

_stream_message_events 是近 400 行的 async generator，T1 要把它拆成 StreamRun
数据类 + 轮循环/收尾函数。拆分要求"纯搬家"，但流式路径的事件顺序、落库终态与 usage
口径不是类型系统能守住的：四个 except 分支各自重复同一段
"close_run_trace -> budget.record_round -> finish_assistant_message -> yield"，
搬错一处就会有一条路径少发事件、少记 usage 或写错 status。

所以先把这个文件写出来：把五条路径**当前**的 yield 序列固化成断言——正常 / 预算耗尽 /
用户取消 / LLMError / 内部异常——对未改动的实现跑绿作为基线，拆分后逐条保持。

边界：
* 只钉事件 type 的完整有序列表与稳定字段；delta 分片数量由假 Provider 的脚本决定。
* 预算路径给足建流开销的余量（1s 预算 / 1.3s 慢帧），保证"恰好一个 delta 后到期"
  的序列是确定的，而不是靠调度抖动。
* 取消路径真的调用 task.cancel()，因此走 asyncio.CancelledError 分支；浏览器断开时
  的 GeneratorExit 路径由 test_assistant.py 的既有用例守着。
"""

import asyncio
import json

import pytest
from tests.test_assistant import (
    _configure_llm,
    _create_conversation,
    _events,
    _FakeProvider,
)

BUDGET_EXHAUSTED_MESSAGE = "回复超出时间预算，已中止"
LLM_ERROR_MESSAGE = "模型服务暂时无法处理本次请求，请稍后重试"
INTERNAL_ERROR_MESSAGE = "回复过程中发生内部错误，请查看后端日志"


class _EventsProvider(_FakeProvider):
    """补齐基类抽象方法的最小假 Provider：用例只关心流式事件入口。"""

    async def stream_chat(self, messages):
        async for delta in self.stream_chat_events(messages):
            if delta.text:
                yield delta.text


def _types(events: list[dict]) -> list[str]:
    return [event["type"] for event in events]


def _stub_budget_seconds(monkeypatch, seconds: float) -> None:
    """把整链预算压到指定秒数：AssistantStreamBudget 读该模块的 get_settings。"""
    from types import SimpleNamespace

    from app.services.assistant import assistant_stream_budget

    stub = SimpleNamespace(
        assistant_stream_budget_seconds=seconds,
        llm_token_estimate_enabled=False,
    )
    monkeypatch.setattr(assistant_stream_budget, "get_settings", lambda: stub)


def _latest_assistant(client, conversation_id: int) -> dict:
    messages = client.get(f"/api/assistant/conversations/{conversation_id}").json()["messages"]
    return messages[1]


def _send(client, conversation_id: int, content: str):
    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": content},
    )
    assert response.status_code == 200
    return response


def test_normal_reply_yields_start_context_deltas_done(client, monkeypatch):
    """正常结束：start -> context_usage -> 每个正文分片一个 delta -> done。"""
    from app.services.llm.base import LLMDelta

    _configure_llm(client)

    class _TextProvider(_EventsProvider):
        async def stream_chat_events(self, messages, tools=None):
            yield LLMDelta(text="建议")
            yield LLMDelta(text="内容")

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: _TextProvider())
    conversation = _create_conversation(client)

    events = _events(_send(client, conversation["id"], "帮我分析"))

    assert _types(events) == ["start", "context_usage", "delta", "delta", "done"]
    start, context_usage, *rest = events
    assert isinstance(start["user_message_id"], int)
    assert isinstance(start["assistant_message_id"], int)
    assert start["conversation_title"]
    assert isinstance(context_usage["usage"], dict)
    assert [event["text"] for event in rest if event["type"] == "delta"] == ["建议", "内容"]
    done = rest[-1]
    assert done["message"]["status"] == "complete"
    assert done["message"]["content"] == "建议内容"
    # 假 Provider 从不写 last_usage：用量缺失是 None（"未知"），不是伪造的 0。
    assert done["usage"] is None

    assistant = _latest_assistant(client, conversation["id"])
    assert assistant["status"] == "complete"
    assert assistant["content"] == "建议内容"


def test_budget_exhausted_yields_error_after_last_accepted_delta(client, monkeypatch):
    """预算耗尽：下一个 delta 边界到期 -> error（不是 done），并记 budget_exhausted。"""
    from app.services.llm.base import LLMDelta
    from app.services.llm.usage import build_usage

    _configure_llm(client)
    # 1s 预算远大于建流开销，慢帧 1.3s：到期点必然落在"第一帧已收下、第二帧还没处理"
    # 这个边界上，序列因此是确定的。
    _stub_budget_seconds(monkeypatch, 1.0)

    class _SlowFrameProvider(_EventsProvider):
        def __init__(self):
            # 模拟真实 provider 在流 finally 里写好最后一轮用量（失败路径的 record_round
            # 读的就是它）。有值才能证明失败收尾真的记了 usage，而不是只构造了空口径。
            self.last_usage = build_usage(
                "m1", elapsed_ms=5, finish_reason="stop", prompt_tokens=7, completion_tokens=3
            )

        async def stream_chat_events(self, messages, tools=None):
            yield LLMDelta(text="第一段")
            await asyncio.sleep(1.3)  # 预算在等待下一帧时到期
            yield LLMDelta(text="不会显示")  # pragma: no cover - 到期后不再处理

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: _SlowFrameProvider())
    conversation = _create_conversation(client)

    events = _events(_send(client, conversation["id"], "讲个长故事"))

    assert _types(events) == ["start", "context_usage", "delta", "error"]
    assert events[-1]["message"] == BUDGET_EXHAUSTED_MESSAGE
    assert not any(event["type"] == "done" for event in events)
    assistant = _latest_assistant(client, conversation["id"])
    assert assistant["status"] == "error"
    assert assistant["error"] == BUDGET_EXHAUSTED_MESSAGE
    usage = assistant["context"]["usage"]
    assert usage["finish_reason"] == "budget_exhausted"
    # 失败路径也要收集最后一轮 usage（PR-07-6）：删掉失败收尾里的 record_round，
    # 这里会退回 null——这是 T1 反证的精确断言点。
    assert usage["prompt_tokens"] == 7
    assert usage["completion_tokens"] == 3
    assert usage["total_tokens"] == 10


@pytest.mark.asyncio
async def test_user_cancel_yields_no_done_and_marks_message_cancelled(client, monkeypatch):
    """用户取消：CancelledError 分支不发 error 事件，消息落成 cancelled。"""
    from app.api.assistant import send_message
    from app.database import SessionLocal
    from app.runtime import dataset_scope
    from app.schemas.assistant import AssistantMessageCreate
    from app.services.llm.base import LLMDelta

    _configure_llm(client)
    gate = asyncio.Event()

    class _BlockingProvider(_EventsProvider):
        async def stream_chat_events(self, messages, tools=None):
            yield LLMDelta(text="开始")
            await gate.wait()  # 一直挂着，直到测试取消这个流
            yield LLMDelta(text="不该出现")  # pragma: no cover - 取消后不会走到

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: _BlockingProvider())
    conversation = _create_conversation(client)

    db = SessionLocal()
    response = await send_message(
        conversation["id"],
        AssistantMessageCreate(content="慢慢想"),
        db,
    )

    seen: list[dict] = []

    async def _consume() -> None:
        async for chunk in response.body_iterator:
            seen.append(json.loads(chunk.removeprefix("data: ")))

    task = asyncio.create_task(_consume())
    for _ in range(500):
        if len(seen) >= 3:
            break
        await asyncio.sleep(0.01)
    else:  # pragma: no cover - 流没有走到正文分片，说明前置路径已坏
        task.cancel()
        raise AssertionError(f"取消前没有收到预期事件：{seen}")
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # 取消路径不发 error 事件：已经下发的就这三条，之后不再有任何事件。
    assert _types(seen) == ["start", "context_usage", "delta"]
    assistant = _latest_assistant(client, conversation["id"])
    assert assistant["status"] == "cancelled"
    assert assistant["error"] == "回复已中断"
    # 流级租约不能在取消路径上泄漏（内层 finally 必须跑到）。
    assert dataset_scope.leases_pending() == 0


def test_llm_error_yields_desensitized_error_event(client, monkeypatch):
    """LLMError：固定脱敏文案进 SSE 与落库，异常原文不外泄。"""
    from app.services.llm.base import LLMError

    _configure_llm(client)
    private = "SYNTHETIC_PRIVATE_ERROR sk-synthetic_private_secret C:/private.db"

    class _FailingProvider(_EventsProvider):
        async def stream_chat_events(self, messages, tools=None):
            raise LLMError(private)
            yield ""  # pragma: no cover - 让函数保持 async generator 形态

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: _FailingProvider())
    conversation = _create_conversation(client)

    response = _send(client, conversation["id"], "帮我分析")
    events = _events(response)

    assert _types(events) == ["start", "context_usage", "error"]
    assert events[-1] == {"type": "error", "message": LLM_ERROR_MESSAGE}
    assert private not in response.text
    assistant = _latest_assistant(client, conversation["id"])
    assert assistant["status"] == "error"
    assert assistant["error"] == LLM_ERROR_MESSAGE


def test_internal_exception_yields_generic_error_event(client, monkeypatch):
    """内部异常：except Exception 分支同样收敛成固定文案的 error 事件。"""
    _configure_llm(client)
    private = "SYNTHETIC_INTERNAL_DETAIL C:/private.db"

    class _BoomProvider(_EventsProvider):
        async def stream_chat_events(self, messages, tools=None):
            raise RuntimeError(private)
            yield ""  # pragma: no cover - 让函数保持 async generator 形态

    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: _BoomProvider())
    conversation = _create_conversation(client)

    response = _send(client, conversation["id"], "帮我分析")
    events = _events(response)

    assert _types(events) == ["start", "context_usage", "error"]
    assert events[-1] == {"type": "error", "message": INTERNAL_ERROR_MESSAGE}
    assert private not in response.text
    assistant = _latest_assistant(client, conversation["id"])
    assert assistant["status"] == "error"
    assert assistant["error"] == INTERNAL_ERROR_MESSAGE

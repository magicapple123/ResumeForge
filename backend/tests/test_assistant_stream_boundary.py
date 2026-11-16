# SPDX-License-Identifier: Apache-2.0
"""助手 SSE 与入流准备的执行边界（RF-02）。

钉三件事：

1. ``send_message`` 的入流准备（读会话/附件/配置 + 提交消息行）在 worker 线程里跑，
   期间事件循环仍能推进——用 Event 屏障证明，不用 sleep 凑超时。
2. 审计 ContextVar 仍在**事件循环**上写：worker 线程拿的是 context 副本，值写不回来。
3. SSE 收尾的落库（来源映射 / 轨迹 / 消息终态）在 worker 里执行；用户取消时终态
   落库仍必须完成（``anyio.CancelScope(shield=True)``），否则会留下永远 pending 的消息。
"""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace
from typing import Any

import pytest
from app.api import assistant as assistant_api
from app.runtime import usage_context
from app.schemas.assistant import AssistantMessageCreate
from app.services.assistant import assistant_stream_run as stream_run

_LOOP_THREAD = threading.get_ident()


def _loop_tid() -> int:
    return threading.get_ident()


class _DummyDb:
    """只记录 commit/close：本文件不碰真实数据库。"""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def commit(self) -> None:
        self.calls.append("commit")

    def close(self) -> None:
        self.calls.append("close")


class _Numberer:
    def mapping(self) -> dict[str, str]:
        return {"1": "https://example.test/a"}


class _Budget:
    def record_round(self, provider: Any = None) -> None:
        return None

    def usage_summary(self, provider: Any = None, finish_reason: str | None = None) -> dict:
        return {"total_tokens": 1}


def _run_stub() -> SimpleNamespace:
    return SimpleNamespace(
        assistant_context={},
        numberer=_Numberer(),
        parts=["你好"],
        budget=_Budget(),
        provider=object(),
        trace=object(),
        assistant_message_id=11,
        factory=None,
        tool_records=[],
    )


def test_send_message_prepare_runs_off_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    """入流准备的同步阶段不占事件循环：屏障能被打通，且事务收尾仍在 worker 里完成。"""
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    scopes: list[dict[str, Any]] = []

    dispatch = SimpleNamespace(
        audit_scope={
            "input_scope": "assistant_context",
            "masked": False,
            "language": "zh-CN",
            "budget": 1024,
        },
        event_stream=lambda: iter(()),
    )

    def fake_prepare(db, conversation_id, payload, surface, **kwargs):  # noqa: ANN001, ANN202
        threads["prepare"] = _loop_tid()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("入流准备等待释放信号超时：事件循环被同步阶段占住")
        return dispatch

    monkeypatch.setattr(assistant_api, "prepare_message_dispatch", fake_prepare)
    monkeypatch.setattr(assistant_api, "save_attachment_copies", lambda db, d: None)
    monkeypatch.setattr(assistant_api, "set_ambient_scope", lambda **kwargs: scopes.append(kwargs))

    db = _DummyDb()
    payload = AssistantMessageCreate(content="hi")

    async def scenario() -> Any:
        task = asyncio.create_task(
            assistant_api.send_message(1, payload, db, "page")  # type: ignore[arg-type]
        )
        assert await asyncio.to_thread(entered.wait, 3.0), "准备阶段没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    response = asyncio.run(scenario())

    assert response.media_type == "text/event-stream"
    assert threads["prepare"] != _LOOP_THREAD, "入流准备仍在事件循环线程上执行"
    assert db.calls == ["commit", "close"], "事务收尾应仍在同一个 worker 里按原顺序完成"
    assert scopes and scopes[0]["masked"] is False, "审计上下文必须在事件循环上写"


def test_stream_finish_persists_in_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    """SSE 成功收尾的三处落库都在 worker 线程，事件循环只负责拼接事件。"""
    seen: list[tuple[str, int]] = []

    def record(name: str):  # noqa: ANN202
        def _inner(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
            seen.append((name, _loop_tid()))
            if name == "finish":
                return SimpleNamespace(model_dump=lambda mode="json": {"id": 11})
            return None

        return _inner

    monkeypatch.setattr(stream_run, "update_message_context", record("context"))
    monkeypatch.setattr(stream_run, "close_run_trace", record("trace"))
    monkeypatch.setattr(stream_run, "finish_assistant_message", record("finish"))

    async def scenario() -> list[str]:
        return [event async for event in stream_run._finish_success(_run_stub())]

    events = asyncio.run(scenario())

    assert {name for name, _tid in seen} == {"context", "trace", "finish"}
    assert all(tid != _LOOP_THREAD for _name, tid in seen), f"落库回到了事件循环：{seen}"
    assert any('"type": "done"' in event for event in events)


def test_cancelled_stream_still_persists_terminal_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """取消期间终态落库不能被取消打断（shield），落库完成后取消照常抛出。"""
    entered = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def slow_finish(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        entered.set()
        release.wait(3.0)
        finished.set()
        return None

    monkeypatch.setattr(stream_run, "update_message_context", lambda *a, **k: None)
    monkeypatch.setattr(stream_run, "close_run_trace", lambda *a, **k: None)
    monkeypatch.setattr(stream_run, "finish_assistant_message", slow_finish)

    run = _run_stub()

    async def scenario() -> None:
        generator = stream_run._finalize_run(run, "cancelled")
        task = asyncio.create_task(anext(generator))
        assert await asyncio.to_thread(entered.wait, 3.0), "终态落库没有开始"
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await asyncio.to_thread(finished.wait, 3.0), "取消打断了终态落库"
        await generator.aclose()

    asyncio.run(scenario())


def test_ambient_scope_is_not_written_from_worker() -> None:
    """记录口径：ContextVar 在 worker 线程里写不会回到事件循环（本文件的前提）。"""
    usage_context.set_ambient_task("baseline")
    try:
        asyncio.run(asyncio.to_thread(usage_context.set_ambient_task, "worker"))
        assert usage_context.ambient_task() == "baseline"
    finally:
        usage_context.set_ambient_task(None)

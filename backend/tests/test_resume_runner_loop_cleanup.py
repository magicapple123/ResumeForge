# SPDX-License-Identifier: Apache-2.0
"""回归：生成后台任务的事件循环收尾不得销毁 pending 的 async generator finalizer task。

用户可见症状（真实库 backend/data/logs/backend.log，2026-10-25 13:38、2026-10-26 02:12/06:10）：
每次简历生成任务 completed 的瞬间都会打一条

    ERROR [asyncio] Task was destroyed but it is pending!
    task: <Task pending name='Task-14' coro=<<async_generator_athrow without __name__>()>>

根因：runner 的工作线程用 RunnerEventLoopHandle.drive 显式驱动事件循环（替代
asyncio.run），但收尾只做 loop.close()——没有 asyncio.run 的两步收尾纪律：
取消残留任务 + shutdown_asyncgens()。provider 流（stream_chat → stream_chat_events →
_stream_deltas → response.aiter_lines()）在收到 data: [DONE] 时是 break 出内层异步
生成器，最内层生成器随即被 GC；它的 finalizer 钩子会向仍在运行的循环投递一个
create_task(agen.aclose())。主 task 恰好在这一轮循环停掉，这个 athrow task 没机会
执行就被 loop.close() 销毁——Task.__del__ 于是打 ERROR。这也是为什么只在"生成结束
瞬间"出现。
"""

from __future__ import annotations

import gc
import json
import logging
import threading

import httpx
import pytest
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from app.services.resume.resume_runner_loop import RunnerEventLoopHandle
from tests.resume_generate_task_support import (
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)

_ASYNCIO_ERROR_MARKERS = (
    "Task was destroyed but it is pending",
    "Task exception was never retrieved",
)


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _asyncio_errors(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == "asyncio"
        and record.levelno >= logging.ERROR
        and any(marker in record.getMessage() for marker in _ASYNCIO_ERROR_MARKERS)
    ]


def test_drive_finalizes_abandoned_async_generators(caplog) -> None:
    """机制复现：循环收尾前未 aclose 的内层异步生成器 → pending athrow task。

    最小化地模拟 provider 的嵌套结构：外层生成器拿到一块数据就提前 return，内层
    生成器仍挂在 yield 上（真实 provider 在 data: [DONE] 处 break 出
    response.aiter_lines() 正是同一形态）。修复前 loop.close() 时那个由 GC
    finalizer 投递的 aclose() task 会被销毁并打 ERROR。
    """
    caplog.set_level(logging.ERROR, logger="asyncio")
    handle = RunnerEventLoopHandle(threading.Event())

    async def leaky_inner():
        yield "chunk-1"
        yield "chunk-2"  # pragma: no cover - 提前 return 后永远走不到

    async def early_return_outer():
        inner = leaky_inner()
        async for item in inner:
            yield item
            return  # 提前结束：内层生成器仍挂起，交给 GC finalizer

    async def main() -> None:
        stream = early_return_outer()
        consumed = [item async for item in stream]
        assert consumed == ["chunk-1"]
        await stream.aclose()

    handle.drive(main())
    gc.collect()

    assert _asyncio_errors(caplog) == []


def _sse_transport(payload: str) -> httpx.MockTransport:
    """mock SSE：一帧正文 + finish_reason + [DONE]（生产 provider 的正常收尾）。"""
    content_frame = json.dumps({"choices": [{"delta": {"content": payload}}]}, ensure_ascii=False)
    final_frame = json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]})
    body = ("data: " + content_frame + "\n\ndata: " + final_frame + "\n\ndata: [DONE]\n\n").encode(
        "utf-8"
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    return httpx.MockTransport(handler)


def test_sse_generation_completion_logs_no_pending_task_error(client, monkeypatch, caplog):
    """SSE 生成路径的守卫：同一条 provider 流跑在 uvicorn 的长期事件循环上，完成后
    也不得出现 asyncio pending task 销毁错误（防御性守卫；用户报告的可见 ERROR 发生在
    runner 每任务循环关闭时，根因是同一套 provider 内层生成器收尾方式）。"""
    caplog.set_level(logging.ERROR, logger="asyncio")
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    resume_payload = json.dumps(
        {"summary": "具备 Python 后端开发经验。", "projects": [{"name": "简历通"}]},
        ensure_ascii=False,
    )
    transport = _sse_transport(resume_payload)
    monkeypatch.setattr(
        "app.api.resumes.create_provider",
        lambda resolved: OpenAICompatProvider(resolved, transport=transport),
    )

    response = client.post("/api/resumes/generate", json={"job_id": job["id"]})

    assert response.status_code == 200, response.text
    event_types = [
        json.loads(line.removeprefix("data: "))["type"]
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert "saved" in event_types and "done" in event_types
    gc.collect()

    assert _asyncio_errors(caplog) == []


def test_generation_completion_logs_no_pending_task_error(client, monkeypatch, caplog):
    """端到端复现：真实 openai_compat provider（MockTransport 的 SSE）跑完后台生成任务，
    完成后（并强制 GC）不得出现 asyncio 的 pending task 销毁错误。"""
    caplog.set_level(logging.ERROR, logger="asyncio")
    _seed_profile(client)
    _configure(client)
    job = _job(client)
    resume_payload = json.dumps(
        {
            "summary": "具备 Python 后端开发经验。",
            "projects": [{"name": "简历通", "role": "核心开发"}],
        },
        ensure_ascii=False,
    )
    transport = _sse_transport(resume_payload)

    def _provider(resolved):
        return OpenAICompatProvider(resolved, transport=transport)

    monkeypatch.setattr("app.services.resume.resume_generate_runner.create_provider", _provider)

    task = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]}).json()
    final = _wait_terminal(client, task["id"], timeout=10.0)
    assert final["status"] == "completed", final
    gc.collect()

    assert _asyncio_errors(caplog) == []

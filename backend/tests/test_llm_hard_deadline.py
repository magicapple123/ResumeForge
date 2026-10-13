"""总预算硬 deadline 与多段用量汇总（2026-10-13 生产审计 PR-07）。

离线：MockTransport / 自定义挂起流 / 真实小预算墙钟，无真实 API Key、无付费调用。
等待预算遵守 AGENTS 两档纪律：期望**超时**的用例用 0.2s 级小预算（真到期），
期望**成功**的用例用 30s 安全网档。

钉住的红→绿矩阵：
- 退避受剩余预算约束：remaining=1.1s 且 Retry-After=8 → sleep ≤ remaining（修复前 8s——红）；
- StatusRetryGate 每次重算剩余（不再用构造时的旧值快照）；
- 预算耗尽后不发起下一次请求（provider 调用计数不再增长）；
- 无首字流（挂起不返回）→ 总 deadline 到后被取消，且 response 流已被关闭；
- 只发心跳帧的流 → 同样有硬上限（read timeout 是段间上限，切不断它）；
- usage：主生成+修复两段都有用量 → 汇总是两段之和；一段未知 → 汇总该段为 None
  （整体仍报告已知段，不伪造 0）；
- 流被中途取消 → provider 流被显式 aclose，且该段用量被补记（失败轮次也收集）。
"""

import asyncio
import json
import time

import httpx
import pytest
from app.runtime.operation_budget import OperationBudget, OperationCancelled
from app.schemas.resume import GenerateOptions
from app.services.llm import retry
from app.services.llm.base import LLMError
from app.services.llm.openai_compat import OpenAICompatProvider
from app.services.llm.retry import retry_backoff_seconds
from app.services.llm.usage import build_usage, summarize_usages
from app.services.resume.resume_generator import ResumeGenerator
from tests.test_llm_retry import _config, _counting_transport
from tests.test_resume_generator import (
    GOOD_RESUME,
    FakeProvider,
    collect_events,
    make_job,
    make_profile,
)

# ===== 纯函数：退避受剩余预算约束（PR-07-2）=====


def test_backoff_is_capped_by_remaining_budget():
    """remaining=1.1s 且 Retry-After=8：退避必须 ≤ 剩余预算（修复前返回 8.0——红）。"""
    delay = retry_backoff_seconds(429, 0, "8", deadline_remaining=1.1)
    assert delay is not None
    assert delay <= 1.1
    assert delay > 0  # 压缩后仍要真的重试，而不是悄悄变成 0


def test_backoff_refuses_when_remaining_under_minimum():
    """剩余不足 1s 仍不重试（既有硬性不变式，保持绿）。"""
    assert retry_backoff_seconds(429, 0, "8", deadline_remaining=0.5) is None


def test_backoff_uncapped_without_budget():
    """未接预算时行为不变：Retry-After 尊重且 8s 封顶。"""
    assert retry_backoff_seconds(429, 0, "8") == 8.0


def test_gate_recomputes_remaining_each_attempt():
    """StatusRetryGate 必须每次重算剩余，而不是用构造时的旧值（PR-07-2）。"""
    remaining = {"value": 5.0}
    gate = retry.StatusRetryGate(deadline_remaining_fn=lambda: remaining["value"])
    assert gate.next_delay(429) == 1.0
    remaining["value"] = 0.5  # 上一段等待/调用把预算烧掉
    assert gate.next_delay(429) is None  # 剩余不足：不再重试


# ===== Provider 集成：预算耗尽与退避 =====


async def test_provider_retry_backoff_respects_remaining_budget(monkeypatch):
    """429 + Retry-After=8 + 剩余 1.1s：实际退避被压进剩余预算（修复前 sleep=8——红）。"""
    delays = []

    async def _fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr(retry, "retry_sleep", _fake_sleep)
    transport, state = _counting_transport([(429, {"Retry-After": "8"}, b"rate limited")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    provider.request_budget = OperationBudget.start(1.1)
    with pytest.raises(LLMError):
        await provider.chat([{"role": "user", "content": "hi"}])
    assert delays, "应有重试退避"
    assert all(delay <= 1.1 for delay in delays)


async def test_expired_budget_issues_no_request():
    """预算耗尽后不发起下一次请求：provider 调用计数不再增长（这里是 0）。"""
    transport, state = _counting_transport([(200, {}, b"{}")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    provider.request_budget = OperationBudget.start(0.01)
    await asyncio.sleep(0.05)  # 让预算真的过期
    with pytest.raises(OperationCancelled):
        await provider.chat([{"role": "user", "content": "hi"}])
    assert state["count"] == 0


async def test_expired_budget_stream_issues_no_request():
    """流式同理：预算已过期时进入 stream_chat_events 不发任何请求。"""
    transport, state = _counting_transport([(200, {}, b"")])
    provider = OpenAICompatProvider(_config(), transport=transport)
    provider.request_budget = OperationBudget.start(0.01)
    await asyncio.sleep(0.05)
    with pytest.raises(OperationCancelled):
        async for _delta in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
            pass
    assert state["count"] == 0


# ===== 无首字流 / 只发心跳帧的流：总 deadline 硬切（PR-07-3）=====


class _HangingTransport(httpx.AsyncBaseTransport):
    """返回一个永不产出数据（首字前静默）的 200 流。"""

    def __init__(self):
        self.closed = False

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        async def body():
            try:
                await asyncio.sleep(3600)
                yield b"data: never\n\n"
            finally:
                self.closed = True

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())


class _HeartbeatTransport(httpx.AsyncBaseTransport):
    """只发 SSE 注释心跳帧、永不发业务数据的流（read timeout 切不断它）。"""

    def __init__(self):
        self.closed = False

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        async def body():
            try:
                while True:
                    yield b": ping\n\n"
                    await asyncio.sleep(0.02)
            finally:
                self.closed = True

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())


@pytest.mark.parametrize("transport_factory", [_HangingTransport, _HeartbeatTransport])
async def test_dead_stream_is_hard_cut_by_total_deadline(transport_factory):
    """总 deadline 到后任务被取消，response 流被关闭（aclose 语义落到底层流）。"""
    transport = transport_factory()
    provider = OpenAICompatProvider(_config(), transport=transport)
    provider.request_budget = OperationBudget.start(0.2)
    started = time.monotonic()
    with pytest.raises((OperationCancelled, LLMError)):
        async for _delta in provider.stream_chat_events([{"role": "user", "content": "hi"}]):
            pass
    elapsed = time.monotonic() - started
    # 硬上限生效：远小于挂起的 3600s / read timeout 的 10s。
    assert elapsed < 5
    assert transport.closed, "response 流应随取消被显式关闭"


async def test_chat_hard_deadline_also_applies():
    """非流式 chat 同样受整请求硬 deadline 约束（挂起响应被硬切）。"""
    transport = _HangingTransport()
    provider = OpenAICompatProvider(_config(), transport=transport)
    provider.request_budget = OperationBudget.start(0.2)
    started = time.monotonic()
    with pytest.raises((OperationCancelled, LLMError)):
        await provider.chat([{"role": "user", "content": "hi"}])
    assert time.monotonic() - started < 5
    assert transport.closed


# ===== 多段 usage 汇总（PR-07-6）=====


class _UsageScriptedProvider(FakeProvider):
    """在 stream / chat 结束时写入 last_usage 的假 Provider（模拟真实 provider 契约）。"""

    def __init__(self, stream_text, chat_replies, stream_usage, chat_usages):
        super().__init__(stream_text=stream_text, chat_replies=chat_replies)
        self._stream_usage = stream_usage
        self._chat_usages = list(chat_usages)

    async def chat(self, messages, *, thinking: bool = True):
        reply = await super().chat(messages, thinking=thinking)
        self.last_usage = self._chat_usages.pop(0)
        return reply

    async def stream_chat(self, messages):
        try:
            async for chunk in super().stream_chat(messages):
                yield chunk
        finally:
            self.last_usage = self._stream_usage


async def test_usage_aggregates_generate_and_fix_segments():
    """主生成 + 格式修复两段都有用量 → 汇总是两段之和。"""
    provider = _UsageScriptedProvider(
        stream_text="这不是 JSON",
        chat_replies=[json.dumps(GOOD_RESUME, ensure_ascii=False)],
        stream_usage=build_usage(
            "m1", elapsed_ms=10, finish_reason="length", prompt_tokens=10, completion_tokens=3
        ),
        chat_usages=[
            build_usage(
                "m1", elapsed_ms=5, finish_reason="stop", prompt_tokens=7, completion_tokens=5
            )
        ],
    )
    generator = ResumeGenerator(provider)
    await collect_events(
        generator.generate(
            make_profile(), make_job(), GenerateOptions(), budget=OperationBudget.start(30)
        )
    )
    assert len(generator.usage_records) == 2
    summary = summarize_usages(generator.usage_records)
    assert summary is not None
    assert summary["prompt_tokens"] == 17
    assert summary["completion_tokens"] == 8
    assert summary["total_tokens"] == 25
    assert summary["elapsed_ms"] == 15


async def test_usage_unknown_segment_keeps_none_but_reports_known_parts():
    """一段未知（token 为 None）→ 汇总 token 为 None；耗时/模型等已知段仍如实报告。"""
    provider = _UsageScriptedProvider(
        stream_text="这不是 JSON",
        chat_replies=[json.dumps(GOOD_RESUME, ensure_ascii=False)],
        stream_usage=build_usage(
            "m1", elapsed_ms=10, finish_reason="length", prompt_tokens=None, completion_tokens=None
        ),
        chat_usages=[
            build_usage(
                "m1", elapsed_ms=5, finish_reason="stop", prompt_tokens=7, completion_tokens=5
            )
        ],
    )
    generator = ResumeGenerator(provider)
    await collect_events(
        generator.generate(
            make_profile(), make_job(), GenerateOptions(), budget=OperationBudget.start(30)
        )
    )
    summary = summarize_usages(generator.usage_records)
    assert summary is not None
    assert summary["prompt_tokens"] is None  # 部分缺失：不给会被误读的部分和
    assert summary["completion_tokens"] is None
    assert summary["elapsed_ms"] == 15  # 已知段照常汇总
    assert summary["model"] == "m1"


class _Abort(Exception):
    """模拟调用方（runner）在收到首个 delta 后取消流。"""


class _SlowCancelProvider(FakeProvider):
    """首个 delta 后挂死的流；被 aclose 时如实写 last_usage（模拟真实 provider）。"""

    def __init__(self):
        super().__init__(stream_text="", chat_replies=[])
        self.stream_closed = False

    async def stream_chat(self, messages):
        try:
            yield "第一段"
            await asyncio.sleep(30)  # 挂死：等待调用方取消
            yield "永远到不了"  # pragma: no cover
        finally:
            self.stream_closed = True
            self.last_usage = build_usage(
                "m1",
                elapsed_ms=1,
                finish_reason="cancelled",
                prompt_tokens=11,
                completion_tokens=None,
            )


async def test_usage_captured_and_stream_closed_when_cancelled_midway():
    """取消/中断路径：provider 流被显式 aclose，失败轮次的用量也能收集到多少算多少。"""
    provider = _SlowCancelProvider()
    generator = ResumeGenerator(provider)
    stream = generator.generate(
        make_profile(), make_job(), GenerateOptions(), budget=OperationBudget.start(30)
    )
    try:
        async for event in stream:
            if event["type"] == "delta":
                raise _Abort()
        pytest.fail("不应正常走完")  # pragma: no cover
    except _Abort:
        pass
    finally:
        # runner 的 aclosing 纪律：取消后显式关闭生成器（GeneratorExit 逐层展开）。
        await stream.aclose()

    assert provider.stream_closed, "provider 流应被显式关闭"
    assert len(generator.usage_records) == 1
    assert generator.usage_records[0].prompt_tokens == 11
    assert generator.usage_records[0].finish_reason == "cancelled"


def test_runner_usage_summary_log_line(caplog):
    """runner 的用量日志是多段汇总：一段未知 → 汇总 None，不伪造 0（PR-07-6）。"""
    import logging
    from types import SimpleNamespace

    from app.services.resume.resume_generate_runner import ResumeGenerateRunner

    records = [
        build_usage(
            "m1", elapsed_ms=10, finish_reason="length", prompt_tokens=10, completion_tokens=3
        ),
        build_usage(
            "m1", elapsed_ms=5, finish_reason="stop", prompt_tokens=None, completion_tokens=None
        ),
    ]
    generator = SimpleNamespace(usage_records=records)
    with caplog.at_level(logging.INFO, logger="app.services.resume.resume_generate_runner"):
        ResumeGenerateRunner()._log_generation_usage(7, generator, estimated_prompt_tokens=None)
    line = [record.getMessage() for record in caplog.records if "模型用量" in record.getMessage()]
    assert line, "应输出一条用量汇总日志"
    assert "task_id=7" in line[-1]
    assert "prompt_tokens=None" in line[-1]
    assert "completion_tokens=None" in line[-1]
    assert "elapsed_ms=15" in line[-1]
    assert "prompt_tokens=13" not in line[-1]  # 禁止部分和冒充完整值

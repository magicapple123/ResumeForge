"""生成链预算接入（RF-14 §2.1.a）：假 Provider 离线；预算/延迟比例两侧各留
4 倍以上余量，使"过期落在哪个检查点"与调度抖动无关（AGENTS 两档等待预算纪律）。

钉住的性质：
- budget=None 时行为与改动前一致：provider 的 request_deadline_seconds 全程不被触碰；
- 格式修复/质量重试段各自取 child：调用期间 provider 的请求级 deadline 被注入、
  调用后在 finally 复位为 None（deadline 只能收紧，不能放宽配置值）；
- 预算耗尽的报错文案是「生成超出时间预算，已终止」，**不得伪装成网络超时**；
- 质量重试失败沿用首轮结果（现状语义保留，不因预算改变）；
- 流开始前的预算检查：已过期的预算在产出任何事件之前就把流程拦下。
"""

import asyncio
import json

import pytest
from app.runtime.operation_budget import OperationBudget, OperationCancelled
from app.schemas.resume import GenerateOptions
from app.services.llm.base import LLMError
from app.services.resume.resume_generator import ResumeGenerator
from tests.test_resume_generator import (
    FakeProvider,
    collect_events,
    make_job,
    make_profile,
)


class _DeadlineAwareProvider(FakeProvider):
    """记录 chat 期间看到的请求级 deadline，并可模拟"慢请求后超时"。"""

    def __init__(self, stream_text: str, chat_replies: list, chat_delay: float = 0.0):
        super().__init__(stream_text=stream_text, chat_replies=chat_replies)
        self.chat_delay = chat_delay
        self.deadlines_seen: list[float | None] = []

    async def chat(self, messages, *, thinking: bool = True):
        self.deadlines_seen.append(self.request_deadline_seconds)
        if self.chat_delay:
            await asyncio.sleep(self.chat_delay)
        if not self.chat_replies:
            raise AssertionError("没有可用的 chat 回复")
        reply = self.chat_replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


async def test_budget_none_never_touches_provider_deadline():
    """budget=None（默认）：行为逐字节不变，provider 的 deadline 全程是 None。"""
    provider = _DeadlineAwareProvider(
        stream_text="这不是 JSON",
        chat_replies=[LLMError("模型响应超时，请稍后重试或调大超时时间")],
    )
    events = await collect_events(
        ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions())
    )
    # 修复调用失败：错误文案保持现状（不是预算文案）。
    error = next(event for event in events if event["type"] == "error")
    assert "自动修复调用失败" in error["message"]
    assert provider.deadlines_seen == [None]
    assert provider.request_deadline_seconds is None
    done_events = [event for event in events if event["type"] == "done"]
    assert done_events == [] or "estimated_prompt_tokens" not in done_events[0]


async def test_fix_segment_gets_child_deadline_and_resets_it():
    """格式修复段取 child：chat 期间注入 deadline，finally 复位为 None。"""
    provider = _DeadlineAwareProvider(
        stream_text="这不是 JSON",
        chat_replies=["也不是 JSON"],
    )
    budget = OperationBudget.start(30)
    await collect_events(
        ResumeGenerator(provider).generate(
            make_profile(), make_job(), GenerateOptions(), budget=budget
        )
    )
    # 注入的是 child 剩余（正数且不超过父预算剩余）；调用后复位。
    assert len(provider.deadlines_seen) == 1
    seen = provider.deadlines_seen[0]
    assert seen is not None and 0 < seen <= 30
    assert provider.request_deadline_seconds is None


async def test_fix_segment_budget_expiry_is_not_disguised_as_timeout():
    """预算耗尽 → 文案是「生成超出时间预算，已终止」，不冒充网络超时。"""
    provider = _DeadlineAwareProvider(
        stream_text="这不是 JSON",
        chat_replies=[LLMError("模型响应超时，请稍后重试或调大超时时间")],
        chat_delay=1.0,
    )
    # 比例两侧各留 4 倍以上余量：流段瞬时完成远耗不到 0.25s（不会在 chat 前
    # 就被 raise_if_stopped 拦下走另一条错误路径），chat 1.0s 必然触发预算
    # 分支——过期确定落在"chat 之后的 is_expired 检查"，与调度抖动无关。
    budget = OperationBudget.start(0.25)
    events = await collect_events(
        ResumeGenerator(provider).generate(
            make_profile(), make_job(), GenerateOptions(), budget=budget
        )
    )
    error = next(event for event in events if event["type"] == "error")
    assert error["message"] == "生成超出时间预算，已终止"
    assert "超时，请稍后" not in error["message"]
    assert provider.request_deadline_seconds is None


async def test_quality_retry_segment_gets_child_and_keeps_first_result_on_expiry():
    """质量重试段取 child；预算耗尽导致的失败沿用首轮结果（现状语义保留）。"""
    from tests.test_resume_generator import (
        make_profile_with_reference,
        make_reference_job,
        sparse_reference_response,
    )

    provider = _DeadlineAwareProvider(
        stream_text=json.dumps(sparse_reference_response(), ensure_ascii=False),
        chat_replies=[LLMError("模型响应超时，请稍后重试或调大超时时间")],
        chat_delay=1.0,
    )
    # 同上：比例拉开（首段流瞬时 << 0.25s，重试 chat 1.0s 必然到期），过期
    # 确定落在重试 chat 期间，"沿用首轮结果"路径与调度抖动无关。
    budget = OperationBudget.start(0.25)
    events = await collect_events(
        ResumeGenerator(provider).generate(
            make_profile_with_reference(),
            make_reference_job(),
            GenerateOptions(enhance=True, enhancement_level="strong"),
            budget=budget,
        )
    )
    done = next(event for event in events if event["type"] == "done")
    # 沿用首轮结果：done 的 summary 是首轮模型输出里的那份。
    assert done["resume"]["summary"] == sparse_reference_response()["summary"]
    assert len(provider.deadlines_seen) == 1
    assert provider.deadlines_seen[0] is not None
    assert provider.request_deadline_seconds is None


async def test_quality_retry_success_injects_deadline():
    """质量重试成功路径同样注入 child deadline（并复位）。"""
    from tests.test_resume_generator import (
        make_profile_with_reference,
        make_reference_job,
        rich_reference_response,
        sparse_reference_response,
    )

    provider = _DeadlineAwareProvider(
        stream_text=json.dumps(sparse_reference_response(), ensure_ascii=False),
        chat_replies=[json.dumps(rich_reference_response(), ensure_ascii=False)],
    )
    budget = OperationBudget.start(30)
    events = await collect_events(
        ResumeGenerator(provider).generate(
            make_profile_with_reference(),
            make_reference_job(),
            GenerateOptions(enhance=True, enhancement_level="strong"),
            budget=budget,
        )
    )
    done = next(event for event in events if event["type"] == "done")
    assert done["resume"]["summary"] == rich_reference_response()["summary"]
    assert provider.deadlines_seen[0] is not None
    assert provider.request_deadline_seconds is None


async def test_expired_budget_blocks_before_model_stream():
    """流开始前的预算检查：已过期的预算在进入模型流之前拦截（先产出的是进度事件）。"""
    provider = _DeadlineAwareProvider(stream_text="好", chat_replies=[])
    budget = OperationBudget.start(0.01)
    await asyncio.sleep(0.03)  # 预算过期
    generator = ResumeGenerator(provider).generate(
        make_profile(), make_job(), GenerateOptions(), budget=budget
    )
    with pytest.raises(OperationCancelled):
        # 前几条 progress 事件照常产出（预算检查点在流开始前），随后在检查点拦截。
        await collect_events(generator)
    # 模型流从未被启动。
    assert provider.messages == []


async def test_estimated_prompt_tokens_only_when_enabled(monkeypatch):
    """§2.5：估算默认关（done 事件无估算字段）；开启时带 estimated_* 命名。"""
    from app.services.resume import resume_generator as generator_module

    good = json.dumps(
        {
            "summary": "具备 Python 后端开发经验。",
            "projects": [{"name": "简历通", "role": "核心开发"}],
        },
        ensure_ascii=False,
    )

    class _Settings:
        llm_token_estimate_enabled = False

    monkeypatch.setattr(generator_module, "get_settings", lambda: _Settings())
    provider = _DeadlineAwareProvider(stream_text=good, chat_replies=[])
    events = await collect_events(
        ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions())
    )
    done = next(event for event in events if event["type"] == "done")
    assert "estimated_prompt_tokens" not in done

    class _On:
        llm_token_estimate_enabled = True

    monkeypatch.setattr(generator_module, "get_settings", lambda: _On())
    provider = _DeadlineAwareProvider(stream_text=good, chat_replies=[])
    events = await collect_events(
        ResumeGenerator(provider).generate(make_profile(), make_job(), GenerateOptions())
    )
    done = next(event for event in events if event["type"] == "done")
    assert isinstance(done["estimated_prompt_tokens"], int)
    assert done["estimated_prompt_tokens"] > 0

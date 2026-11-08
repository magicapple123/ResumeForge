# SPDX-License-Identifier: Apache-2.0
"""Phase 0 查询扩展的单元测试（零依赖、零网络）。

守卫的性质：
- 扩展词只进 `JobFocus.terms`，skills / domains 一个都不许动（skills 是 12 分硬优先级）；
- 缓存复用 `job.analysis_cache`：命中缓存不再调模型；岗位内容变了指纹失效；
- 任何失败（未启用 / 超时 / 坏 JSON / provider 异常）都静默返回空元组，绝不抛；
- 解析与去重是纯函数，可直接断言。
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from app.models.job import Job
from app.services.profile.profile_relevance_constants import JobFocus
from app.services.rag import rag_query_expansion as expansion


def _job(**overrides) -> Job:
    values = {
        "title": "用户增长分析师",
        "company": "",
        "description": "负责会员分层与召回策略，设计增长实验。",
        "requirements": "熟悉 SQL 与指标体系。",
        "additional_info": "",
    }
    values.update(overrides)
    job = Job(**values)
    job.analysis_cache = None
    return job


def _settings(enabled: bool = True, timeout: float = 5.0):
    return SimpleNamespace(
        rag_query_expansion_enabled=enabled,
        rag_query_expansion_timeout_seconds=timeout,
    )


class _FakeProvider:
    def __init__(self, response: str = "", *, error: Exception | None = None, delay: float = 0.0):
        self.response = response
        self.error = error
        self.delay = delay
        self.calls = 0

    async def chat(self, messages, *, thinking: bool = True) -> str:  # noqa: ARG002
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.response


# ===== 解析 =====


def test_parse_expansion_terms_from_json_object():
    content = json.dumps({"terms": ["用户分层", "生命周期运营", "召回策略"]}, ensure_ascii=False)
    assert expansion.parse_expansion_terms(content) == ("用户分层", "生命周期运营", "召回策略")


def test_parse_expansion_terms_tolerates_code_fence_and_dedupes():
    content = '```json\n{"terms": ["A/B 实验", "A/B 实验", " 留存分析 ", "留存分析"]}\n```'
    assert expansion.parse_expansion_terms(content) == ("A/B 实验", "留存分析")


def test_parse_expansion_terms_rejects_non_json():
    with pytest.raises(ValueError):
        expansion.parse_expansion_terms("没有 JSON")


def test_normalize_terms_caps_length_and_drops_short_or_long():
    raw = ["a", "两个", "x" * 40, "正常词", "，", "正常词"]
    terms = expansion.normalize_terms(raw)
    assert terms == ("两个", "正常词")


def test_apply_expansion_only_touches_terms():
    focus = JobFocus(skills=("SQL",), domains=("data",), terms=("增长",))
    merged = expansion.apply_expansion(focus, ("会员运营", "增长"))
    assert merged.skills == ("SQL",)
    assert merged.domains == ("data",)
    assert merged.terms == ("增长", "会员运营")


def test_build_expansion_messages_marks_untrusted_input():
    messages = expansion.build_expansion_messages(_job())
    assert len(messages) == 2
    assert "用户增长分析师" in messages[1]["content"]
    assert "不可信输入" in messages[1]["content"]


# ===== 缓存 =====


def test_cache_hit_skips_model_call():
    job = _job()
    provider = _FakeProvider("{}")
    terms = asyncio.run(expansion.expand_job_terms(job, provider=provider, settings=_settings()))
    assert terms == ()
    assert provider.calls == 1

    job.analysis_cache = {
        "rag_query_expansion": {
            "fingerprint": __import__(
                "app.services.job_analysis_cache", fromlist=["analysis_fingerprint"]
            ).analysis_fingerprint(job),
            "terms": ["会员分层", "用户召回"],
        }
    }
    cached = asyncio.run(expansion.expand_job_terms(job, provider=provider, settings=_settings()))
    assert cached == ("会员分层", "用户召回")
    assert provider.calls == 1


def test_cache_written_after_successful_call():
    job = _job()
    provider = _FakeProvider(json.dumps({"terms": ["会员分层", "生命周期"]}, ensure_ascii=False))
    terms = asyncio.run(expansion.expand_job_terms(job, provider=provider, settings=_settings()))
    assert terms == ("会员分层", "生命周期")
    assert job.analysis_cache is not None
    slot = job.analysis_cache["rag_query_expansion"]
    assert slot["terms"] == ["会员分层", "生命周期"]


def test_stale_fingerprint_invalidates_cache():
    job = _job()
    job.analysis_cache = {
        "rag_query_expansion": {"fingerprint": "stale", "terms": ["旧词"]},
    }
    provider = _FakeProvider(json.dumps({"terms": ["新词"]}, ensure_ascii=False))
    terms = asyncio.run(expansion.expand_job_terms(job, provider=provider, settings=_settings()))
    assert terms == ("新词",)
    assert provider.calls == 1


# ===== 静默回退 =====


def test_disabled_returns_empty_without_calling_provider():
    provider = _FakeProvider("{}")
    terms = asyncio.run(
        expansion.expand_job_terms(_job(), provider=provider, settings=_settings(enabled=False))
    )
    assert terms == ()
    assert provider.calls == 0


def test_provider_error_returns_empty():
    provider = _FakeProvider(error=RuntimeError("boom"))
    terms = asyncio.run(expansion.expand_job_terms(_job(), provider=provider, settings=_settings()))
    assert terms == ()


def test_bad_json_returns_empty_and_does_not_cache():
    job = _job()
    provider = _FakeProvider("不是 JSON")
    terms = asyncio.run(expansion.expand_job_terms(job, provider=provider, settings=_settings()))
    assert terms == ()
    assert job.analysis_cache is None


def test_timeout_returns_empty():
    provider = _FakeProvider(json.dumps({"terms": ["慢词"]}), delay=0.2)
    terms = asyncio.run(
        expansion.expand_job_terms(_job(), provider=provider, settings=_settings(timeout=0.05))
    )
    assert terms == ()

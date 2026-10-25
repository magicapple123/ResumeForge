# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本：落库、按任务/模型汇总、未知 token 不臆造、隐私边界。

不保存提示词/回复/密钥/个人资料是**结构性**的：模型没有这些列，测试直接检查列集合；
接口响应里也不能出现正文（只可能是数字与枚举）。
"""

from __future__ import annotations

import json
import time

from app.models.job import Job
from app.models.llm_usage import LLMUsageRecord
from app.models.resume import ResumeRecord
from app.schemas.setting import LLMConfig
from app.services.llm import usage_ledger
from app.services.llm.base import BaseLLMProvider
from app.services.llm.usage import FINISH_STOP, build_usage, summarize_usages
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    SuccessfulProvider,
    _configure,
    _job,
    _seed_profile,
    _wait_terminal,
)

# 可能出现用户正文/凭据的列名；账本一张都不许有。
FORBIDDEN_COLUMNS = {
    "prompt",
    "prompt_text",
    "messages",
    "response",
    "completion",
    "content",
    "api_key",
    "password",
    "email",
    "name",
    "request_body",
    "response_body",
}


def _usage(model: str = "synthetic-model") -> object:
    return build_usage(
        model,
        elapsed_ms=120,
        finish_reason="stop",
        prompt_tokens=100,
        completion_tokens=50,
        retries=1,
    )


class _FakeProvider:
    def __init__(self, usage=None) -> None:
        self.last_usage = usage


def test_record_llm_usage_copies_tokens_and_unknown_stays_null(db_session):
    known = usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    assert (known.prompt_tokens, known.completion_tokens, known.total_tokens) == (100, 50, 150)
    assert (known.duration_ms, known.finish_reason, known.retries) == (120, "stop", 1)

    unknown = usage_ledger.record_llm_usage(db_session, task="translate", usage=None)
    assert unknown.prompt_tokens is None
    assert unknown.completion_tokens is None
    assert unknown.total_tokens is None
    assert unknown.finish_reason == usage_ledger.FINISH_UNKNOWN
    assert unknown.retries == 0


def test_record_provider_usage_reads_last_usage(db_session):
    provider = _FakeProvider(_usage())
    row = usage_ledger.record_provider_usage(
        db_session, task=usage_ledger.TASK_RESUME_REVISE, provider=provider
    )
    assert row.model == "synthetic-model"
    assert row.total_tokens == 150

    bare = usage_ledger.record_provider_usage(
        db_session, task=usage_ledger.TASK_RESUME_REVISE, provider=object()
    )
    assert bare.total_tokens is None


def test_summary_aggregates_by_task_and_model_without_partial_sums(db_session):
    usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage("model-a"))
    usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage("model-a"))
    usage_ledger.record_llm_usage(db_session, task="translate", usage=None, model="model-b")

    summary = usage_ledger.summarize_usage(db_session)

    assert summary["records"] == 3
    assert summary["unknown_token_records"] == 1
    # 只要有一行未知，总量就整体报未知（部分和会被误读成完整值）。
    assert summary["totals"]["total_tokens"] is None
    assert summary["totals"]["prompt_tokens"] is None
    assert summary["totals"]["calls"] == 3
    buckets = {item["key"]: item for item in summary["tasks"]}
    assert buckets["resume_revise"]["calls"] == 2
    assert buckets["resume_revise"]["total_tokens"] == 300
    assert buckets["translate"]["unknown_token_calls"] == 1
    assert buckets["translate"]["total_tokens"] is None
    assert {item["key"] for item in summary["models"]} == {"model-a", "model-b"}
    assert summary["cost"]["estimated"] is False
    assert summary["cost"]["amount"] is None


def test_summary_filters_by_task(db_session):
    usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    usage_ledger.record_llm_usage(db_session, task="assistant", usage=_usage())

    summary = usage_ledger.summarize_usage(db_session, task="assistant")

    assert summary["records"] == 1
    assert [item["key"] for item in summary["tasks"]] == ["assistant"]


def test_cost_is_not_estimated_without_configured_price(db_session):
    usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())

    summary = usage_ledger.summarize_usage(db_session)

    assert summary["cost"] == {
        "estimated": False,
        "currency": "",
        "amount": None,
        "reason": usage_ledger.COST_NOT_CONFIGURED,
    }
    # 未配置单价时不得凭空写金额。
    assert summary["totals"]["calls"] == 1


def test_cost_estimated_when_user_configures_prices(client, db_session):
    response = client.put(
        "/api/usage/pricing",
        json={"input_per_1k": 1.0, "output_per_1k": 2.0, "currency": "USD"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["configured"] is True
    assert response.json()["source"] == "settings"

    # 100 prompt + 50 completion：100/1000*1 + 50/1000*2 = 0.2
    row = usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    assert row.cost_estimate == 0.2
    assert row.cost_currency == "USD"

    summary = usage_ledger.summarize_usage(db_session)
    assert summary["cost"] == {
        "estimated": True,
        "currency": "USD",
        "amount": 0.2,
        "reason": "",
    }

    # token 未知的行不参与金额：仍然 estimated=True，但 reason 说明是部分估算。
    usage_ledger.record_llm_usage(db_session, task="translate", usage=None)
    partial = usage_ledger.summarize_usage(db_session)
    assert partial["cost"]["estimated"] is True
    assert partial["cost"]["amount"] == 0.2
    assert partial["cost"]["reason"] == usage_ledger.COST_PARTIAL

    # 清除单价：回到"未知费用"（不保留上一次的估算口径）。
    cleared = client.put(
        "/api/usage/pricing", json={"input_per_1k": None, "output_per_1k": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["configured"] is False
    assert usage_ledger.summarize_usage(db_session)["cost"]["estimated"] is False


def test_cost_estimated_from_environment_prices(monkeypatch, db_session):
    monkeypatch.setenv(usage_ledger.PRICING_ENV_INPUT, "0.5")
    monkeypatch.setenv(usage_ledger.PRICING_ENV_OUTPUT, "1.5")
    monkeypatch.setenv(usage_ledger.PRICING_ENV_CURRENCY, "EUR")

    pricing = usage_ledger.load_pricing(db_session)
    assert pricing is not None
    assert pricing.source == "environment"
    assert pricing.currency == "EUR"

    row = usage_ledger.record_llm_usage(db_session, task="assistant", usage=_usage())
    # 100/1000*0.5 + 50/1000*1.5 = 0.125
    assert row.cost_estimate == 0.125
    summary = usage_ledger.summarize_usage(db_session)
    assert summary["cost"]["estimated"] is True
    assert summary["cost"]["currency"] == "EUR"
    assert summary["cost"]["amount"] == 0.125


def test_pricing_endpoint_validates_pair_and_ranges(client):
    assert client.get("/api/usage/pricing").json()["configured"] is False
    assert (
        client.put("/api/usage/pricing", json={"input_per_1k": 1.0}).status_code == 422
    )
    assert (
        client.put(
            "/api/usage/pricing", json={"input_per_1k": -1, "output_per_1k": 1}
        ).status_code
        == 422
    )


def test_finish_reasons_are_recorded_and_aggregated(db_session):
    from app.services.llm.usage import build_usage

    usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    usage_ledger.record_llm_usage(
        db_session,
        task="resume_revise",
        usage=build_usage(
            "synthetic-model", elapsed_ms=10, finish_reason="length", prompt_tokens=1
        ),
    )
    usage_ledger.record_llm_usage(db_session, task="translate", usage=None)

    summary = usage_ledger.summarize_usage(db_session)

    buckets = {item["key"]: item for item in summary["tasks"]}
    assert buckets["resume_revise"]["finish_reasons"] == {"length": 1, "stop": 1}
    assert buckets["translate"]["finish_reasons"] == {usage_ledger.FINISH_UNKNOWN: 1}
    assert summary["totals"]["finish_reasons"] == {"length": 1, "stop": 1, "unknown": 1}


def test_records_endpoint_serializes_finish_reason_without_content(client, db_session):
    usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    response = client.get("/api/usage/records")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 1
    item = body["items"][0]
    assert item["finish_reason"] == "stop"
    assert item["retries"] == 1
    assert item["total_tokens"] == 150
    for forbidden in ("prompt_text", "messages", "api_key", "password", "content"):
        assert forbidden not in item


def test_provider_finish_reason_is_preferred_over_unknown(db_session):
    class _Provider:
        last_usage = None

    row = usage_ledger.record_provider_usage(
        db_session,
        task=usage_ledger.TASK_RESUME_REVISE,
        provider=_Provider(),
        finish_reason="cancelled",
    )
    assert row.finish_reason == "cancelled"
    assert row.total_tokens is None


def test_usage_table_has_no_prompt_or_secret_columns(db_session):
    columns = set(LLMUsageRecord.__table__.columns.keys())
    assert not (columns & FORBIDDEN_COLUMNS)


def test_summary_endpoint_returns_only_numbers_and_no_body(client, db_session):
    usage_ledger.record_llm_usage(
        db_session,
        task=usage_ledger.TASK_RESUME_REVISE,
        usage=_usage(),
        resume_id=None,
    )
    response = client.get("/api/usage/summary")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["records"] == 1
    assert body["totals"]["total_tokens"] == 150
    assert body["cost"]["estimated"] is False
    serialized = response.text
    # prompt_tokens 是合法字段；这里查的是正文/凭据类的键，不是 token 计数字段。
    for forbidden in ("prompt_text", "messages", "api_key", "password", "completion_text"):
        assert forbidden not in serialized


def test_summarize_app_usages_reuses_the_existing_in_memory_contract():
    usages = [_usage(), _usage()]
    assert usage_ledger.summarize_app_usages(usages) == summarize_usages(usages)


def test_revise_endpoint_records_provider_usage(client, monkeypatch, db_session):
    import json

    from app.schemas.setting import LLMConfig

    created = client.post(
        "/api/resumes/manual",
        json={"title": "用量测试", "content": {"name": "张示例", "summary": "一段总结"}},
    )
    resume_id = created.json()["id"]

    class _Provider:
        last_usage = _usage()

        async def chat(self, messages, *, thinking: bool = True):
            return json.dumps({"summary": "改过的总结"}, ensure_ascii=False)

    monkeypatch.setattr(
        "app.api.resumes.get_llm_config",
        lambda db: LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="synthetic-model"
        ),
    )
    monkeypatch.setattr("app.api.resumes.create_provider", lambda config: _Provider())
    response = client.post(
        f"/api/resumes/{resume_id}/revise",
        json={"instructions": "精炼", "base_revision": created.json()["revision"]},
    )
    assert response.status_code == 200, response.text

    rows = db_session.query(LLMUsageRecord).filter_by(task="resume_revise").all()
    assert len(rows) == 1
    assert rows[0].resume_id == resume_id
    assert rows[0].total_tokens == 150

# ===== R04 补全：端点级守卫——真实 provider 每调用一次，账本必须 +1 =====
#
# 上一轮验收发现 27 次真实 AI 调用只落了 1 条账（只有 /revise 手工记账）。这里守的是
# "任务名从请求路径下发、provider 调用即落账"这条新机制：每个用例都走真实 HTTP 路由
# （TestClient）→ 中间件写环境任务 → provider._record_usage → 账本自动 +1，
# 不 sleep、不联网，provider 是纯内存假实现。


class _UsageRecordingProvider(BaseLLMProvider):
    """纯内存 provider：每次调用都走基类 _record_usage（等价真实 provider 的收尾）。"""

    def __init__(self, reply: str) -> None:
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.reply = reply

    async def chat(self, messages, *, thinking: bool = True):
        self._record_usage(
            started=time.monotonic(),
            finish_reason=FINISH_STOP,
            prompt_tokens=10,
            completion_tokens=5,
        )
        return self.reply

    async def stream_chat(self, messages):
        self._record_usage(
            started=time.monotonic(),
            finish_reason=FINISH_STOP,
            prompt_tokens=10,
            completion_tokens=5,
        )
        yield self.reply


def _usage_rows(db_session, task: str) -> list[LLMUsageRecord]:
    """读账本前先结束本会话事务，否则看不到另一条连接刚提交的自动记账行。"""
    db_session.rollback()
    return (
        db_session.query(LLMUsageRecord)
        .filter(LLMUsageRecord.task == task)
        .order_by(LLMUsageRecord.id)
        .all()
    )


def test_writing_endpoint_records_usage(client, db_session, monkeypatch):
    record = ResumeRecord(title="用量验收-写作", content={"name": "张三"})
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    provider = _UsageRecordingProvider(json.dumps({"result": "负责后端服务开发"}, ensure_ascii=False))
    monkeypatch.setattr("app.api.resume_writing.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.resume_writing.create_provider", lambda _config: provider)

    response = client.post(
        f"/api/resumes/{record.id}/writing/polish",
        json={"text": "负责后端开发。", "style": "concise_tech"},
    )

    assert response.status_code == 200, response.text
    rows = _usage_rows(db_session, usage_ledger.TASK_RESUME_WRITING)
    assert len(rows) == 1
    assert rows[0].total_tokens == 15
    assert rows[0].finish_reason == FINISH_STOP


def test_job_match_endpoint_records_usage(client, db_session, monkeypatch):
    job = Job(
        title="后端开发工程师",
        company="示例公司",
        description="负责后端服务开发",
        requirements="本科及以上；熟悉 Python",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    resume = ResumeRecord(
        title="后端简历",
        job_id=job.id,
        content={
            "name": "张三",
            "education": [{"school": "示例大学", "degree": "本科"}],
            "skills": [{"name": "Python"}],
        },
    )
    db_session.add(resume)
    db_session.commit()
    result = {
        "hard_conditions": [
            {"label": "本科及以上", "jd_quote": "本科及以上", "status": "matched", "evidence": "本科"}
        ],
        "core_abilities": [
            {"label": "熟悉 Python", "jd_quote": "熟悉 Python", "status": "matched", "evidence": "Python"}
        ],
        "bonus_items": [],
        "hard_gate": "met",
        "admission": "allow",
        "advice": "建议投递。",
        "notes": [],
    }
    provider = _UsageRecordingProvider(json.dumps(result, ensure_ascii=False))
    monkeypatch.setattr("app.api.job_match.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.job_match.create_provider", lambda _config: provider)

    response = client.post(f"/api/jobs/{job.id}/match-analysis")

    assert response.status_code == 200, response.text
    rows = _usage_rows(db_session, usage_ledger.TASK_JOB_MATCH)
    assert len(rows) == 1
    assert rows[0].total_tokens == 15


def test_assistant_endpoint_records_usage(client, db_session, monkeypatch):
    provider = _UsageRecordingProvider("你好，这是用量验收回复。")
    monkeypatch.setattr("app.api.assistant.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = client.post("/api/assistant/conversations", json={})
    assert conversation.status_code == 201, conversation.text
    conversation_id = conversation.json()["id"]

    with client.stream(
        "POST",
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": "你好"},
    ) as response:
        assert response.status_code == 200, response.text
        response.read()

    rows = _usage_rows(db_session, usage_ledger.TASK_ASSISTANT)
    assert len(rows) == 1
    assert rows[0].total_tokens == 15


class _RecordingSuccessfulProvider(SuccessfulProvider):
    """生成任务用的合法 JSON provider，额外走一次基类 _record_usage。"""

    async def stream_chat(self, messages):
        self._record_usage(
            started=time.monotonic(),
            finish_reason=FINISH_STOP,
            prompt_tokens=30,
            completion_tokens=20,
        )
        async for chunk in super().stream_chat(messages):
            yield chunk


def test_generation_task_records_usage(client, db_session, monkeypatch):
    reset_resume_generate_runner()
    try:
        _seed_profile(client)
        _configure(client)
        job = _job(client)
        monkeypatch.setattr(
            "app.services.resume.resume_generate_runner.create_provider",
            lambda resolved: _RecordingSuccessfulProvider(resolved),
        )

        started = client.post("/api/resumes/generate/tasks", json={"job_id": job["id"]})
        assert started.status_code == 201, started.text
        final = _wait_terminal(client, started.json()["id"])

        assert final["status"] == "completed", final
        rows = _usage_rows(db_session, usage_ledger.TASK_RESUME_GENERATE)
        assert len(rows) == 1
        assert rows[0].total_tokens == 50
    finally:
        reset_resume_generate_runner()


# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本：落库、按任务/模型汇总、未知 token 不臆造、隐私边界。

不保存提示词/回复/密钥/个人资料是**结构性**的：模型没有这些列，测试直接检查列集合；
接口响应里也不能出现正文（只可能是数字与枚举）。
"""

from __future__ import annotations

from app.models.llm_usage import LLMUsageRecord
from app.services.llm import usage_ledger
from app.services.llm.usage import build_usage, summarize_usages

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


def test_cost_is_estimated_only_when_every_row_has_a_price(db_session):
    first = usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    second = usage_ledger.record_llm_usage(db_session, task="assistant", usage=_usage())
    for row in (first, second):
        row.cost_estimate = 0.25
        row.cost_currency = "USD"
    db_session.commit()

    summary = usage_ledger.summarize_usage(db_session)
    assert summary["cost"] == {
        "estimated": True,
        "currency": "USD",
        "amount": 0.5,
        "reason": "",
    }

    second.cost_currency = "CNY"
    db_session.commit()
    assert usage_ledger.summarize_usage(db_session)["cost"]["estimated"] is False


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

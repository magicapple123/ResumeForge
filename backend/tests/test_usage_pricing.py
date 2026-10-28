# SPDX-License-Identifier: Apache-2.0
"""模型单价与费用估算（0067）：每百万 token、三档（缓存命中 / 未命中 / 输出）。

边界：
- 单价是**可命名的记录**，每次保存新建一条，可改名、可切回、可删除；
- 估算只认已配置的单价，未配置就给"未配置"而不是 0；
- 缓存命中数未知时整段输入按未命中价计（宁可估高，也不凭空变便宜）。
"""

from __future__ import annotations

from app.services.llm import usage_ledger
from app.services.llm.usage import build_usage


def _usage(model: str = "synthetic-model") -> object:
    """固定的一次调用：100 输入 + 50 输出，用来对账。"""
    return build_usage(
        model,
        elapsed_ms=120,
        finish_reason="stop",
        prompt_tokens=100,
        completion_tokens=50,
        retries=1,
    )


def test_cost_estimated_when_user_configures_prices(client, db_session):
    # 0067 起单价按**每百万 token**、三档（缓存命中 / 未命中 / 输出）记录。
    response = client.put(
        "/api/usage/pricing",
        json={
            "name": "测试价",
            "input_cache_hit_per_million": 1000.0,
            "input_cache_miss_per_million": 4000.0,
            "output_per_million": 8000.0,
            "currency": "USD",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is True
    assert body["source"] == "record"
    assert body["name"] == "测试价"

    # 100 prompt（未知缓存命中 → 全按未命中价）+ 50 completion：
    # 100/1e6*4000 + 50/1e6*8000 = 0.4 + 0.4 = 0.8
    row = usage_ledger.record_llm_usage(db_session, task="resume_revise", usage=_usage())
    assert row.cost_estimate == 0.8
    assert row.cost_currency == "USD"

    summary = usage_ledger.summarize_usage(db_session)
    assert summary["cost"] == {
        "estimated": True,
        "currency": "USD",
        "amount": 0.8,
        "reason": "",
    }

    # token 未知的行不参与金额：仍然 estimated=True，但 reason 说明是部分估算。
    usage_ledger.record_llm_usage(db_session, task="translate", usage=None)
    partial = usage_ledger.summarize_usage(db_session)
    assert partial["cost"]["estimated"] is True
    assert partial["cost"]["amount"] == 0.8
    assert partial["cost"]["reason"] == usage_ledger.COST_PARTIAL


def test_cache_hit_tokens_use_the_cheaper_bucket(client, db_session):
    client.put(
        "/api/usage/pricing",
        json={
            "input_cache_hit_per_million": 500.0,
            "input_cache_miss_per_million": 4000.0,
            "output_per_million": 8000.0,
            "currency": "CNY",
        },
    )
    usage = build_usage(
        "synthetic-model",
        elapsed_ms=10,
        finish_reason="stop",
        prompt_tokens=1000,
        completion_tokens=0,
        cache_hit_tokens=800,
    )
    row = usage_ledger.record_llm_usage(db_session, task="assistant", usage=usage)

    # 800 命中按 500/1e6、200 未命中按 4000/1e6：0.4 + 0.8 = 1.2
    assert row.cost_estimate == 1.2
    assert row.cache_hit_tokens == 800
    assert row.cache_miss_tokens == 200

    totals = usage_ledger.summarize_usage(db_session)["totals"]
    assert totals["cache_hit_tokens"] == 800
    assert totals["cache_miss_tokens"] == 200
    assert totals["cache_unknown_calls"] == 0


def test_cost_estimated_from_environment_prices(monkeypatch, db_session):
    # 老的环境变量仍是"每千 token"，读入时 ×1000 换算，命中档与未命中档同价。
    monkeypatch.setenv(usage_ledger.PRICING_ENV_INPUT, "0.5")
    monkeypatch.setenv(usage_ledger.PRICING_ENV_OUTPUT, "1.5")
    monkeypatch.setenv(usage_ledger.PRICING_ENV_CURRENCY, "EUR")

    pricing = usage_ledger.load_pricing(db_session)
    assert pricing is not None
    assert pricing.source == "environment"
    assert pricing.currency == "EUR"
    assert pricing.input_cache_miss_per_million == 500.0
    assert pricing.output_per_million == 1500.0

    row = usage_ledger.record_llm_usage(db_session, task="assistant", usage=_usage())
    # 100/1e6*500 + 50/1e6*1500 = 0.05 + 0.075 = 0.125
    assert row.cost_estimate == 0.125
    summary = usage_ledger.summarize_usage(db_session)
    assert summary["cost"]["estimated"] is True
    assert summary["cost"]["currency"] == "EUR"
    assert summary["cost"]["amount"] == 0.125


def test_pricing_records_can_be_named_renamed_activated_and_deleted(client):
    first = client.put(
        "/api/usage/pricing",
        json={"name": "官方价", "output_per_million": 8000.0},
    ).json()
    assert first["name"] == "官方价"

    second = client.put(
        "/api/usage/pricing",
        json={"name": "调价后", "output_per_million": 4000.0},
    ).json()
    # 后保存的自动生效。
    assert second["name"] == "调价后"
    records = client.get("/api/usage/pricing/records").json()
    assert records["count"] == 2
    active = [item for item in records["items"] if item["is_active"]]
    assert len(active) == 1
    assert active[0]["name"] == "调价后"

    # 改名只改名字，价格与生效状态不动。
    renamed = client.patch(
        f"/api/usage/pricing/records/{active[0]['id']}", json={"name": "2026-10 调价"}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "2026-10 调价"
    assert renamed.json()["output_per_million"] == 4000.0
    assert renamed.json()["is_active"] is True

    # 切回第一条：它生效，另一条失效。
    older = [item for item in records["items"] if not item["is_active"]][0]
    activated = client.post(f"/api/usage/pricing/records/{older['id']}/activate").json()
    assert activated["configured"] is True
    assert activated["name"] == "官方价"

    # 删掉生效那条：剩下最新的一条顶上。
    deleted = client.delete(f"/api/usage/pricing/records/{older['id']}")
    assert deleted.status_code == 200, deleted.text
    left = client.get("/api/usage/pricing/records").json()
    assert left["count"] == 1
    assert left["items"][0]["is_active"] is True
    assert client.get("/api/usage/pricing").json()["configured"] is True

    # 删空后回到"未配置单价"。
    client.delete(f"/api/usage/pricing/records/{left['items'][0]['id']}")
    assert client.get("/api/usage/pricing").json()["configured"] is False


def test_pricing_endpoint_requires_at_least_one_price(client):
    assert client.get("/api/usage/pricing").json()["configured"] is False
    # 三档全空 → 400（"至少要填一档"，由 schema 校验拦下 422 也行，两者都不接受）。
    empty = client.put("/api/usage/pricing", json={"name": "空价"})
    assert empty.status_code in {400, 422}
    # 负数被范围校验拦下。
    assert client.put("/api/usage/pricing", json={"output_per_million": -1}).status_code == 422

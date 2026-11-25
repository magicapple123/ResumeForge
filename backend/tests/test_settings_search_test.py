# SPDX-License-Identifier: Apache-2.0
"""CR-04：搜索 Key 的校验入口（只做 DeepSeek，Tavily / Jina 后补）。

验收口径（任务书 + §9）：

- 401 → ``{ok: false, reason: "unauthorized"}``；超时 → ``network``；成功 → 带 ``latency``；
- 只用**固定 host**（``api.deepseek.com``），不接受调用方传 base_url；不跟随重定向；
- 可用"待测 Key"（表单里刚粘、还没保存的那把），留空时测已保存的那把；
- 验证失败**不阻断保存**——这是前端的职责（按钮与自动保存互不影响）。
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from app.schemas.setting import SearchConfig
from app.services.web_search_settings import save_search_config

PROBE_KEY = "sk-probe-0123456789"


def _probe(handler, key: str = PROBE_KEY):
    from app.services.search.key_probe import probe_deepseek_search_key

    async def _run():
        return await probe_deepseek_search_key(key, transport=httpx.MockTransport(handler))

    return asyncio.run(_run())


def test_invalid_key_maps_to_unauthorized():
    result = _probe(lambda request: httpx.Response(401, json={"error": "bad key"}))

    assert result.ok is False
    assert result.reason == "unauthorized"
    # 文案要指路，不能只说"失败"。
    assert "Key" in result.message


def test_success_reports_latency():
    result = _probe(lambda request: httpx.Response(200, json={"data": []}))

    assert result.ok is True
    assert result.reason == ""
    assert isinstance(result.latency_ms, int)
    assert result.latency_ms >= 0


def test_timeout_maps_to_network():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("boom", request=request)

    result = _probe(handler)

    assert result.ok is False
    assert result.reason == "network"


def test_redirects_are_not_followed():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://evil.example/"})

    result = _probe(handler)

    # follow_redirects=False：只发一次，绝不把带 Authorization 的请求转到别的主机。
    assert calls == ["https://api.deepseek.com/v1/models"]
    assert result.ok is False
    assert result.reason == "network"


def test_rate_limit_and_balance_are_distinguished():
    assert _probe(lambda request: httpx.Response(429)).reason == "rate_limited"
    assert _probe(lambda request: httpx.Response(402)).reason == "insufficient_balance"


def test_server_error_maps_to_network():
    result = _probe(lambda request: httpx.Response(503))

    assert result.ok is False
    assert result.reason == "network"


def test_endpoint_uses_the_pending_key(client, monkeypatch):
    from app.api import settings_search

    seen: list[str] = []

    async def fake_probe(key: str, **_kwargs):
        seen.append(key)
        from app.schemas.search_key_test import SearchKeyTestResult

        return SearchKeyTestResult(ok=True, latency_ms=12, message="连接成功")

    monkeypatch.setattr(settings_search, "probe_deepseek_search_key", fake_probe)

    response = client.post("/api/settings/search/test", json={"api_key": PROBE_KEY})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert seen == [PROBE_KEY]


def test_endpoint_falls_back_to_the_saved_key(client, db_session, monkeypatch):
    from app.api import settings_search

    save_search_config(db_session, SearchConfig(deepseek_api_key="sk-saved-abcdef123456"))
    seen: list[str] = []

    async def fake_probe(key: str, **_kwargs):
        seen.append(key)
        from app.schemas.search_key_test import SearchKeyTestResult

        return SearchKeyTestResult(ok=True, latency_ms=8, message="连接成功")

    monkeypatch.setattr(settings_search, "probe_deepseek_search_key", fake_probe)

    response = client.post("/api/settings/search/test", json={"api_key": ""})

    assert response.status_code == 200
    assert seen == ["sk-saved-abcdef123456"]


def test_endpoint_reports_missing_key_without_calling_upstream(client, monkeypatch):
    from app.api import settings_search

    called: list[str] = []

    async def fake_probe(key: str, **_kwargs):  # pragma: no cover - 不该被调用
        called.append(key)  # pragma: no cover
        raise AssertionError("没有 Key 时不该发请求")

    monkeypatch.setattr(settings_search, "probe_deepseek_search_key", fake_probe)

    response = client.post("/api/settings/search/test", json={"api_key": ""})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["reason"] == "missing_key"
    assert called == []
    assert "设置" in body["message"]


def test_endpoint_uses_the_borrowed_model_key(client, db_session, monkeypatch):
    """CR-06 的回落也要能被测：搜索 Key 没填、模型是 DeepSeek 时测的是模型那把。"""
    from app.api import settings_search
    from app.schemas.setting import LLMConfig
    from app.services.llm_settings import save_llm_config

    save_search_config(db_session, SearchConfig(deepseek_api_key=""))
    save_llm_config(
        db_session,
        LLMConfig(
            base_url="https://api.deepseek.com/v1",
            model="deepseek-flash",
            api_key="sk-model-0123456789abcdef",
        ),
    )
    seen: list[str] = []

    async def fake_probe(key: str, **_kwargs):
        seen.append(key)
        from app.schemas.search_key_test import SearchKeyTestResult

        return SearchKeyTestResult(ok=True, latency_ms=5, message="连接成功")

    monkeypatch.setattr(settings_search, "probe_deepseek_search_key", fake_probe)

    response = client.post("/api/settings/search/test", json={"api_key": ""})

    assert response.status_code == 200
    assert seen == ["sk-model-0123456789abcdef"]


@pytest.fixture(autouse=True)
def _no_session_key():
    from app.services.api_key_session import clear_session_key

    clear_session_key()
    yield
    clear_session_key()

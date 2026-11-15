# SPDX-License-Identifier: Apache-2.0
"""DeepSeek Search / Fetch 客户端的离线测试。

全部走 ``httpx.MockTransport``：不许真打网络（真实联网由交付时的人工 smoke 覆盖）。
这里钉住的是"哪一步会重试、哪一步必须整段放弃、密钥不在 URL 与日志里"。
"""

from __future__ import annotations

import httpx
import pytest
from app.schemas.setting import SearchConfig
from app.services.search import deepseek as deepseek_module
from app.services.search.deepseek import (
    DeepSeekResults,
    DeepSeekUnavailable,
    fetch_deepseek_text,
    fetch_deepseek_text_sync,
    has_search_operators,
    search_deepseek,
)
from tests.api_key_at_rest import assert_key_at_rest


@pytest.fixture
def stub_http(monkeypatch):
    """把 ``httpx.AsyncClient`` 换成走 MockTransport 的工厂，并记录每次请求。"""
    real_client = httpx.AsyncClient

    def install(handler):
        calls: list[httpx.Request] = []

        def factory(*_args, **_kwargs):
            def record(request: httpx.Request) -> httpx.Response:
                calls.append(request)
                return handler(request)

            return real_client(transport=httpx.MockTransport(record))

        monkeypatch.setattr(deepseek_module.httpx, "AsyncClient", factory)
        # 重试等待注入成 0：用例不该由墙钟决定成败。
        monkeypatch.setattr(deepseek_module, "_RETRY_DELAY_SECONDS", 0)
        return calls

    return install


def _search_body() -> dict:
    return {
        "results": [
            {
                "title": "后端工程师招聘",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "负责服务端开发",
                "summary": "更长的摘要",
                "content": "岗位职责正文" * 10,
                # T13：六个元信息字段（真实响应里 authority / rerank_score 是数字）。
                "authority": 0.92,
                "rerank_score": 0.7345,
                "site_name": "示例招聘",
                "site_icon": "https://careers.example.com/favicon.ico",
                "date": "2026-11-01",
            },
            {
                "title": "非 http 链接不能进结果",
                "url": "file:///etc/passwd",
                "snippet": "unsafe",
            },
        ]
    }


#: T13 起每条结果都带这六个字段（值可以是空串，但**键必须存在**）。
_META_FIELDS = ("summary", "authority", "rerank_score", "site_name", "site_icon", "date")


@pytest.mark.asyncio
async def test_search_maps_fields_and_drops_unsafe_urls(stub_http):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v1/tools/search")
        assert request.headers["authorization"] == "Bearer sk-test"
        return httpx.Response(200, json=_search_body())

    calls = stub_http(handler)
    results = await search_deepseek("后端 招聘", count=5, api_key="sk-test")

    assert len(calls) == 1
    assert len(results) == 1
    item = results[0]
    assert item["title"] == "后端工程师招聘"
    assert item["url"] == "https://careers.example.com/jobs/1"
    assert item["snippet"] == "负责服务端开发"
    # 六个元信息字段全部保留；数字用 str 承载（下游按 str 消费）。
    assert item["summary"] == "更长的摘要"
    assert item["authority"] == "0.92"
    assert item["rerank_score"] == "0.7345"
    assert item["site_name"] == "示例招聘"
    assert item["site_icon"] == "https://careers.example.com/favicon.ico"
    assert item["date"] == "2026-11-01"
    # 只有 need_content 才把正文带回来，否则会平白挤占提示词预算。
    assert "text" not in item
    # 契约是 ``dict[str, str]``：没有 None。
    assert all(isinstance(value, str) for value in item.values())


@pytest.mark.asyncio
async def test_search_missing_meta_fields_are_empty_strings_not_missing_keys(stub_http):
    """缺字段时给空串而不是"没这个键"：下游 `item.get(k)` 与 `join` 都按 str 假设。"""
    body = {
        "results": [
            {"title": "只有标题和链接", "url": "https://careers.example.com/jobs/9"},
        ]
    }
    stub_http(lambda _request: httpx.Response(200, json=body))
    results = await search_deepseek("后端 招聘", api_key="sk-test")

    item = results[0]
    for field in _META_FIELDS:
        assert field in item, f"{field} 必须存在（值可以是空串）"
        assert item[field] == ""
    # snippet 缺省时退回 summary，但 summary 字段本身也还在（两者不混用）。
    assert item["snippet"] == ""


@pytest.mark.asyncio
async def test_search_drops_non_http_site_icon(stub_http):
    """``site_icon`` 会进 <img src>：非 http(s) 或带凭据的一律丢成空串。"""
    body = {
        "results": [
            {
                "title": "图标不合法",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "x",
                "site_icon": "javascript:alert(1)",
            },
            {
                "title": "图标带凭据",
                "url": "https://careers.example.com/jobs/2",
                "snippet": "y",
                "site_icon": "https://user:pass@example.com/i.png",
            },
            {
                "title": "图标是 data URL",
                "url": "https://careers.example.com/jobs/3",
                "snippet": "z",
                "site_icon": "data:image/png;base64,AAAA",
            },
        ]
    }
    stub_http(lambda _request: httpx.Response(200, json=body))
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert [item["site_icon"] for item in results] == ["", "", ""]
    # 丢掉图标不影响这条结果本身。
    assert len(results) == 3


@pytest.mark.asyncio
async def test_search_snippet_falls_back_to_summary_but_summary_stays(stub_http):
    body = {
        "results": [
            {
                "title": "只有摘要",
                "url": "https://careers.example.com/jobs/1",
                "summary": "这是 600 字的概述",
            }
        ]
    }
    stub_http(lambda _request: httpx.Response(200, json=body))
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert results[0]["snippet"] == "这是 600 字的概述"
    assert results[0]["summary"] == "这是 600 字的概述"


@pytest.mark.asyncio
async def test_search_returns_content_when_asked(stub_http):
    stub_http(lambda _request: httpx.Response(200, json=_search_body()))
    results = await search_deepseek("后端 招聘", need_content=True, api_key="sk-test")
    assert results[0]["text"].startswith("岗位职责正文")


@pytest.mark.asyncio
async def test_search_content_limit_is_extraction_scale_not_summary_scale(stub_http):
    """Q06：正文上限从 2000 提到 20000（抽取预算是 48000 字，2000 连一段 JD 都不够）。"""
    long_content = "岗" * 5_000
    body = {
        "results": [
            {
                "title": "正文很长",
                "url": "https://careers.example.com/jobs/1",
                "snippet": "x",
                "content": long_content,
            }
        ]
    }
    stub_http(lambda _request: httpx.Response(200, json=body))
    results = await search_deepseek("后端 招聘", need_content=True, api_key="sk-test")
    # 5000 字的正文被完整保留（2000 时代这里会腰斩）。
    assert len(results[0]["text"]) == 5_000

    huge = "岗" * 30_000
    body["results"][0]["content"] = huge
    stub_http(lambda _request: httpx.Response(200, json=body))
    results = await search_deepseek("后端 招聘", need_content=True, api_key="sk-test")
    # 上限仍然存在：单条不超过 20000 字，别让一条结果吃掉整个提示词预算。
    assert len(results[0]["text"]) == deepseek_module._MAX_TEXT_CHARS
    assert deepseek_module._MAX_TEXT_CHARS == 20_000


@pytest.mark.asyncio
async def test_search_without_key_never_calls_network(stub_http):
    calls = stub_http(lambda _request: httpx.Response(200, json=_search_body()))
    results = await search_deepseek("后端 招聘", api_key="")
    assert calls == []
    assert isinstance(results, DeepSeekResults)
    assert results.failure == "missing_key"


@pytest.mark.asyncio
async def test_search_401_is_reported_not_raised(stub_http):
    stub_http(lambda _request: httpx.Response(401, json={"error": "invalid key"}))
    results = await search_deepseek("后端 招聘", api_key="bad")
    assert results == []
    assert results.failure == "unauthorized"


@pytest.mark.asyncio
async def test_search_402_is_reported_as_balance(stub_http):
    stub_http(lambda _request: httpx.Response(402, json={"error": "insufficient balance"}))
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert results.failure == "insufficient_balance"


@pytest.mark.asyncio
async def test_search_retries_once_on_429_and_5xx(stub_http):
    calls = stub_http(lambda _request: httpx.Response(429))
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert len(calls) == 2  # 第一次 + 重试一次，不无限重试
    assert results.failure == "rate_limited"

    calls = stub_http(lambda _request: httpx.Response(500))
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert len(calls) == 2  # 5xx 与 429 同一口径：各重试一次
    assert results.failure == "http_500"


@pytest.mark.asyncio
async def test_search_does_not_retry_other_4xx(stub_http):
    calls = stub_http(lambda _request: httpx.Response(400, json={"error": "bad query"}))
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert len(calls) == 1
    assert results.failure == "http_400"


@pytest.mark.asyncio
async def test_search_retries_network_error_then_gives_up(stub_http):
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    calls = stub_http(boom)
    results = await search_deepseek("后端 招聘", api_key="sk-test")
    assert len(calls) == 2
    assert results.failure == "network"


def test_search_operators_are_detected():
    assert has_search_operators("site:zhipin.com 后端")
    assert has_search_operators("后端 -site:lagou.com")
    assert has_search_operators("lang:zh 后端 招聘")
    assert has_search_operators("after:2025-01-01 后端")
    assert has_search_operators("before:2026-01-01 后端")
    assert has_search_operators('"精确短语" 招聘')
    assert not has_search_operators("帮我把后端项目整理成台账")
    assert not has_search_operators("后端 招聘")


@pytest.mark.asyncio
async def test_fetch_returns_markdown_content(stub_http):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v1/tools/fetch")
        return httpx.Response(200, json={"title": "岗位页", "content": "# 正文\n职责……"})

    stub_http(handler)
    text = await fetch_deepseek_text("https://careers.example.com/jobs/1", "sk-test")
    assert text.startswith("# 正文")


@pytest.mark.asyncio
async def test_fetch_single_page_failure_returns_empty(stub_http):
    calls = stub_http(lambda _request: httpx.Response(404))
    text = await fetch_deepseek_text("https://careers.example.com/jobs/1", "sk-test")
    assert text == ""
    assert len(calls) == 1  # 404 不重试


@pytest.mark.asyncio
async def test_fetch_account_failure_raises_for_whole_batch(stub_http):
    stub_http(lambda _request: httpx.Response(402))
    with pytest.raises(DeepSeekUnavailable):
        await fetch_deepseek_text("https://careers.example.com/jobs/1", "sk-test")


@pytest.mark.asyncio
async def test_fetch_rejects_non_http_or_credentialed_urls_without_request(stub_http):
    calls = stub_http(lambda _request: httpx.Response(200, json={"content": "x"}))
    for url in ("file:///etc/passwd", "https://user:pass@example.com/a", "ftp://example.com/a"):
        assert await fetch_deepseek_text(url, "sk-test") == ""
    assert calls == []


# ===== 同步 Fetch（``services/web_fetch`` 的兜底档用它） =====
#
# 同步版不能靠 ``asyncio.run`` 包异步版：抓取编排可能跑在已经有事件循环的 async 路由里
# （``preview_from_url``）。这里钉住它的错误语义与异步版逐条一致。


def _sync_transport(handler):
    calls: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    return httpx.MockTransport(record), calls


@pytest.fixture
def no_retry_delay(monkeypatch):
    """把重试等待注入成 0：用例不该由墙钟决定成败。"""
    monkeypatch.setattr(deepseek_module, "_RETRY_DELAY_SECONDS", 0)


def test_sync_fetch_returns_markdown_content(no_retry_delay):
    transport, calls = _sync_transport(
        lambda _request: httpx.Response(200, json={"title": "岗位页", "content": "# 正文\n职责……"})
    )
    text = fetch_deepseek_text_sync("https://careers.example.com/jobs/1", "sk-test", transport=transport)
    assert text.startswith("# 正文")
    assert len(calls) == 1


def test_sync_fetch_without_key_or_with_bad_url_never_calls_network(no_retry_delay):
    transport, calls = _sync_transport(lambda _request: httpx.Response(200, json={"content": "x"}))
    with pytest.raises(DeepSeekUnavailable):
        fetch_deepseek_text_sync("https://careers.example.com/jobs/1", "", transport=transport)
    for url in ("file:///etc/passwd", "https://user:pass@example.com/a"):
        assert fetch_deepseek_text_sync(url, "sk-test", transport=transport) == ""
    assert calls == []


def test_sync_fetch_single_page_failure_returns_empty(no_retry_delay):
    transport, calls = _sync_transport(lambda _request: httpx.Response(404))
    assert fetch_deepseek_text_sync("https://careers.example.com/jobs/1", "sk-test", transport=transport) == ""
    assert len(calls) == 1  # 404 不重试


def test_sync_fetch_account_failure_raises_for_whole_task(no_retry_delay):
    for status in (401, 402, 429):
        transport, _calls = _sync_transport(lambda _request, code=status: httpx.Response(code))
        with pytest.raises(DeepSeekUnavailable):
            fetch_deepseek_text_sync("https://careers.example.com/jobs/1", "sk-test", transport=transport)


def test_sync_fetch_retries_once_on_5xx(no_retry_delay):
    transport, calls = _sync_transport(lambda _request: httpx.Response(500))
    assert fetch_deepseek_text_sync("https://careers.example.com/jobs/1", "sk-test", transport=transport) == ""
    assert len(calls) == 2  # 第一次 + 重试一次，与异步版同口径


# ===== 搜索密钥的存取（掩码回显 / 落盘形态随平台） =====


def test_search_key_is_stored_encrypted_and_echoed_as_mask(db_session):
    from app.models.setting import AppSetting
    from app.services import global_settings
    from app.services.llm_key_refs import API_KEY_MASK
    from app.services.settings_service import (
        get_search_config,
        get_search_config_with_secrets,
        save_search_config,
    )
    from app.services.web_search_settings import WEB_SEARCH_BLOCK

    saved = save_search_config(
        db_session, SearchConfig(sources=["bing", "deepseek"], deepseek_api_key="sk-secret")
    )
    # 跨平台恒真：回包只给掩码，读回明文对得上。
    assert saved.deepseek_api_key == API_KEY_MASK
    assert get_search_config(db_session).deepseek_api_key == API_KEY_MASK
    assert get_search_config_with_secrets(db_session).deepseek_api_key == "sk-secret"

    # 唯一真相是全局 web_search；落盘形态随平台（Windows = DPAPI 密文，其它平台 = 明文）。
    block = (global_settings.load_state() or {})[WEB_SEARCH_BLOCK]
    assert block["sources"] == ["bing", "deepseek"]
    assert_key_at_rest(
        block["deepseek_api_key"],
        secret="sk-secret",
        raw=global_settings.path().read_text(encoding="utf-8"),
    )
    # 旧 AppSetting 行不再写入：升级后全局是唯一真相。
    assert db_session.get(AppSetting, "search_config") is None
    assert db_session.get(AppSetting, "search_deepseek_api_key") is None


def test_resaving_the_mask_keeps_the_key_and_empty_value_clears_it(db_session):
    from app.services.llm_key_refs import API_KEY_MASK
    from app.services.settings_service import (
        get_search_config_with_secrets,
        save_search_config,
    )

    save_search_config(db_session, SearchConfig(sources=["deepseek"], deepseek_api_key="sk-secret"))
    # 前端回显的就是掩码，原样回传不能把密钥清掉。
    save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key=API_KEY_MASK)
    )
    assert get_search_config_with_secrets(db_session).deepseek_api_key == "sk-secret"

    # 显式清空 = 移除密钥。
    cleared = save_search_config(
        db_session, SearchConfig(sources=["deepseek"], deepseek_api_key="")
    )
    assert cleared.deepseek_api_key == ""
    assert get_search_config_with_secrets(db_session).deepseek_api_key == ""

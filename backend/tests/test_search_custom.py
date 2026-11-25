# SPDX-License-Identifier: Apache-2.0
"""CR-09：自定义搜索来源（协议模板 + 通用字段映射）。

口径（任务书 + §9）：

- 两套模板：``moonshot``（``/v1/tools/search`` + ``/v1/tools/fetch``）与 ``generic``
  （用户填端点与字段映射）；映射语法只支持点号与 ``[n]``；
- 端点必须是**相对路径**，base_url 只允许 http/https 且拒绝内网 IP 字面量（SSRF）；
- 默认 ``include_content=true``；v1 只有一套自定义源；
- 缓存键要带 base_url 指纹：换了端点不能命中上一套的结果；
- ``custom_api_key`` 与其它密钥同口径（只回掩码、加密落盘）；备份里它按
  ``include_api_keys`` 剥离，而模板与端点属非密钥、无条件带走（见文件末尾两条
  ``backup`` 用例——此前这两条不存在，"不进备份明文"只是没被测到的说法）。
- 失败要能分类：401 → unauthorized、超时 → network、坏 JSON → bad_json。
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from app.schemas.setting import SearchConfig
from pydantic import ValidationError


def _custom_config(**overrides) -> SearchConfig:
    base = {
        "sources": ["custom"],
        "custom_template": "generic",
        "custom_base_url": "https://search.example.com",
        "custom_search_path": "/search",
        "custom_results_field": "data.items",
        "custom_api_key": "sk-custom-0123456789",
    }
    base.update(overrides)
    return SearchConfig(**base)


def _run_search(config: SearchConfig, handler):
    from app.services.search.custom import resolve_custom_source, search_custom

    source = resolve_custom_source(config)
    assert source is not None

    async def _run():
        return await search_custom(
            "后端 招聘",
            source,
            count=3,
            need_content=True,
            transport=httpx.MockTransport(handler),
        )

    return asyncio.run(_run())


# ===== 模板与字段映射 =====


def test_moonshot_template_fills_the_paths_and_field():
    config = SearchConfig(sources=["custom"], custom_base_url="https://api.moonshot.cn")

    from app.services.search.custom import resolve_custom_source

    source = resolve_custom_source(config)

    assert source is not None
    assert source.search_path == "/v1/tools/search"
    assert source.fetch_path == "/v1/tools/fetch"
    assert source.results_field == "search_result"
    assert source.include_content is True


def test_generic_mapping_supports_dotted_paths_and_indexes():
    from app.services.search.custom import resolve_field

    payload = {"data": {"items": [{"url": "https://a.example", "title": "A"}]}}

    assert resolve_field(payload, "data.items[0].url") == "https://a.example"
    assert resolve_field(payload, "search_result") is None


def test_field_mapping_syntax_is_closed():
    """只支持 ``a.b`` / ``a[0].b``；其它写法在保存时就拒绝，而不是运行时静默取空。"""
    for bad in ("data.items[*]", "data..items", "data items", "data[0", "$.data"):
        with pytest.raises(ValidationError):
            _custom_config(custom_results_field=bad)


def test_endpoint_must_be_a_relative_path():
    for bad in ("https://evil.example/x", "//evil.example/x", "search", "/a/../b"):
        with pytest.raises(ValidationError):
            _custom_config(custom_search_path=bad)


def test_base_url_rejects_private_ip_literals():
    for bad in (
        "http://192.168.1.9:8080",
        "http://10.0.0.5",
        "http://169.254.169.254",
        "http://100.64.0.9",
        "https://search.example.com/api?token=1",
        "https://user:pass@search.example.com",
        "ftp://search.example.com",
    ):
        with pytest.raises(ValidationError):
            _custom_config(custom_base_url=bad)

    # 本机服务是合法用法（本地网关 / 自建 SearXNG 一类），只放行回环。
    for allowed in ("http://127.0.0.1:8080", "http://localhost:8080/", "http://[::1]:9000"):
        assert _custom_config(custom_base_url=allowed).custom_base_url


# ===== 请求与响应 =====


def test_search_posts_to_the_configured_endpoint_and_maps_results():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = request.read().decode("utf-8")
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "url": "https://a.example/job",
                            "title": "后端工程师",
                            "snippet": "岗位描述",
                            "content": "整页正文",
                        },
                        {"url": "", "title": "缺 URL 的条目应被丢弃"},
                    ]
                }
            },
        )

    results = _run_search(_custom_config(), handler)

    assert seen["url"] == "https://search.example.com/search"
    body = json.loads(str(seen["body"]))
    assert body["query"] == "后端 招聘"
    assert body["count"] == 3
    assert body["need_content"] is True
    assert seen["auth"] == "Bearer sk-custom-0123456789"
    assert len(results) == 1
    assert results[0]["title"] == "后端工程师"
    assert results[0]["text"] == "整页正文"


def test_missing_key_still_calls_keyless_gateways():
    """generic 模板允许无 Key 的自建端点；没有 Key 时不该被当成配置错误。"""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        return httpx.Response(200, json={"data": {"items": []}})

    _run_search(_custom_config(custom_api_key=""), handler)

    assert seen["auth"] == ""


def test_failures_are_classified():
    assert _run_search(_custom_config(), lambda request: httpx.Response(401)).failure == (
        "unauthorized"
    )
    assert _run_search(_custom_config(), lambda request: httpx.Response(429)).failure == (
        "rate_limited"
    )
    assert (
        _run_search(
            _custom_config(), lambda request: httpx.Response(200, content=b"<html>login</html>")
        ).failure
        == "bad_json"
    )

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("boom", request=request)

    assert _run_search(_custom_config(), timeout).failure == "network"


def test_redirects_are_not_followed():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://evil.example/"})

    results = _run_search(_custom_config(), handler)

    assert calls == ["https://search.example.com/search"]
    assert results.failure == "network"


# ===== 配置层 =====


def test_custom_source_requires_a_base_url():
    config = SearchConfig(sources=["bing", "custom"], custom_base_url="")

    assert "custom" not in config.configured_sources()


def test_custom_key_is_masked_and_encrypted_at_rest(db_session):
    from app.services import global_settings
    from app.services.web_search_settings import get_search_config, save_search_config

    save_search_config(db_session, _custom_config())

    shown = get_search_config(db_session)
    assert shown.custom_api_key == "********"
    block = global_settings.load_state()["web_search"]
    assert block["custom_api_key"] != "sk-custom-0123456789"


def test_changing_base_url_busts_the_cache_key():
    from app.services.search.cache import cache_key

    assert cache_key("q", ["custom"], "standard", 8, fingerprint="https://a.example.com") != (
        cache_key("q", ["custom"], "standard", 8, fingerprint="https://b.example.com")
    )


# ===== 与聚合层 / 正文补全的接线 =====


def test_aggregate_runs_the_custom_source(monkeypatch):
    from app.services.search import aggregate
    from app.services.search.cache import reset_search_cache
    from app.services.search.custom import CustomResults

    reset_search_cache()

    async def fake_custom(query, config, *, count, need_content):
        return CustomResults(
            [{"title": "后端工程师招聘", "url": "https://a.example/job", "snippet": "后端"}]
        )

    def fake_plan(query, config, limit):
        return fake_custom(query, config, count=limit, need_content=False)

    monkeypatch.setattr(aggregate, "custom_plan", fake_plan)
    config = _custom_config(sources=["custom"], depth="snippet")

    outcome = asyncio.run(aggregate.aggregate_search("后端工程师", config, limit=3))

    assert [item["url"] for item in outcome] == ["https://a.example/job"]
    assert outcome.source_status[0]["source"] == "custom"
    assert outcome.source_status[0]["ok"] is True


def test_enrich_tries_the_custom_fetcher_before_deepseek():
    from app.services.search.enrich import enrich_with_page_text

    calls: list[str] = []

    async def custom_fetch(url: str) -> str:
        calls.append(f"custom:{url}")
        return "用户自己端点抓到的正文"

    async def deepseek_fetch(url: str, api_key: str) -> str:
        calls.append(f"deepseek:{url}")
        return "不该被调用"

    results = [{"title": "t", "url": "https://a.example/job"}]
    asyncio.run(
        enrich_with_page_text(
            results,
            "后端",
            pages=1,
            max_passages=1,
            total_chars=400,
            api_key="sk-x",
            custom_fetcher=custom_fetch,
            deepseek_fetcher=deepseek_fetch,
        )
    )

    # 顺序是任务书 CR-09 第 3 条：响应内正文 → 自定义 fetch → DeepSeek fetch → 本机。
    assert calls == ["custom:https://a.example/job"]


# ===== 备份（CR-09 改法第 5 条：custom_api_key 进剥离白名单；端点跟着走）=====


def test_custom_key_and_endpoints_travel_with_the_backup(db_session):
    """include_api_keys=True：自定义源的模板/端点/字段映射原样回来。"""
    from app.services.data_backup.global_services import (
        SECTION_WEB_SEARCH,
        build_global_services_payload,
    )
    from app.services.web_search_settings import save_search_config

    save_search_config(db_session, _custom_config(custom_api_key="sk-custom-backup-123456"))

    payload = build_global_services_payload(include_api_keys=True)
    block = payload["services"][SECTION_WEB_SEARCH]

    assert block["custom_template"] == "generic"
    assert block["custom_base_url"] == "https://search.example.com"
    assert block["custom_search_path"] == "/search"
    assert block["custom_results_field"] == "data.items"
    assert block["custom_include_content"] is True
    assert str(block["custom_api_key"])


def test_custom_key_is_stripped_when_api_keys_are_not_exported(db_session):
    """include_api_keys=False：Key 写空串，端点仍在（结构保留、密钥不带走）。"""
    from app.services.data_backup.global_services import (
        SECTION_WEB_SEARCH,
        build_global_services_payload,
    )
    from app.services.web_search_settings import save_search_config

    save_search_config(db_session, _custom_config(custom_api_key="sk-custom-backup-123456"))

    payload = build_global_services_payload(include_api_keys=False)
    block = payload["services"][SECTION_WEB_SEARCH]

    assert block["custom_api_key"] == ""
    assert block["custom_base_url"] == "https://search.example.com"
    assert "sk-custom-backup-123456" not in json.dumps(payload, ensure_ascii=False)

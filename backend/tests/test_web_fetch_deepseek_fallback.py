# SPDX-License-Identifier: Apache-2.0
"""T06：DeepSeek Fetch 作为 ``web_fetch`` 的第四档兜底（Q09）。

全部离线：httpx MockTransport + 注入浏览器/兜底抓取器，不访问外网、不启动浏览器。
钉住的是四件事：

1. 本地两档都失败时由兜底档抓回，且 `FetchedPage.engine` 如实写 ``deepseek``；
2. 没有密钥时**一次都不发**，失败原因仍然逐档可解释（HTTP 状态 + 浏览器原因）；
3. 账号级不可用（401/402/429）在本次任务内整段停用，不逐条重试；
4. `engine` 的**可选值不变**（auto / http / browser）——兜底档不是一种"选择"，
   显式选 http 时也不会偷偷换成第三方。

## 人工回归脚本（本文件覆盖不到的部分）

本文件是**注入式**的：浏览器档与兜底档都是假的，所以它能证明编排正确，但证明不了
"真网络上确实接管了"。端到端要按下面三步手跑（2026-11-15 实测通过，约 1 分钟）：

1. 起后端与前端，岗位广场 →「从链接导入」→ 贴 `https://httpbin.org/delay/6`（这个
   地址会让 http 档在 5 秒预算上必超时）；
2. 抓取并预览 → 约 19 秒后预览那一行应写 `browser引擎 · 规则抽取`（http 档失败、
   浏览器档接管）；
3. 设置 →「外部连接 → 浏览器调试端口」临时改成 `65000`（无人监听，浏览器进程起来
   即退出）→ 重抓同一条链接 → 那行应变成 **`deepseek引擎`** 且耗时约 11 秒；点
   「恢复默认」后再抓又变回 `browser引擎`。

**边界**：兜底只在"浏览器档起不来"时有意义。浏览器能渲染时它拿到的正文 ⊇ 服务端
能拿到的（实测服务端抓知乎 0 字、51job 576 字），所以它不是反爬的解药。
"""

from __future__ import annotations

import httpx
import pytest
from app.services.web_fetch import deepseek_fallback
from app.services.web_fetch import fetcher as fetcher_module
from app.services.web_fetch.deepseek_fallback import FallbackUnavailable
from app.services.web_fetch.errors import WebFetchError
from app.services.web_fetch.fetcher import DEEPSEEK_ENGINE, ENGINES, FetchConfig, JobFetcher

URL_ONE = "https://jobs.example.com/position/1"
URL_TWO = "https://jobs.example.com/position/2"
LIST_URL = "https://jobs.example.com/campus"
PAGE2_URL = "https://jobs.example.com/campus?page=2"
PUBLIC_IP = "93.184.216.34"

LIST_HTML = (
    "<html><body><div class='job-list'>"
    "<div class='job-card'><a class='job-name' href='/position/1'>岗位 1</a>"
    "<span class='salary'>20-30K</span><span class='location'>北京</span></div>"
    "</div><a rel='next' href='/campus?page=2'>下一页</a></body></html>"
)


def _resolver(_host: str, _port: int) -> list[str]:
    return [PUBLIC_IP]


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _always_html(body: str, status: int = 200):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=body, headers={"content-type": "text/html"})

    return handler


def _failing_browser(*_args, **_kwargs):
    """默认的浏览器档：本地第二档也失败（不启动真浏览器）。"""
    raise WebFetchError("浏览器打开页面超时，页面可能太慢或要求登录")


def _fetcher(*, handler, browser=None, deepseek=None, key=None, engine: str = "auto") -> JobFetcher:
    return JobFetcher(
        None,
        http_transport=_transport(handler),
        browser_fetcher=browser or _failing_browser,
        resolver=_resolver,
        config=FetchConfig(engine=engine, min_interval=0),
        deepseek_fetcher=deepseek,
        deepseek_key=key if key is not None else (lambda: ""),
    )


def test_fallback_fetches_when_both_local_engines_fail():
    calls: list[tuple[str, str]] = []

    def deepseek(url: str, api_key: str) -> str:
        calls.append((url, api_key))
        return "# 后端工程师\n公司名称：示例科技\n岗位职责：负责服务端开发"

    fetcher = _fetcher(
        handler=_always_html("forbidden", status=403),
        deepseek=deepseek,
        key=lambda: "sk-test",
    )
    page = fetcher.fetch(URL_ONE)

    # engine 如实体现这一页是谁抓的；正文是 Markdown，没有 HTML 可解析。
    assert page.engine == DEEPSEEK_ENGINE == "deepseek"
    assert page.content_type == "text/markdown"
    assert page.html == ""
    assert page.json_payloads == []
    assert "公司名称：示例科技" in page.text
    assert calls == [(URL_ONE, "sk-test")]


def test_fallback_fills_in_when_local_page_has_no_readable_text():
    """本地拿到 200 但是空壳（无 SPA 标记、正文为空）：仍该由兜底档补正文。"""
    calls: list[str] = []

    def deepseek(url: str, _api_key: str) -> str:
        calls.append(url)
        return "# 岗位详情\n工作地点：上海"

    fetcher = _fetcher(
        handler=_always_html("<html><body><canvas id='app'></canvas></body></html>"),
        deepseek=deepseek,
        key=lambda: "sk-test",
    )
    page = fetcher.fetch(URL_ONE)
    assert page.engine == "deepseek"
    assert "工作地点：上海" in page.text
    assert calls == [URL_ONE]


def test_without_key_the_failure_still_explains_every_tier():
    calls: list[str] = []

    def deepseek(url: str, _api_key: str) -> str:  # pragma: no cover - 不该被调用
        calls.append(url)
        return "x"

    fetcher = _fetcher(handler=_always_html("forbidden", status=403), deepseek=deepseek)
    with pytest.raises(WebFetchError) as excinfo:
        fetcher.fetch(URL_ONE)

    message = str(excinfo.value)
    # 没配置密钥 = 这一档缺席，但另外两档的原因必须留下。
    assert calls == []
    assert "HTTP 403" in message
    assert "浏览器" in message


def test_local_success_never_calls_the_fallback():
    calls: list[str] = []

    def deepseek(url: str, _api_key: str) -> str:  # pragma: no cover - 不该被调用
        calls.append(url)
        return "x"

    fetcher = _fetcher(
        handler=_always_html("<html><body><main>" + "岗位职责说明" * 200 + "</main></body></html>"),
        deepseek=deepseek,
        key=lambda: "sk-test",
    )
    page = fetcher.fetch(URL_ONE)
    assert page.engine == "http"
    assert calls == []


def test_account_level_unavailable_disables_the_tier_for_the_whole_task():
    """401/402/429 是账号级不可用：本次任务剩下的页面不要再逐条重试。"""
    calls: list[str] = []

    def deepseek(url: str, _api_key: str) -> str:
        calls.append(url)
        raise FallbackUnavailable("insufficient_balance")

    fetcher = _fetcher(
        handler=_always_html("forbidden", status=403),
        deepseek=deepseek,
        key=lambda: "sk-test",
    )
    with pytest.raises(WebFetchError):
        fetcher.fetch(URL_ONE)
    with pytest.raises(WebFetchError):
        fetcher.fetch(URL_TWO)
    assert calls == [URL_ONE]  # 第二条不再打服务端


def test_explicit_http_engine_never_uses_the_fallback():
    calls: list[str] = []

    def deepseek(url: str, _api_key: str) -> str:  # pragma: no cover - 不该被调用
        calls.append(url)
        return "x"

    fetcher = _fetcher(
        handler=_always_html("forbidden", status=403),
        deepseek=deepseek,
        key=lambda: "sk-test",
        engine="http",
    )
    with pytest.raises(WebFetchError):
        fetcher.fetch(URL_ONE)
    assert calls == []


def test_deepseek_is_not_a_selectable_engine():
    """兜底档不是一种"选择"：可选引擎仍然只有三档。"""
    assert ENGINES == ("auto", "http", "browser")
    fetcher = _fetcher(handler=_always_html("<html></html>"))
    with pytest.raises(WebFetchError) as excinfo:
        fetcher.fetch(URL_ONE, engine="deepseek")
    assert "自动、http 或浏览器" in str(excinfo.value)


def test_second_page_failure_keeps_an_explainable_stop_reason():
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == LIST_URL:
            return httpx.Response(200, text=LIST_HTML, headers={"content-type": "text/html"})
        return httpx.Response(403, text="forbidden", headers={"content-type": "text/html"})

    fetcher = _fetcher(handler=handler)
    batch = fetcher.fetch_pages(LIST_URL, pages=2)

    assert batch.pages_fetched == 1
    assert batch.stop_reason == "http_error"
    assert batch.truncated is True
    joined = " ".join(batch.errors)
    assert "第 2 页" in joined
    assert "HTTP 403" in joined
    assert "浏览器" in joined


def test_default_key_source_is_the_global_search_config():
    """默认密钥来源是全局联网搜索配置；没有 db（离线场景）时按"没配置"处理。"""
    assert deepseek_fallback.resolve_key(None) == ""
    assert fetcher_module.ENGINES is ENGINES

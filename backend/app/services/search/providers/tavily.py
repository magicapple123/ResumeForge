# SPDX-License-Identifier: Apache-2.0
"""Tavily 搜索来源（P4-09）。

## 为什么接它

Bing RSS 没有 SLA（微软已于 2025-08-11 退役 Bing Search API），DuckDuckGo 的 HTML
端点对中文长句的理解有限。Tavily 是专为"给模型用的搜索"设计的：一次调用就能带回
``content``（摘要）与 ``raw_content``（整页正文），省掉一轮"再逐条抓页面"的往返。
免费额度 1000 credits/月，``basic`` 每次 1 credit。

## 字段映射（**两条路必须过同一套选段**）

``content`` → ``snippet``；``raw_content`` → ``text``。正文**不在这里截断**：聚合层会
把 ``text`` 交给 ``services/search/passages.select_context`` 选段，与本地抓取的正文
走同一条路——否则"Tavily 给的是整页、本地给的是选段"，模型读到的上下文质量会分成两种。

## 失败语义

永不抛异常，返回 :class:`TavilyResults`（``list`` 子类）并把原因写进 ``.failure``：

- ``missing_key`` / ``empty_query`` → 配置问题（``config``），不发出请求；
- ``401`` / ``403`` → ``unauthorized``（``config``）：Key 错了，让用户去设置页改；
- ``429`` / ``5xx`` → ``rate_limited``（``rate``）：告诉用户稍后重试；
- 非 JSON / 结构不对 → ``bad_json`` / ``bad_format``（``parse``）；
- 连不上 / 超时 → ``network``。

不在这里自动重试：一次搜索有 7 秒总预算（见 ``aggregate``），在单来源上重试只会挤掉
其它来源的预算；``rate`` 这个分类本身就是"稍后重试"的提示。
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..dates import parse_published_at

logger = logging.getLogger(__name__)

TAVILY_ENDPOINT = "https://api.tavily.com/search"
#: Tavily 单次最多返回 20 条（文档口径）。
MAX_RESULTS_LIMIT = 20
_MAX_QUERY_CHARS = 400
_MAX_SNIPPET_CHARS = 1_000
_MAX_TITLE_CHARS = 300
_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)
#: 「标准」档用 basic（1 credit），「深入」档用 advanced（2 credits）。
_DEPTH_TO_TAVILY = {"snippet": "basic", "standard": "basic", "deep": "advanced"}


class TavilyResults(list):
    """``list[dict[str, str]]`` 的子类，额外携带失败原因（``None`` = 正常）。"""

    def __init__(
        self, items: list[dict[str, str]] | None = None, *, failure: str | None = None
    ) -> None:
        super().__init__(items or [])
        self.failure = failure


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _safe_url(value: Any) -> str:
    """只放行带主机名的 http/https 地址（不给模型塞 `file:` / `javascript:`）。"""
    url = str(value or "").strip()
    if not url or len(url) > 8192:
        return ""
    try:
        parsed = httpx.URL(url)
    except (TypeError, ValueError):
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.host:
        return ""
    return url


def _normalize(item: Any) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    url = _safe_url(item.get("url"))
    title = _clean(item.get("title"), _MAX_TITLE_CHARS)
    if not url or not title:
        return None
    result = {
        "title": title,
        "url": url,
        # `content` 是 Tavily 给的与查询相关的片段，比我们自己的摘要质量更高。
        "snippet": _clean(item.get("content"), _MAX_SNIPPET_CHARS),
    }
    published = parse_published_at(str(item.get("published_date") or ""))
    if published:
        result["published_at"] = published
    raw = str(item.get("raw_content") or "").strip()
    if raw:
        # 不截断：选段（P4-07）按字符预算决定留哪几段，截断会把答案切掉。
        result["text"] = raw
    return result


def _failure_for_status(status: int) -> str:
    if status in {401, 403}:
        return "unauthorized"
    if status == 429 or status >= 500:
        return "rate_limited"
    return f"http_{status}"


async def search_tavily(
    query: str,
    *,
    api_key: str = "",
    max_results: int = 10,
    depth: str = "standard",
    include_raw_content: bool = True,
    transport: httpx.AsyncBaseTransport | None = None,
) -> TavilyResults:
    """调一次 ``POST /search``；失败返回空列表，原因写在 ``.failure``。"""
    normalized = " ".join(str(query or "").split())[:_MAX_QUERY_CHARS]
    if not normalized:
        return TavilyResults(failure="empty_query")
    if not api_key:
        # 没有 Key 时不发请求：这不该被记成"这个来源没结果"。
        return TavilyResults(failure="missing_key")

    payload: dict[str, Any] = {
        "query": normalized,
        "max_results": max(1, min(MAX_RESULTS_LIMIT, int(max_results))),
        "search_depth": _DEPTH_TO_TAVILY.get(depth, "basic"),
        "include_raw_content": bool(include_raw_content) and depth != "snippet",
        "include_answer": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT, follow_redirects=False, transport=transport
        ) as client:
            response = await client.post(TAVILY_ENDPOINT, json=payload, headers=headers)
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        logger.warning("Tavily 请求失败：%s", type(exc).__name__)
        return TavilyResults(failure="network")

    if response.status_code != 200:
        failure = _failure_for_status(response.status_code)
        logger.warning("Tavily 搜索失败 status=%s reason=%s", response.status_code, failure)
        return TavilyResults(failure=failure)

    try:
        body = response.json()
    except ValueError:
        logger.warning("Tavily 返回了非 JSON 内容")
        return TavilyResults(failure="bad_json")
    raw_results = body.get("results") if isinstance(body, dict) else None
    if raw_results is None or not isinstance(raw_results, list):
        logger.warning("Tavily 返回结构不符合预期（缺少 results 数组）")
        return TavilyResults(failure="bad_format")
    results = [item for raw in raw_results if (item := _normalize(raw)) is not None]
    logger.info("Tavily 搜索完成 result_count=%s", len(results))
    return TavilyResults(results)


__all__ = ["TAVILY_ENDPOINT", "MAX_RESULTS_LIMIT", "TavilyResults", "search_tavily"]

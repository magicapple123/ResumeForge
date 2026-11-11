# SPDX-License-Identifier: Apache-2.0
"""Jina 搜索来源 + 正文读取兜底（P4-10）。

## 两个端点，两件事

- **搜索**：``GET https://s.jina.ai/<query>``（Bearer ``jina_…``），带
  ``Accept: application/json`` 拿到结构化结果；只取**前 5 条**——Jina 的返回里每条都带
  一大段干净正文，取多了会挤掉其它来源的预算。解析成与其它来源同构的
  ``[{title, url, snippet}]``（``description``→``snippet``，``content``→``text``）。
- **读取兜底**：``GET https://r.jina.ai/<url>``。它**只在本地抽取失败时**触发（JS 重的
  页面本地 ``HTMLParser`` 抽出来是空壳），因此调用点不在这里，而在
  ``services/search/page_reader.py`` 的 ``reader_fallback`` 参数里：本地一次抓取拿到空串
  才交给它，**不重复请求**同一个地址。

## 失败语义

与 Tavily 一致：永不抛异常，返回带 ``.failure`` 的列表；``401`` → 配置问题、
``429``/``5xx`` → 稍后重试、非 JSON → 解析问题。读取兜底则是"任何失败都返回空串"
（兜底失败不该让整次搜索失败）。
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

from ..dates import parse_published_at

logger = logging.getLogger(__name__)

SEARCH_ENDPOINT = "https://s.jina.ai"
READER_ENDPOINT = "https://r.jina.ai"
#: 搜索结果只取前 5 条：Jina 每条都带整页正文，再多会挤掉其它来源。
SEARCH_RESULT_LIMIT = 5
_MAX_QUERY_CHARS = 400
_MAX_TITLE_CHARS = 300
_MAX_SNIPPET_CHARS = 1_000
#: 兜底读取只留这么多字符：选段（P4-07）本来就会再切，留太多只是多占内存。
MAX_READER_CHARS = 40_000
_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)


class JinaResults(list):
    """``list[dict[str, str]]`` 的子类，额外携带失败原因（``None`` = 正常）。"""

    def __init__(
        self, items: list[dict[str, str]] | None = None, *, failure: str | None = None
    ) -> None:
        super().__init__(items or [])
        self.failure = failure


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _safe_url(value: Any) -> str:
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


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "X-Return-Format": "markdown",
    }


def _failure_for_status(status: int) -> str:
    if status in {401, 403}:
        return "unauthorized"
    if status == 429 or status >= 500:
        return "rate_limited"
    return f"http_{status}"


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
        "snippet": _clean(item.get("description") or item.get("content"), _MAX_SNIPPET_CHARS),
    }
    published = parse_published_at(
        str(item.get("publishedTime") or item.get("published_time") or "")
    )
    if published:
        result["published_at"] = published
    content = str(item.get("content") or "").strip()
    if content:
        result["text"] = content
    return result


async def search_jina(
    query: str,
    *,
    api_key: str = "",
    limit: int = SEARCH_RESULT_LIMIT,
    transport: httpx.AsyncBaseTransport | None = None,
) -> JinaResults:
    """调一次 ``GET /<query>``；失败返回空列表，原因写在 ``.failure``。"""
    normalized = " ".join(str(query or "").split())[:_MAX_QUERY_CHARS]
    if not normalized:
        return JinaResults(failure="empty_query")
    if not api_key:
        return JinaResults(failure="missing_key")

    target = f"{SEARCH_ENDPOINT}/{quote(normalized, safe='')}"
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT, follow_redirects=True, transport=transport
        ) as client:
            response = await client.get(target, headers=_headers(api_key))
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        logger.warning("Jina 搜索请求失败：%s", type(exc).__name__)
        return JinaResults(failure="network")

    if response.status_code != 200:
        failure = _failure_for_status(response.status_code)
        logger.warning("Jina 搜索失败 status=%s reason=%s", response.status_code, failure)
        return JinaResults(failure=failure)

    try:
        body = response.json()
    except ValueError:
        logger.warning("Jina 搜索返回了非 JSON 内容")
        return JinaResults(failure="bad_json")
    raw_results = body.get("data") if isinstance(body, dict) else None
    if not isinstance(raw_results, list):
        logger.warning("Jina 搜索返回结构不符合预期（缺少 data 数组）")
        return JinaResults(failure="bad_format")
    results = [item for raw in raw_results if (item := _normalize(raw)) is not None]
    results = results[: max(1, min(SEARCH_RESULT_LIMIT, limit))]
    logger.info("Jina 搜索完成 result_count=%s", len(results))
    return JinaResults(results)


async def read_jina_page(
    url: str,
    *,
    api_key: str = "",
    max_chars: int = MAX_READER_CHARS,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """``GET https://r.jina.ai/<url>`` 取回干净正文；失败一律返回空串。

    **只作为本地抽取失败后的兜底**（见 ``page_reader.fetch_page_text`` 的
    ``reader_fallback``）：本地能抽出正文时根本不会被调用，所以不会重复请求同一地址。
    """
    target_url = _safe_url(url)
    if not target_url or not api_key:
        return ""
    target = f"{READER_ENDPOINT}/{target_url}"
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT, follow_redirects=True, transport=transport
        ) as client:
            response = await client.get(target, headers=_headers(api_key))
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        logger.info("Jina 兜底读取失败：%s", type(exc).__name__)
        return ""
    if response.status_code != 200:
        logger.info("Jina 兜底读取失败 status=%s", response.status_code)
        return ""
    try:
        body = response.json()
    except ValueError:
        # 只带 `Accept: application/json` 时不该发生；发生了就当这次兜底没成功。
        return ""
    data = body.get("data") if isinstance(body, dict) else None
    content = str((data or {}).get("content") or "") if isinstance(data, dict) else ""
    return content.strip()[:max_chars]


__all__ = [
    "JinaResults",
    "MAX_READER_CHARS",
    "READER_ENDPOINT",
    "SEARCH_ENDPOINT",
    "SEARCH_RESULT_LIMIT",
    "read_jina_page",
    "search_jina",
]

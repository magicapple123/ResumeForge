# SPDX-License-Identifier: Apache-2.0
"""DeepSeek 的 Search / Fetch 工具端点（联网搜索的可选第四个来源）。

为什么值得接（见《问题清单》需求 5）：
- 搜索一次就能带回 ``snippet`` / ``summary`` / 正文，省掉「再逐条抓页面」那一轮往返；
- 抓取由**服务端**完成，本地不需要为「不能被打成内网跳板」维护 SSRF 逐跳校验；
- 支持 ``site:`` / ``after:`` 这类操作符，对「只在招聘站里找近期岗位」更精确。

失败语义（这决定聚合层怎么降级，改之前先读）：
- :func:`search_deepseek` **永不抛异常**：返回 :class:`DeepSeekResults`（与
  ``list[dict[str, str]]`` 同构），失败时是空列表并把原因放进 ``.failure``；
- :func:`fetch_deepseek_text` 单条失败返回空串（由聚合层逐条回落本地抓取）；
  但**账号级不可用**（401 / 402 / 429）抛 :class:`DeepSeekUnavailable`——那种情况下
  逐条再试只是浪费三次请求，应当整段回落本地。
- 重试口径：408 / 429 / 5xx 等待后重试**一次**；其它 4xx 不重试。

安全边界：
- 只向 ``api.deepseek.com`` 发请求，URL 由本地先做 scheme/凭据校验后才交给对方；
- 不记录密钥，日志只写状态码与结果条数。
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.deepseek.com/v1/tools"
SEARCH_ENDPOINT = f"{_BASE_URL}/search"
FETCH_ENDPOINT = f"{_BASE_URL}/fetch"

_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
# 重试前的等待：文档口径是「等待后重试一次」。测试把它注入成 0 秒。
_RETRY_DELAY_SECONDS = 0.6
_RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})
# 账号级不可用：本次搜索别再逐条试，整段回落本地。
_ACCOUNT_UNAVAILABLE = frozenset({401, 402, 403, 429})

_MAX_QUERY_CHARS = 128
_MAX_ORI_QUESTION_CHARS = 500
_MAX_URL_CHARS = 8192
_MAX_SNIPPET_CHARS = 1_000
_MAX_TEXT_CHARS = 2_000
_MAX_TITLE_CHARS = 300
# 搜索接口的 count 上限（文档：1–50）。
_MAX_RESULT_COUNT = 50

# 已知搜索操作符：一旦出现就**不能**被 ``build_search_query`` 当普通词吃掉。
# 成对引号也算一种（精确短语是用户显式写下的意图）。
_OPERATOR_PATTERN = re.compile(
    r'(?:^|\s)-?site:|(?:^|\s)lang:|(?:^|\s)-?(?:after|before):|"[^"]+"',
    re.IGNORECASE,
)


class DeepSeekUnavailable(RuntimeError):
    """账号级不可用（无 key / 401 / 402 欠费 / 429 限流），调用方应整段回落本地。"""


class DeepSeekResults(list):
    """``list[dict[str, str]]`` 的子类，额外携带失败原因（``None`` = 正常）。"""

    def __init__(
        self, items: list[dict[str, str]] | None = None, *, failure: str | None = None
    ) -> None:
        super().__init__(items or [])
        self.failure = failure


def has_search_operators(query: str) -> bool:
    """query 里是否写了 ``site:`` / ``lang:`` / ``after:`` / ``before:`` / 成对引号。"""
    return bool(_OPERATOR_PATTERN.search(query or ""))


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _safe_url(value: str) -> str:
    """只放行带主机名的 http/https URL，且拒绝 ``user:pass@``。"""
    url = (value or "").strip()
    if not url or len(url) > _MAX_URL_CHARS:
        return ""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return ""
    if parsed.username or parsed.password:
        return ""
    return url


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


async def _post_with_retry(
    client: httpx.AsyncClient, url: str, payload: dict[str, Any], api_key: str
) -> httpx.Response | None:
    """发一次请求；可重试状态等待后重试一次。网络错误同样重试一次。"""
    for attempt in range(2):
        try:
            response = await client.post(url, json=payload, headers=_headers(api_key))
        except httpx.RequestError as exc:
            if attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_SECONDS)
                continue
            logger.warning("DeepSeek 请求无法连接：%s", type(exc).__name__)
            return None
        if attempt == 0 and response.status_code in _RETRYABLE_STATUS:
            await asyncio.sleep(_RETRY_DELAY_SECONDS)
            continue
        return response
    return None


def _normalize_result(item: Any, *, need_content: bool) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    url = _safe_url(str(item.get("url") or ""))
    title = _clean(item.get("title"), _MAX_TITLE_CHARS)
    if not url or not title:
        return None
    # snippet 为空时退回 summary：DeepSeek 的 summary 是 600–800 字，比没有强。
    snippet = _clean(item.get("snippet") or item.get("summary"), _MAX_SNIPPET_CHARS)
    result = {"title": title, "url": url, "snippet": snippet}
    if need_content:
        content = str(item.get("content") or "").strip()
        if content:
            result["text"] = content[:_MAX_TEXT_CHARS]
    return result


def _failure_for_status(status: int) -> str:
    if status == 401:
        return "unauthorized"
    if status == 402:
        return "insufficient_balance"
    if status == 429:
        return "rate_limited"
    return f"http_{status}"


async def search_deepseek(
    query: str,
    count: int = 10,
    need_content: bool = False,
    ori_question: str = "",
    *,
    api_key: str = "",
) -> DeepSeekResults:
    """调一次 ``/tools/search``；失败返回空列表，原因写在 ``.failure``。

    ``query`` 是**实际发给接口的检索词**（含操作符时调用方要原样传，别改写）；
    ``ori_question`` 是用户整句，仅供接口理解意图。
    """
    normalized = " ".join(str(query or "").split())[:_MAX_QUERY_CHARS]
    if not normalized:
        return DeepSeekResults(failure="empty_query")
    if not api_key:
        return DeepSeekResults(failure="missing_key")

    payload: dict[str, Any] = {
        "query": normalized,
        "count": max(1, min(_MAX_RESULT_COUNT, int(count))),
        "need_content": bool(need_content),
    }
    question = " ".join(str(ori_question or "").split())[:_MAX_ORI_QUESTION_CHARS]
    if question:
        payload["ori_question"] = question

    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
        response = await _post_with_retry(client, SEARCH_ENDPOINT, payload, api_key)
    if response is None:
        return DeepSeekResults(failure="network")

    if response.status_code != 200:
        failure = _failure_for_status(response.status_code)
        logger.warning("DeepSeek 搜索失败 status=%s reason=%s", response.status_code, failure)
        return DeepSeekResults(failure=failure)

    try:
        body = response.json()
    except ValueError:
        logger.warning("DeepSeek 搜索返回了非 JSON 内容")
        return DeepSeekResults(failure="bad_json")
    raw_results = body.get("results") if isinstance(body, dict) else None
    results = [
        normalized_item
        for raw in (raw_results or [])
        if (normalized_item := _normalize_result(raw, need_content=need_content)) is not None
    ]
    logger.info("DeepSeek 搜索完成 result_count=%s", len(results))
    return DeepSeekResults(results)


async def fetch_deepseek_text(url: str, api_key: str) -> str:
    """调一次 ``/tools/fetch`` 取正文。

    单个页面失败（5xx / 非 JSON / 被拒）返回空串，交给聚合层**逐条**回落本地；
    账号级不可用（401 / 402 / 429）抛 :class:`DeepSeekUnavailable`，聚合层整段回落。
    """
    if not api_key:
        raise DeepSeekUnavailable("missing_key")
    target = _safe_url(url)
    if not target:
        # 本地就拒掉非 http(s) 与带凭据的地址：不把它交给第三方去抓。
        logger.info("拒绝交给 DeepSeek 抓取的 URL：%s", url)
        return ""

    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False) as client:
        response = await _post_with_retry(client, FETCH_ENDPOINT, {"url": target}, api_key)
    if response is None:
        return ""
    if response.status_code in _ACCOUNT_UNAVAILABLE:
        logger.warning("DeepSeek 抓取不可用 status=%s", response.status_code)
        raise DeepSeekUnavailable(_failure_for_status(response.status_code))
    if response.status_code != 200:
        logger.info("DeepSeek 抓取失败 status=%s url=%s", response.status_code, target)
        return ""
    try:
        body = response.json()
    except ValueError:
        return ""
    content = str(body.get("content") or "") if isinstance(body, dict) else ""
    return content.strip()[:_MAX_TEXT_CHARS]


__all__ = [
    "DeepSeekResults",
    "DeepSeekUnavailable",
    "FETCH_ENDPOINT",
    "SEARCH_ENDPOINT",
    "fetch_deepseek_text",
    "has_search_operators",
    "search_deepseek",
]

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
  :func:`fetch_deepseek_text_sync` 是它的同步版（``services/web_fetch`` 的抓取兜底档
  是同步编排，可能跑在已有事件循环的 async 路由里，不能 ``asyncio.run``），错误语义
  与重试口径逐条相同。
- 重试口径：408 / 429 / 5xx 等待后重试**一次**；其它 4xx 不重试。

安全边界：
- 只向 ``api.deepseek.com`` 发请求，URL 由本地先做 scheme/凭据校验后才交给对方；
- 不记录密钥，日志只写状态码与结果条数。
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from .. import net_proxy

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
# 正文上限（Q06 的根因就在这个数）。2000 是"摘要级"的旧口径：那时正文只当加密的
# snippet 用。同一条正文现在还要喂给岗位抽取，而抽取的输入预算是
# ``text_extraction.MAX_JOB_EXTRACTION_INPUT_CHARS`` = 48000 字符——2000 字符连一段
# 岗位职责都盖不住（差 24 倍），等于白接服务端抓取。
# 取 20000 ≈ 抽取预算的 40%：一次请求就能带回完整 JD，又不至于单条结果吃掉半个提示词
# 预算（多条结果的总量由 ``enrich`` 的选段预算再收一次）。
_MAX_TEXT_CHARS = 20_000
_MAX_TITLE_CHARS = 300
# 六个检索元信息字段的长度上限（T13）。它们**全部以 str 承载**：下游（``aggregate``
# 的 RRF、``filter_relevant_results``、工具结果序列化）一律按 str 消费，None 会让
# ``" ".join(...)`` 与比较直接炸掉。
_MAX_SUMMARY_CHARS = 1_000
_MAX_AUTHORITY_CHARS = 24
_MAX_SCORE_CHARS = 24
_MAX_SITE_NAME_CHARS = 120
_MAX_SITE_ICON_CHARS = 512
_MAX_DATE_CHARS = 40
# 搜索接口的 count 上限（文档：1–50）。
_MAX_RESULT_COUNT = 50
# 同步 Fetch（``web_fetch`` 的兜底档）超时：服务端抓一个反爬页面本身就要几秒，
# 不能沿用搜索侧 30 秒的 read 预算口径去卡"整次抓取任务"，也不能短到必失败。
_SYNC_FETCH_TIMEOUT_SECONDS = 30.0

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


def _optional_text(value: Any, limit: int) -> str:
    """可选字段统一成 str：**缺省是空串而不是 None**（契约是 ``dict[str, str]``）。

    与 ``_clean`` 的差别只在"假值"的处理：``rerank_score`` 合法值可以是 ``0``，用
    ``value or ""`` 会把最低分的那个丢掉；这里只在 ``None`` / 布尔值上返回空串。
    """
    if value is None or isinstance(value, bool):
        return ""
    return " ".join(str(value).split())[:limit]


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


def _post_sync_with_retry(
    client: httpx.Client, url: str, payload: dict[str, Any], api_key: str
) -> httpx.Response | None:
    """``_post_with_retry`` 的同步版：口径逐条相同（可重试状态与网络错误各重试一次）。"""
    for attempt in range(2):
        try:
            response = client.post(url, json=payload, headers=_headers(api_key))
        except httpx.RequestError as exc:
            if attempt == 0:
                time.sleep(_RETRY_DELAY_SECONDS)
                continue
            logger.warning("DeepSeek 请求无法连接：%s", type(exc).__name__)
            return None
        if attempt == 0 and response.status_code in _RETRYABLE_STATUS:
            time.sleep(_RETRY_DELAY_SECONDS)
            continue
        return response
    return None


def _normalize_result(item: Any, *, need_content: bool) -> dict[str, str] | None:
    """把一条原始结果收敛成 ``dict[str, str]``（T13：六个元信息字段全部保留）。

    - ``summary`` 单独保留，**不与 snippet 混用**：snippet 是检索片段，summary 是
      600–800 字的概述，前端卡片两种都要（snippet 为空时才退回 summary，但字段本身
      仍在）；
    - ``site_icon`` 只放行 http/https 绝对 URL（同 ``_safe_url`` 的口径）：它会进
      ``<img src>``，``javascript:`` / ``data:`` 这类值绝不能落到前端；
    - ``date`` 保留原始 ISO 串，格式化交给前端（后端不猜用户时区与格式）；
    - ``authority`` / ``rerank_score`` 用 ``str()`` 承载数字或文字，缺省空串。
    """
    if not isinstance(item, dict):
        return None
    url = _safe_url(str(item.get("url") or ""))
    title = _clean(item.get("title"), _MAX_TITLE_CHARS)
    if not url or not title:
        return None
    # snippet 为空时退回 summary：DeepSeek 的 summary 是 600–800 字，比没有强。
    snippet = _clean(item.get("snippet") or item.get("summary"), _MAX_SNIPPET_CHARS)
    result = {
        "title": title,
        "url": url,
        "snippet": snippet,
        "summary": _optional_text(item.get("summary"), _MAX_SUMMARY_CHARS),
        "authority": _optional_text(item.get("authority"), _MAX_AUTHORITY_CHARS),
        "rerank_score": _optional_text(item.get("rerank_score"), _MAX_SCORE_CHARS),
        "site_name": _optional_text(item.get("site_name"), _MAX_SITE_NAME_CHARS),
        "site_icon": _safe_url(_optional_text(item.get("site_icon"), _MAX_SITE_ICON_CHARS)),
        "date": _optional_text(item.get("date"), _MAX_DATE_CHARS),
    }
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

    # T03：搜索与模型走同一条出网路径（`direct` 模式下也必须跟着关掉代理）。
    async with net_proxy.build_async_client(
        url=SEARCH_ENDPOINT, timeout=_TIMEOUT, follow_redirects=False
    ) as client:
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
    _record_search_usage()
    return DeepSeekResults(results)


def _record_search_usage() -> None:
    """记一次成功的搜索请求（T16：按**次数**计，不折算金额）。

    计费口径是"每次成功的搜索请求 × 条数无关"，所以这里记 1；失败路径（非 200）不记
    ——用户没有为失败付钱，账面上也不该出现这一笔。缓存命中不会走到这里（聚合层在缓存
    命中时直接返回），所以"同一查询重复搜索"只会在真的发出请求时计一次。
    """
    try:
        from ..usage_counters import KIND_SEARCH, record_external_usage

        record_external_usage(KIND_SEARCH, 1, source="search:deepseek")
    except Exception:  # noqa: BLE001 - 记账是旁路，不能反写到搜索结果
        logger.warning("搜索用量记账失败", exc_info=True)


def _extract_fetch_content(response: httpx.Response) -> str:
    """把一个 ``/tools/fetch`` 响应转成正文（异步/同步两版共用这一份判定）。

    账号级不可用（401 / 402 / 429）抛 :class:`DeepSeekUnavailable`；其它失败返回空串
    ——调用方**逐条**回落本地，只有账号级才整段回落。
    """
    if response.status_code in _ACCOUNT_UNAVAILABLE:
        logger.warning("DeepSeek 抓取不可用 status=%s", response.status_code)
        raise DeepSeekUnavailable(_failure_for_status(response.status_code))
    if response.status_code != 200:
        logger.info("DeepSeek 抓取失败 status=%s", response.status_code)
        return ""
    try:
        body = response.json()
    except ValueError:
        return ""
    content = str(body.get("content") or "") if isinstance(body, dict) else ""
    return content.strip()[:_MAX_TEXT_CHARS]


async def fetch_deepseek_text(url: str, api_key: str) -> str:
    """调一次 ``/tools/fetch`` 取正文（异步，搜索侧正文补全用）。

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

    async with net_proxy.build_async_client(
        url=FETCH_ENDPOINT, timeout=_TIMEOUT, follow_redirects=False
    ) as client:
        response = await _post_with_retry(client, FETCH_ENDPOINT, {"url": target}, api_key)
    if response is None:
        return ""
    return _extract_fetch_content(response)


def fetch_deepseek_text_sync(
    url: str,
    api_key: str,
    *,
    timeout: float = _SYNC_FETCH_TIMEOUT_SECONDS,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """``fetch_deepseek_text`` 的同步版（``web_fetch`` 的第四档用它）。

    抓取编排（``JobFetcher``）是同步代码，而它可能运行在已经有事件循环的 async 路由里
    （``preview_from_url`` 就是），所以这里不能用 ``asyncio.run`` 包一层异步版本——
    那样会直接抛 "event loop is already running"。两版共用 ``_extract_fetch_content``
    与重试口径，只有"发请求"这一步不同。

    语义与异步版逐条一致：单页失败返回空串，账号级不可用抛
    :class:`DeepSeekUnavailable`（调用方据此停止后续页面的重试）。
    """
    if not api_key:
        raise DeepSeekUnavailable("missing_key")
    target = _safe_url(url)
    if not target:
        logger.info("拒绝交给 DeepSeek 抓取的 URL：%s", url)
        return ""
    with net_proxy.build_client(
        url=FETCH_ENDPOINT, timeout=timeout, follow_redirects=False, transport=transport
    ) as client:
        response = _post_sync_with_retry(client, FETCH_ENDPOINT, {"url": target}, api_key)
    if response is None:
        return ""
    return _extract_fetch_content(response)


__all__ = [
    "DeepSeekResults",
    "DeepSeekUnavailable",
    "FETCH_ENDPOINT",
    "SEARCH_ENDPOINT",
    "fetch_deepseek_text",
    "fetch_deepseek_text_sync",
    "has_search_operators",
    "search_deepseek",
]

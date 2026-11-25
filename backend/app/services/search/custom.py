# SPDX-License-Identifier: Apache-2.0
"""自定义搜索来源（CR-09）：协议模板 + 通用字段映射。

## 它解决什么

搜索来源原本是闭集（Bing / DDG / SearXNG / DeepSeek / Tavily / Jina），用户自带的大模型
搜索接口无处可配。这里允许**一套**自定义源：给一个根地址，按模板（Kimi / 通用）拼端点，
按字段映射从响应里取结果。

## 与 DeepSeek 来源的区别

- 请求体保持同一形状（``query`` / ``count`` / ``need_content``），这样 Kimi 模板可以
  只填 base_url 就能用；
- 响应字段位置可配（``search_result`` 或 ``data.items`` 之类）；
- 端点只允许相对路径、base_url 只允许公网 http/https 或本机回环（SSRF 由
  ``schemas.search_custom`` 在保存时判定，这里在发请求前再判一次——配置可能是旧版本
  写进来的，运行期不能假设它已经过校验）。

## 失败语义

与其它来源一致：**永不抛异常**，返回带 ``failure`` 的空列表（``unauthorized`` /
``insufficient_balance`` / ``rate_limited`` / ``network`` / ``timeout`` / ``bad_json`` /
``bad_format`` / ``missing_endpoint``）。聚合层用 ``status.error_kind_for_failure`` 统一
分类，这里不另建一套分类。
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from ...schemas.search_custom import CUSTOM_TEMPLATES, normalize_custom_base_url
from ...schemas.setting import SearchConfig
from .. import net_proxy

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
_MAX_QUERY_CHARS = 128
_MAX_TITLE_CHARS = 300
_MAX_SNIPPET_CHARS = 1_000
_MAX_SUMMARY_CHARS = 1_000
_MAX_TEXT_CHARS = 20_000
_MAX_COUNT = 50

_FIELD_SEGMENT_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$")


class CustomResults(list):
    """``list[dict[str, str]]`` 的子类，额外携带失败原因（``None`` = 正常）。"""

    def __init__(self, items: list[dict[str, str]] | None = None, *, failure: str | None = None):
        super().__init__(items or [])
        self.failure = failure


@dataclass(frozen=True)
class CustomSource:
    """解析后的自定义源：模板默认值已经填好，运行期只用这一份。"""

    base_url: str
    search_path: str
    fetch_path: str
    results_field: str
    include_content: bool
    api_key: str
    name: str


def resolve_custom_source(config: SearchConfig) -> CustomSource | None:
    """配置 → 可用的自定义源；没勾选 / 没有 base_url / generic 缺端点时返回 ``None``。"""
    if "custom" not in (config.sources or []):
        return None
    try:
        base_url = normalize_custom_base_url(config.custom_base_url)
    except ValueError:
        logger.warning("自定义搜索地址未通过校验，本次不参与：%s", config.custom_base_url[:32])
        return None
    if not base_url:
        return None
    template = CUSTOM_TEMPLATES.get(config.custom_template, CUSTOM_TEMPLATES["moonshot"])
    search_path = config.custom_search_path or str(template["search_path"])
    if not search_path:
        # generic 模板又不填端点：没有可打的地址，参与只会得到一个空结果。
        return None
    return CustomSource(
        base_url=base_url,
        search_path=search_path,
        fetch_path=config.custom_fetch_path or str(template["fetch_path"]),
        results_field=config.custom_results_field or str(template["results_field"]),
        include_content=bool(config.custom_include_content),
        api_key=(config.custom_api_key or "").strip(),
        name=(config.custom_name or "").strip() or str(template["label"]),
    )


def resolve_field(payload: Any, path: str) -> Any:
    """按 ``a.b`` / ``a[0].b`` 从响应里取值；路径不存在返回 ``None``。

    只支持点号与 ``[n]`` 两种语法（保存时已经校验过）。空路径 = 响应本身就是结果数组。
    """
    current = payload
    for segment in (path or "").split("."):
        if not segment:
            continue
        match = _FIELD_SEGMENT_RE.match(segment)
        if match is None:
            return None
        key, index = match.group(1), match.group(2)
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if index is not None:
            if not isinstance(current, list):
                return None
            position = int(index)
            if position >= len(current):
                return None
            current = current[position]
    return current


def _headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _safe_url(value: Any) -> str:
    url = str(value or "").strip()
    if not url or len(url) > 8192:
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


def _normalize_item(item: Any, *, need_content: bool) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    url = _safe_url(item.get("url") or item.get("link"))
    title = _clean(item.get("title") or item.get("name"), _MAX_TITLE_CHARS)
    if not url or not title:
        return None
    result = {
        "title": title,
        "url": url,
        "snippet": _clean(
            item.get("snippet") or item.get("summary") or item.get("description"),
            _MAX_SNIPPET_CHARS,
        ),
        "summary": _clean(item.get("summary"), _MAX_SUMMARY_CHARS),
    }
    if need_content:
        content = str(item.get("content") or item.get("text") or "").strip()
        if content:
            result["text"] = content[:_MAX_TEXT_CHARS]
    return result


def _failure_for_status(status: int) -> str:
    if status in {401, 403}:
        return "unauthorized"
    if status == 402:
        return "insufficient_balance"
    if status == 429:
        return "rate_limited"
    if 300 <= status < 400:
        # 未跟随的重定向：端点换域名或中间层劫持。归到 network（用户能做的是查地址/网络）。
        return "network"
    return f"http_{status}"


async def search_custom(
    query: str,
    source: CustomSource,
    *,
    count: int = 10,
    need_content: bool | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> CustomResults:
    """调一次自定义搜索端点；失败返回空列表，原因写在 ``.failure``。"""
    normalized = " ".join(str(query or "").split())[:_MAX_QUERY_CHARS]
    if not normalized:
        return CustomResults(failure="empty_query")
    if not source.search_path:
        return CustomResults(failure="missing_endpoint")
    include_content = source.include_content if need_content is None else bool(need_content)
    url = f"{source.base_url}{source.search_path}"
    payload: dict[str, Any] = {
        "query": normalized,
        "count": max(1, min(_MAX_COUNT, int(count))),
        "need_content": include_content,
    }
    try:
        async with net_proxy.build_async_client(
            url=url, transport=transport, timeout=_TIMEOUT, follow_redirects=False
        ) as client:
            response = await client.post(url, json=payload, headers=_headers(source.api_key))
    except (httpx.TimeoutException, TimeoutError):
        # 与 DeepSeek / Tavily 同口径：超时归 network（用户要做的是查网络/超时设置）。
        logger.info("自定义搜索超时：%s", source.name)
        return CustomResults(failure="network")
    except httpx.RequestError as exc:
        logger.info("自定义搜索无法连接：%s（%s）", source.name, type(exc).__name__)
        return CustomResults(failure="network")
    if response.status_code >= 400 or 300 <= response.status_code < 400:
        failure = _failure_for_status(response.status_code)
        logger.info("自定义搜索失败：status=%s failure=%s", response.status_code, failure)
        return CustomResults(failure=failure)
    try:
        body = response.json()
    except ValueError:
        logger.info("自定义搜索响应不是 JSON：status=%s", response.status_code)
        return CustomResults(failure="bad_json")
    entries = resolve_field(body, source.results_field)
    if source.results_field and not isinstance(entries, list):
        return CustomResults(failure="bad_format")
    if not isinstance(entries, list):
        return CustomResults(failure="bad_format")
    items = [
        normalized_item
        for entry in entries
        if (normalized_item := _normalize_item(entry, need_content=include_content)) is not None
    ]
    return CustomResults(items)


async def fetch_custom_text(
    url: str,
    source: CustomSource,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """自定义源抓正文；失败返回空串（由聚合层逐条回落 DeepSeek / 本机）。

    只有配置了 ``fetch_path`` 才可用——空串立即返回，不发一次注定 404 的请求。
    """
    safe = _safe_url(url)
    if not safe or not source.fetch_path:
        return ""
    endpoint = f"{source.base_url}{source.fetch_path}"
    try:
        async with net_proxy.build_async_client(
            url=endpoint, transport=transport, timeout=_TIMEOUT, follow_redirects=False
        ) as client:
            response = await client.post(
                endpoint, json={"url": safe}, headers=_headers(source.api_key)
            )
    except (httpx.TimeoutException, httpx.RequestError, TimeoutError):
        return ""
    if response.status_code >= 400:
        return ""
    try:
        body = response.json()
    except ValueError:
        return ""
    if isinstance(body, str):
        return body[:_MAX_TEXT_CHARS]
    if not isinstance(body, dict):
        return ""
    text = str(body.get("content") or body.get("text") or "").strip()
    return text[:_MAX_TEXT_CHARS]


async def custom_search_from_config(
    query: str, config: SearchConfig, *, count: int, need_content: bool
) -> CustomResults:
    """聚合层的入口：自己解析配置再搜（没配置时返回 ``missing_endpoint``）。

    把"解析 + 调用"收在本模块，``aggregate`` 那边只留一行——那个文件贴着 500 行预算，
    多一段来源分支就要再多一次拆分。
    """
    source = resolve_custom_source(config)
    if source is None:
        return CustomResults(failure="missing_endpoint")
    return await search_custom(query, source, count=count, need_content=need_content)


def custom_plan(query: str, config: SearchConfig, limit: int):
    """聚合层的计划项：返回一个待 await 的协程（``aggregate`` 只做接线）。

    把"按档位决定要不要正文"的判断留在这里，``aggregate`` 不必知道自定义源的细节。
    """
    return custom_search_from_config(
        query, config, count=limit, need_content=config.page_budget > 0
    )


def custom_fetcher_for(config: SearchConfig) -> Callable[[str], Awaitable[str]] | None:
    """配置 → 正文抓取回调；没勾选自定义源时返回 ``None``（连空调用都不该有）。"""
    source = resolve_custom_source(config)
    if source is None:
        return None

    async def _fetch(url: str) -> str:
        return await fetch_custom_text(url, source)

    return _fetch


__all__ = [
    "CustomResults",
    "CustomSource",
    "custom_fetcher_for",
    "custom_plan",
    "custom_search_from_config",
    "fetch_custom_text",
    "resolve_custom_source",
    "resolve_field",
    "search_custom",
]

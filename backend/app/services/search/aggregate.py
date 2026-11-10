# SPDX-License-Identifier: Apache-2.0
"""多引擎聚合：并发查询 → 合并去重 → 相关性过滤 → 官网优先 → 可选正文补全。

设计取舍：
- **一个来源失败不影响其它来源**：每个引擎的异常都被自己吞掉（返回空列表），聚合层
  再决定"全空"才算失败。搜索是锦上添花的功能，不该因为某个公开端点抖动就报错。
- **按来源交错合并**：直接拼会把 DuckDuckGo 的结果全排在 Bing 后面，交错能让不同
  来源都有机会进入最终列表（排序仍按官网优先）。
- **正文补全只做前几条**：抓页面比搜索慢一个数量级，用户等待时间主要由它决定。

DeepSeek 来源（需求 5，默认关闭）：
- 只有配置了 key 且勾选 ``deepseek`` 才参与并发；无 key 时**不参与**，绝不"假装成功"；
- 搜索阶段命中 ``site:`` / ``after:`` 等操作符时跳过 ``build_search_query`` 改写，
  否则操作符会被当普通词吃掉；
- 正文补全：``fetch_pages>0`` 时先让搜索带回正文（``need_content=True``），缺口再走
  ``/tools/fetch``，**单条**失败只回落该条的本地抓取；账号级不可用则整段走本地路径。
"""

from __future__ import annotations

import asyncio
import logging

from ...schemas.setting import SearchConfig
from ..assistant.assistant_web_search import (
    AssistantSearchError,
    _deduplicate,
    build_search_query,
    filter_relevant_results,
    official_like_score,
)
from ..assistant.assistant_web_search import (
    search_web as bing_search,
)
from .deepseek import (
    DeepSeekUnavailable,
    fetch_deepseek_text,
    has_search_operators,
    search_deepseek,
)
from .duckduckgo import search_duckduckgo
from .page_reader import fetch_page_text
from .searxng import search_searxng

logger = logging.getLogger(__name__)

# 正文补全进上下文的长度：够判断内容是否相关即可，太长会挤掉历史消息。
CONTENT_EXCERPT_CHARS = 1_200
# 每个来源最多取多少条候选（最终还会按 max_results 截断）。
_PER_SOURCE_LIMIT = 10
# 402 欠费要直接告诉用户：这是"配置问题"，不是"这次没搜到"。
_BALANCE_MESSAGE = "DeepSeek 搜索账户余额不足（402），本次没有可用的其它搜索来源。"
_BALANCE_FAILURES = frozenset({"insufficient_balance"})


def _interleave(groups: list[list[dict[str, str]]]) -> list[dict[str, str]]:
    """按"轮流取一条"合并多个来源，避免某个引擎的结果被整段排到最后。"""
    merged: list[dict[str, str]] = []
    for index in range(max((len(group) for group in groups), default=0)):
        for group in groups:
            if index < len(group):
                merged.append(group[index])
    return merged


async def _from_bing(query: str) -> list[dict[str, str]]:
    try:
        return await bing_search(query)
    except AssistantSearchError as exc:
        logger.info("Bing 来源无结果：%s", exc)
        return []
    except Exception:  # noqa: BLE001 - 单来源异常不能拖垮整次搜索
        logger.exception("Bing 来源发生内部错误")
        return []


async def _from_duckduckgo(
    query: str, limit: int = _PER_SOURCE_LIMIT
) -> list[dict[str, str]]:
    return await search_duckduckgo(query, limit=limit)


async def _from_searxng(
    query: str, base_url: str, limit: int = _PER_SOURCE_LIMIT
) -> list[dict[str, str]]:
    return await search_searxng(query, base_url, limit=limit)


async def _from_deepseek(
    search_query: str,
    original_query: str,
    api_key: str,
    need_content: bool,
    limit: int = _PER_SOURCE_LIMIT,
) -> list[dict[str, str]]:
    """DeepSeek 来源：失败返回空列表（沿用"单来源失败不拖垮整次搜索"的约定）。"""
    try:
        return await search_deepseek(
            search_query,
            count=limit,
            need_content=need_content,
            ori_question=original_query,
            api_key=api_key,
        )
    except Exception:  # noqa: BLE001 - 单来源异常不能拖垮整次搜索
        logger.exception("DeepSeek 来源发生内部错误")
        return []


def _failure_of(group: list[dict[str, str]]) -> str | None:
    """取 ``DeepSeekResults.failure``；其它来源的普通列表没有这个属性。"""
    return getattr(group, "failure", None)


async def _enrich_with_page_text(
    results: list[dict[str, str]], count: int, api_key: str = ""
) -> None:
    """为前 ``count`` 条补正文。

    已经由 DeepSeek 搜索带回正文的条目不重复抓；其余先试 ``/tools/fetch``，
    **单条**失败只回落该条的本地抓取。``DeepSeekUnavailable``（账号级）时整段走本地。
    """
    targets = results[:count]
    if not targets:
        return

    # 搜索阶段已经带回正文的条目直接沿用，不重复抓（那正是 need_content 的价值）。
    texts: list[str] = [str(item.get("text") or "") for item in targets]
    if api_key:
        pending = [index for index, text in enumerate(texts) if not text]
        if pending:
            try:
                fetched = await asyncio.gather(
                    *(fetch_deepseek_text(targets[index]["url"], api_key) for index in pending)
                )
                for index, text in zip(pending, fetched, strict=False):
                    texts[index] = text
            except DeepSeekUnavailable:
                # 账号级不可用：逐条再试只是多打几次网络，直接整段回落本地。
                logger.info("DeepSeek 抓取不可用，本次正文补全整段回落本地")

    missing = [index for index, text in enumerate(texts) if not text]
    if missing:
        fallback = await asyncio.gather(
            *(fetch_page_text(targets[index]["url"]) for index in missing)
        )
        for index, text in zip(missing, fallback, strict=False):
            texts[index] = text

    for item, text in zip(targets, texts, strict=False):
        if text:
            item["text"] = text[:CONTENT_EXCERPT_CHARS]


async def aggregate_search(
    query: str, config: SearchConfig, limit: int | None = None
) -> list[dict[str, str]]:
    """按配置聚合搜索；所有来源都没有结果时抛 ``AssistantSearchError``。

    ``limit`` 是**这一次调用**希望返回的条数（模型可以通过 ``web_search`` 工具传）：
    不传按设置页的 ``max_results``（上限）处理；超过上限夹到上限，小于 1 夹到 1。
    ``config.max_results`` 是上限而不是精确值——"设 30 就一定要 30 条"是做不到的承诺
    （单个来源本身有取数上限、去重与相关性过滤也会减少条数）。
    """
    sources = list(dict.fromkeys(config.sources or ["bing"]))
    cap = max(1, min(limit if limit is not None else config.max_results, config.max_results))
    # 每个来源多取一些候选：合并去重与相关性过滤会消耗条数，只按 cap 取会拿不满。
    per_source_limit = max(_PER_SOURCE_LIMIT, cap)
    # 在聚合层统一改写一次查询：DDG / SearXNG 拿到的是改写后的关键词，而不是用户整句。
    # 否则整句（「帮我把…」）会被搜索引擎分词成首字（「帮」），返回一堆无关结果。
    search_query = build_search_query(query)
    # DeepSeek 带操作符（site: / after: / "精确短语"…）时必须原样传：改写会把操作符
    # 当普通词吃掉，`site:zhipin.com` 就退化成对 "site" 这个词的搜索。
    deepseek_query = query if has_search_operators(query) else search_query
    tasks = []
    for source in sources:
        if source == "bing":
            # Bing 走 ``search_web``，它内部**自己**会调 ``build_search_query``，所以这里传
            # 原句：把已改写好的关键词再喂给它会被二次改写成别的（``build_search_query`` 对
            # 已是关键词列表的输入并不幂等——「互联网大厂 + 招聘」会被再判成"招聘发现类"）。
            tasks.append(_from_bing(query))
        elif source == "duckduckgo":
            tasks.append(_from_duckduckgo(search_query, per_source_limit))
        elif source == "searxng" and config.searxng_url:
            tasks.append(_from_searxng(search_query, config.searxng_url, per_source_limit))
        elif source == "deepseek" and config.deepseek_api_key:
            # 无 key 时不入列：它不该占一个并发位，更不该返回"成功但没有结果"。
            tasks.append(
                _from_deepseek(
                    deepseek_query,
                    query,
                    config.deepseek_api_key,
                    need_content=config.fetch_pages > 0,
                    limit=per_source_limit,
                )
            )

    if not tasks:
        tasks.append(_from_bing(query))

    groups = await asyncio.gather(*tasks)
    failures = {failure for group in groups if (failure := _failure_of(group))}
    merged = _deduplicate(_interleave([group for group in groups if group]))
    relevant = filter_relevant_results(merged, query)
    # 排序：用人单位官网与招聘页在前，第三方平台在后；同分保持来源交错顺序。
    relevant.sort(key=lambda item: -official_like_score(item))
    limited = relevant[:cap]

    if config.fetch_pages > 0:
        await _enrich_with_page_text(limited, config.fetch_pages, config.deepseek_api_key)
    for item in limited:
        text = item.get("text")
        if text:
            item["text"] = text[:CONTENT_EXCERPT_CHARS]

    if not limited:
        if failures & _BALANCE_FAILURES:
            raise AssistantSearchError(_BALANCE_MESSAGE)
        raise AssistantSearchError(
            "没有找到与当前问题直接相关的公开来源。可以换成更具体的公司名、岗位名或技术方向再搜一次。"
        )
    if failures:
        # 其它来源有结果时不打断回答，但要把"某个来源这次没参与"留在日志里。
        logger.warning("聚合搜索有来源失败 failures=%s", ",".join(sorted(failures)))
    logger.info(
        "聚合搜索完成 sources=%s limit=%s cap=%s result_count=%s with_text=%s",
        ",".join(sources),
        limit,
        cap,
        len(limited),
        sum(1 for item in limited if item.get("text")),
    )
    return limited


__all__ = ["CONTENT_EXCERPT_CHARS", "aggregate_search"]

# SPDX-License-Identifier: Apache-2.0
"""多引擎聚合：并发查询（有总预算）→ RRF 融合 → 相关性过滤 → 时效加权 → 分段选正文。

设计取舍：
- **一个来源失败不影响其它来源**：每个引擎的异常都被自己吞掉（返回空列表），聚合层
  再决定"全空"才算失败。搜索是锦上添花的功能，不该因为某个公开端点抖动就报错。
- **总预算是硬约束**（P4-02）：旧实现 ``asyncio.gather(*tasks)`` 等最慢的那个源，而
  DeepSeek 的 read timeout 是 30 秒——一个源卡住，整次搜索就卡 30 秒。现在用
  ``asyncio.wait(timeout=SEARCH_BUDGET_SECONDS)``：超时的源丢弃（并记进
  ``source_status``），**已完成的结果照常返回**。
- **RRF 融合而不是轮流取一条**（P4-03）：同一结果被多个来源命中是"相关性"最强的信号，
  旧实现完全不加权。计分复用 RAG 的实现（见 ``fusion.py``）。
- **正文补全按档位 + 选段**（P4-07/P4-08）：抓哪几页、抓几段、总字符多少由
  ``depth`` 决定；正文经过 ``passages.select_context`` 选段，0 命中的页只留摘要。

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
import time
from dataclasses import dataclass, field
from typing import Any

from ...schemas.setting import SearchConfig
from ..assistant.assistant_web_search import (
    BING_RSS_EMPTY_MESSAGE,
    AssistantSearchError,
    build_search_query,
    filter_relevant_results,
    official_like_score,
)
from ..assistant.assistant_web_search import (
    search_web as bing_search,
)
from .cache import cache_key as build_cache_key
from .cache import search_cache
from .canonical import canonical_url, dedupe_by_url
from .dates import is_recency_query, recency_bonus
from .deepseek import fetch_deepseek_text, has_search_operators, search_deepseek
from .duckduckgo import search_duckduckgo
from .enrich import CONTENT_EXCERPT_CHARS as CONTENT_EXCERPT_CHARS
from .enrich import enrich_with_page_text as _enrich_with_page_text
from .fusion import blend, rrf_scores
from .page_reader import fetch_page_text
from .providers.jina import search_jina
from .providers.tavily import search_tavily
from .searxng import search_searxng
from .status import (
    NETWORK,
    classify_exception,
    error_kind_for_failure,
    status_entry,
    summarize,
)

logger = logging.getLogger(__name__)

# 每个来源最多取多少条候选（最终还会按 max_results 截断）。
_PER_SOURCE_LIMIT = 10
# 402 欠费要直接告诉用户：这是"配置问题"，不是"这次没搜到"。
_BALANCE_MESSAGE = "DeepSeek 搜索账户余额不足（402），本次没有可用的其它搜索来源。"
_BALANCE_FAILURES = frozenset({"insufficient_balance"})
# 整次搜索的墙钟预算（P4-02）：6–8 秒。取 7 秒——足够覆盖"两个来源正常返回 + 抓 2 页
# 正文"，又不至于让用户对着转圈等十秒以上。
SEARCH_BUDGET_SECONDS = 7.0
# 各档位的（页数, 每页段数, 总字符）：**总字符按总量分配**，不是每页均分。
DEPTH_PROFILE: dict[str, tuple[int, int, int]] = {
    "snippet": (0, 0, 0),
    "standard": (2, 2, 1800),
    "deep": (5, 3, 4000),
}


class SearchOutcome(list):
    """``list[dict[str, str]]`` + 本次搜索的元信息。

    历史调用方（``web_search`` 工具、既有测试）按普通列表用，所以这里做成 list 子类：
    多出来的 ``source_status`` / ``notes`` 只在需要的地方读，不改变任何既有签名。
    """

    def __init__(
        self,
        items: list[dict[str, str]] | None = None,
        *,
        source_status: list[dict[str, Any]] | None = None,
        notes: list[str] | None = None,
        sorted_by_time: bool = False,
        cached: bool = False,
    ) -> None:
        super().__init__(items or [])
        self.source_status = list(source_status or [])
        self.notes = list(notes or [])
        self.sorted_by_time = bool(sorted_by_time)
        self.cached = bool(cached)


@dataclass
class _Group:
    """一个来源这一次的战果（含失败分类），供 source_status 与融合共用。"""

    source: str
    items: list[dict[str, str]] = field(default_factory=list)
    failure: str | None = None
    error_kind: str = ""
    elapsed_ms: int = 0
    timed_out: bool = False
    # 抛了异常（而不是"正常返回但没有结果"）。**不能只靠 `failure` 判断**：
    # 异常路径没有 provider 级 failure 标记，只看它会把失败的源记成 ok。
    errored: bool = False

    @property
    def ok(self) -> bool:
        return not self.timed_out and not self.errored and not self.failure


async def _collect(source: str, awaitable: Any) -> _Group:
    """跑一个来源并计时；异常在这里被收口（分类交给 ``status``）。"""
    started = time.perf_counter()
    try:
        if asyncio.iscoroutine(awaitable):
            items = await awaitable
    except Exception as exc:  # noqa: BLE001 - 单来源异常不能拖垮整次搜索
        elapsed = int((time.perf_counter() - started) * 1000)
        logger.info("来源 %s 失败：%s", source, type(exc).__name__)
        return _Group(
            source=source,
            error_kind=classify_exception(exc),
            elapsed_ms=elapsed,
            errored=True,
        )
    elapsed = int((time.perf_counter() - started) * 1000)
    failure = getattr(items, "failure", None)
    return _Group(
        source=source,
        items=[dict(item) for item in (items or [])],
        failure=failure,
        error_kind=error_kind_for_failure(failure),
        elapsed_ms=elapsed,
    )


async def _from_bing(query: str) -> Any:
    """Bing 来源：零结果时用 ``failure`` 标记，好把「RSS 可能已变更」说给用户听。"""
    try:
        return await bing_search(query)
    except AssistantSearchError as exc:
        logger.info("Bing 来源无结果：%s", exc)
        return _FailedResults(failure="bad_format" if str(exc) == BING_RSS_EMPTY_MESSAGE else "network")
    except Exception:  # noqa: BLE001 - 单来源异常不能拖垮整次搜索
        logger.exception("Bing 来源发生内部错误")
        return _FailedResults(failure="network")


class _FailedResults(list):
    """失败来源的空结果载体（``list`` 子类，带 ``failure``，与 DeepSeek 同构）。

    用它而不是抛异常，是因为"这个来源这次没成功"与"整次搜索失败"不是一回事：
    前者只让这一个来源缺席，并带上可分类的 ``failure``。
    """

    def __init__(self, items: list[dict[str, str]] | None = None, *, failure: str | None = None):
        super().__init__(items or [])
        self.failure = failure


async def _from_duckduckgo(query: str, limit: int = _PER_SOURCE_LIMIT) -> list[dict[str, str]]:
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
) -> Any:
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
        return _FailedResults(failure="network")


async def _from_tavily(query: str, api_key: str, limit: int, depth: str) -> Any:
    """Tavily：``raw_content`` 也带回正文，后续同样过选段（P4-09）。"""
    return await search_tavily(
        query,
        api_key=api_key,
        max_results=limit,
        depth=depth,
        include_raw_content=depth != "snippet",
    )


async def _from_jina(query: str, api_key: str, limit: int) -> Any:
    return await search_jina(query, api_key=api_key, limit=limit)


def _fuse(groups: list[_Group]) -> list[dict[str, str]]:
    """按 RRF 融合各来源名次，同分再用 ``official_like_score`` 做 tie-break。

    返回**已去重**的结果列表（按融合分降序）。去重键是 canonical URL（P4-01）：
    同一篇 CMS 文章的 ``?id=1`` / ``?id=2`` 是两条，带不同 ``utm_*`` 的是同一条。
    """
    rankings: dict[str, list[str]] = {}
    first_seen: dict[str, dict[str, str]] = {}
    order: list[str] = []
    for group in groups:
        keys: list[str] = []
        for item in group.items:
            url = str(item.get("url") or "")
            key = canonical_url(url) or url.casefold()
            if not key:
                continue
            keys.append(key)
            if key not in first_seen:
                first_seen[key] = item
                order.append(key)
        if keys:
            rankings[group.source] = keys

    scores = blend(rrf_scores(rankings)) if rankings else {}
    merged = [first_seen[key] for key in order]
    merged = dedupe_by_url(merged)
    # 名次索引：同分时保持"来源交错顺序"的稳定性（== 首次出现的先后）。
    position = {id(item): index for index, item in enumerate(merged)}
    merged.sort(
        key=lambda item: (
            -scores.get(canonical_url(str(item.get("url") or "")) or "", 0.0),
            -official_like_score(item),
            position.get(id(item), 0),
        )
    )
    return merged


def _apply_recency(results: list[dict[str, str]], query: str) -> bool:
    """时效加权（P4-04）：只在查询带时效词时改变排序，**一条都不丢**。"""
    if not is_recency_query(query):
        return False
    indexed = list(enumerate(results))

    def _key(pair: tuple[int, dict[str, str]]) -> tuple[float, int]:
        index, item = pair
        bonus = recency_bonus(str(item.get("published_at") or ""))
        return (-bonus, index)

    indexed.sort(key=_key)
    results[:] = [item for _, item in indexed]
    return True


def _build_status(groups: list[_Group]) -> list[dict[str, Any]]:
    """``source_status``：每个来源一条，``error_kind`` 只在失败时给。"""
    return [
        status_entry(
            group.source,
            ok=group.ok,
            elapsed_ms=group.elapsed_ms,
            error_kind=group.error_kind,
        )
        for group in groups
    ]


async def _run_sources(
    query: str, config: SearchConfig, sources: list[str], per_source_limit: int, depth: str
) -> list[_Group]:
    """并发跑所有来源，**总预算是硬上限**：超时的源丢弃，已完成的结果保留。"""
    search_query = build_search_query(query)
    # DeepSeek 带操作符（site: / after: / "精确短语"…）时必须原样传：改写会把操作符
    # 当普通词吃掉，`site:zhipin.com` 就退化成对 "site" 这个词的搜索。
    deepseek_query = query if has_search_operators(query) else search_query
    plans: list[tuple[str, Any]] = []
    for source in sources:
        if source == "bing":
            # Bing 走 ``search_web``，它内部**自己**会调 ``build_search_query``，所以这里传
            # 原句：把已改写好的关键词再喂给它会被二次改写成别的（``build_search_query`` 对
            # 已是关键词列表的输入并不幂等——「互联网大厂 + 招聘」会被再判成"招聘发现类"）。
            plans.append(("bing", _from_bing(query)))
        elif source == "duckduckgo":
            plans.append(("duckduckgo", _from_duckduckgo(search_query, per_source_limit)))
        elif source == "searxng":
            plans.append(
                ("searxng", _from_searxng(search_query, config.searxng_url, per_source_limit))
            )
        elif source == "deepseek":
            plans.append(
                (
                    "deepseek",
                    _from_deepseek(
                        deepseek_query,
                        query,
                        config.deepseek_api_key,
                        need_content=config.page_budget > 0,
                        limit=per_source_limit,
                    ),
                )
            )
        elif source == "tavily":
            plans.append(
                (
                    "tavily",
                    _from_tavily(search_query, config.tavily_api_key, per_source_limit, depth),
                )
            )
        elif source == "jina":
            plans.append(("jina", _from_jina(search_query, config.jina_api_key, per_source_limit)))

    if not plans:
        plans.append(("bing", _from_bing(query)))

    tasks = {
        asyncio.ensure_future(_collect(name, awaitable)): name for name, awaitable in plans
    }
    done, pending = await asyncio.wait(
        tasks.keys(), timeout=SEARCH_BUDGET_SECONDS, return_when=asyncio.ALL_COMPLETED
    )
    groups: list[_Group] = []
    # ``return_exceptions=True`` 是最后一道兜底：``_collect`` 已经吞掉所有普通异常，
    # 这里再兜一次是为了"某个来源以意料之外的方式炸了"也不会让整次搜索没有结果。
    for task, outcome in zip(
        done, await asyncio.gather(*done, return_exceptions=True), strict=False
    ):
        if isinstance(outcome, BaseException):
            logger.warning("来源 %s 以未预期的方式失败：%s", tasks[task], type(outcome).__name__)
            groups.append(
                _Group(
                    source=tasks[task],
                    error_kind=classify_exception(outcome),
                    elapsed_ms=int(SEARCH_BUDGET_SECONDS * 1000),
                    errored=True,
                )
            )
            continue
        groups.append(outcome)
    for task in pending:
        # 超时的来源：丢弃结果但记进 source_status（用户能看出"慢的那个没参与"）。
        name = tasks[task]
        task.cancel()
        logger.warning("来源 %s 超出 %.1f 秒总预算，本次丢弃", name, SEARCH_BUDGET_SECONDS)
        groups.append(
            _Group(
                source=name,
                error_kind=NETWORK,
                elapsed_ms=int(SEARCH_BUDGET_SECONDS * 1000),
                timed_out=True,
                failure="timeout",
            )
        )
    # 保持用户在设置页选的来源顺序（报告顺序要稳定，不能随 task 完成先后变）。
    order = {name: index for index, (name, _aw) in enumerate(plans)}
    groups.sort(key=lambda group: order.get(group.source, 0))
    return groups


async def aggregate_search(
    query: str, config: SearchConfig, limit: int | None = None, *, depth: str | None = None
) -> SearchOutcome:
    """按配置聚合搜索；所有来源都没有结果时抛 ``AssistantSearchError``。

    ``limit`` 是**这一次调用**希望返回的条数（模型可以通过 ``web_search`` 工具传）：
    不传按设置页的 ``max_results``（上限）处理；超过上限夹到上限，小于 1 夹到 1。
    ``config.max_results`` 是上限而不是精确值——"设 30 就一定要 30 条"是做不到的承诺
    （单个来源本身有取数上限、去重与相关性过滤也会减少条数）。

    ``depth`` 是本次调用的搜索深度（工具参数，P4-08）；不传按设置页的 ``depth``。
    """
    sources = config.configured_sources()
    cap = max(1, min(limit if limit is not None else config.max_results, config.max_results))
    # 每个来源多取一些候选：合并去重与相关性过滤会消耗条数，只按 cap 取会拿不满。
    per_source_limit = max(_PER_SOURCE_LIMIT, cap)
    effective_depth = depth if depth in DEPTH_PROFILE else config.depth
    pages, max_passages, total_chars = DEPTH_PROFILE[effective_depth]

    key = build_cache_key(query, sources, effective_depth, cap)
    cached = search_cache.get(key)
    if cached:
        # 命中缓存 = 0 次网络请求（DeepSeek 按次计费，重复查询不该再花钱）。
        logger.info("聚合搜索命中缓存 depth=%s sources=%s", effective_depth, ",".join(sources))
        return SearchOutcome(cached, cached=True, notes=["本次结果来自 8 分钟内的搜索缓存"])

    groups = await _run_sources(query, config, sources, per_source_limit, effective_depth)
    failures = {group.failure for group in groups if group.failure}
    merged = filter_relevant_results(_fuse(groups), query)
    sorted_by_time = _apply_recency(merged, query)
    limited = merged[:cap]

    notes = await _enrich_with_page_text(
        limited,
        query,
        pages=pages,
        max_passages=max_passages,
        total_chars=total_chars,
        api_key=config.deepseek_api_key,
        jina_api_key=config.jina_api_key,
        # 传**本模块**的这两个名字：``conftest`` 的"禁真网"桩与各用例换掉的是
        # ``app.services.search.aggregate.fetch_page_text``，不传就会真的联网。
        page_fetcher=fetch_page_text,
        deepseek_fetcher=fetch_deepseek_text,
    )
    if sorted_by_time:
        # P4-04：降权**不丢弃**，但要让用户知道"这份列表是按时间排的"。
        notes.append("已按时间排序（旧资料仍在列表里，只是排在后面）")
    if any(group.source == "bing" and group.failure == "bad_format" for group in groups):
        notes.append(BING_RSS_EMPTY_MESSAGE)

    status = _build_status(groups)
    logger.info(
        "聚合搜索完成 sources=%s depth=%s cap=%s result_count=%s status=[%s]",
        ",".join(sources),
        effective_depth,
        cap,
        len(limited),
        summarize(status),
    )
    if not limited:
        if failures & _BALANCE_FAILURES:
            raise AssistantSearchError(_BALANCE_MESSAGE)
        if any(group.source == "bing" and group.failure == "bad_format" for group in groups):
            # RSS 解析到 0 条**不是**"这次没搜到"：这是端点结构变了，得让用户知道去换来源。
            raise AssistantSearchError(BING_RSS_EMPTY_MESSAGE)
        raise AssistantSearchError(
            "没有找到与当前问题直接相关的公开来源。可以换成更具体的公司名、岗位名或技术方向再搜一次。"
        )
    if failures:
        # 其它来源有结果时不打断回答，但要把"某个来源这次没参与"留在日志里。
        logger.warning("聚合搜索有来源失败 failures=%s", ",".join(sorted(map(str, failures))))
    # **只缓存成功结果**：失败不缓存，否则一次临时故障会在 TTL 内被反复复述。
    # 缓存里存一份浅拷贝：调用方随后会往 item 里写东西（`numberer.assign` 会加编号）。
    search_cache.set(key, [dict(item) for item in limited])
    return SearchOutcome(limited, source_status=status, notes=notes, sorted_by_time=sorted_by_time)


__all__ = [
    "DEPTH_PROFILE",
    "SEARCH_BUDGET_SECONDS",
    "SearchOutcome",
    "aggregate_search",
]

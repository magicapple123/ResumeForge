# SPDX-License-Identifier: Apache-2.0
"""T07 公司/岗位背景调研 · A 路：应用侧聚合搜索 → 卡片。

为什么调研页要两条路并存（见《01-investigation-summary》§5.2）：

- **A 路（本模块）**：走 ``aggregate_search``（6 源并发 + RRF + 相关性过滤），
  它带得回 ``site_name`` / ``site_icon`` / ``date`` / ``authority`` 四个字段，
  所以卡片能显示站点名、站点图标、发布日期，高权威结果能打「极权威」标；
- **B 路（``company_research_brief``）**：走联网工具（``deepseek_web_search`` +
  ``deepseek_read_url``），产出带编号引用的简报。那条路**没有** authority / date，
  因此卡片一概来自本模块，简报只负责成段叙述。

两条路必须**分开发请求**：同一请求里同时声明 function tool 与联网工具会 400
（官方 ``other tools cannot be used together``）。本模块只做搜索，不碰 chat。

降级策略沿用聚合层既有约定：单条查询失败**不抛异常**，只把失败原因留在
``CardSection.failures`` 里——调研页"有半屏资料"比"整页报错"有用得多。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from ...schemas.setting import SearchConfig
from ..assistant.assistant_web_search import AssistantSearchError
from ..search.aggregate import aggregate_search
from ..search.canonical import canonical_url

logger = logging.getLogger(__name__)

# ---- 卡片预算 ----
# 一屏能读完的上限。9 = 官网 1 + 近期新闻 3 + 基本介绍 5，再多就得滚动，
# 而调研页是"投递前扫一眼"的场景，滚动本身就已经是失败。
MAX_CARDS = 9
# 每类卡片各自的条数上限（与 MAX_CARDS 同时生效，先到者为准）。
MAX_NEWS_CARDS = 3
MAX_OFFICIAL_CARDS = 2
# 卡片摘要不整段搬运：snippet 是检索片段，长了下拉一屏都是废话。
_CARD_TITLE_CHARS = 160
_CARD_SNIPPET_CHARS = 240
# 每次查询最多要几条候选。聚合层内部还会按 cap 截断，这里只是"别浪费钱"。
_PER_QUERY_LIMIT = 6
# 两条查询并发，聚合层自己那条 7 秒预算才是真正的闸门；这里再加一层墙钟兜底，
# 防止「聚合层被 monkeypatch 成不设预算」时调研页无限等下去。
_CARDS_BUDGET_SECONDS = 12.0

# ---- 权威度 ----
# ``authority`` 是 DeepSeek 给出的分数（越大越权威）。实测同一批结果里 4 分以上
# 基本是官网 / 政府站 / 主流媒体，所以拿 4 做「极权威」的门槛，写进常量方便调。
AUTHORITY_HIGH_THRESHOLD = 4.0

# ---- 卡片分类 ----
# 分三档而不是"一条大列表"：用户找的是三件不同的事（官网在哪、最近出什么事、
# 这公司到底是干什么的），混在一起就得自己筛。
CARD_KIND_OFFICIAL = "official"
CARD_KIND_NEWS = "news"
CARD_KIND_OVERVIEW = "overview"
# 「这是官网」的判据。**不复用** ``official_like_score``：那个函数是给"按岗位找公司"
# 用的（只认 .gov.cn/.edu.cn 与招聘页 URL 标记），而调研页要找的是**企业自己的站**，
# 判据完全不同——企业域名猜不出来（腾讯 → tencent.com 没有可推导规律），
# 所以只认两条客观信号：标题自报"官网"，或落在国家/教育/组织域名下。
_OFFICIAL_TITLE_MARKERS = ("官网", "官方网站", "official site", "official website")
_OFFICIAL_HOST_SUFFIXES = (".gov.cn", ".edu.cn", ".org.cn", ".ac.cn")


@dataclass
class CardSection:
    """A 路的产出：卡片 + 实际发出的查询 + 失败原因。"""

    cards: list[dict[str, Any]] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)


def _clean(value: Any, limit: int) -> str:
    """压空白 + 截断；None / 非字符串统一成空串（对外契约是纯 str）。"""
    return " ".join(str(value or "").split())[:limit]


def _host_label(url: str) -> str:
    """站点名为空时的兜底显示：去掉 ``www.`` 的主机名。"""
    try:
        host = (urlsplit(url).hostname or "").casefold()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def parse_authority(raw: Any) -> float | None:
    """把 ``authority`` 解析成数字；解析不出来返回 ``None``（不猜、不当 0）。"""
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    if not text:
        return None
    with contextlib.suppress(ValueError):
        return float(text)
    return None


def _is_high_authority(value: float | None) -> bool:
    return value is not None and value >= AUTHORITY_HIGH_THRESHOLD


def _date_label(item: dict[str, str]) -> str:
    """发布日期：优先 ``date``（DeepSeek 源），退回 ``published_at``（本地源）。

    只取前 10 位（``YYYY-MM-DD``）：格式化交给前端，后端不猜用户时区与写法。
    解析不出真日期时**返回空串**——用抓取时间顶替会让"这条是刚发布的"变成假话。
    """
    raw = _clean(item.get("date") or item.get("published_at"), 40)
    return raw[:10]


def _is_official_result(item: dict[str, str]) -> bool:
    """这条结果是不是"用人单位自己的站"（官网 / 政府 / 教育 / 组织域名）。

    只认两条**客观**信号，不做域名猜测：猜错会把百科页标成官网，比不标更糟。
    """
    title = _clean(item.get("title"), _CARD_TITLE_CHARS).casefold()
    if any(marker in title for marker in _OFFICIAL_TITLE_MARKERS):
        return True
    host = _host_label(str(item.get("url") or ""))
    if not host:
        return False
    return any(host.endswith(suffix) for suffix in _OFFICIAL_HOST_SUFFIXES)


def _card_kind(item: dict[str, str], *, prefer_news: bool) -> str:
    """分类：官网 > 新闻 > 基本介绍。

    ``prefer_news`` 用于「近期新闻」那条查询的结果：那条查询里带日期的就是新闻，
    哪怕站点本身是官网（官网新闻中心也是新闻）。
    """
    official = _is_official_result(item)
    if official and not prefer_news and not _date_label(item):
        return CARD_KIND_OFFICIAL
    if _date_label(item):
        return CARD_KIND_NEWS
    if official:
        return CARD_KIND_OFFICIAL
    return CARD_KIND_OVERVIEW


def _to_card(item: dict[str, str], kind: str) -> dict[str, Any]:
    """一条搜索结果 → 一张卡片（字段全部显式给值，前端不用做存在性判断）。"""
    url = str(item.get("url") or "")
    authority = parse_authority(item.get("authority"))
    return {
        "kind": kind,
        "title": _clean(item.get("title"), _CARD_TITLE_CHARS),
        "url": url,
        "snippet": _clean(item.get("snippet") or item.get("summary"), _CARD_SNIPPET_CHARS),
        "site_name": _clean(item.get("site_name"), 120) or _host_label(url),
        # ``site_icon`` 已由 ``search.deepseek`` 按 http/https 绝对 URL 过滤过；
        # 空串就在前端不渲染 img（绝不拼一个猜测的 favicon 地址去请求第三方）。
        "site_icon": str(item.get("site_icon") or ""),
        "date": _date_label(item),
        "authority": authority,
        # 只有 4 分以上才打「极权威」标：标太滥等于没标。
        "authority_high": _is_high_authority(authority),
    }


def build_queries(company: str, role: str = "") -> list[str]:
    """A 路要发哪两条查询（官网/基本信息 一条，近期新闻 一条）。

    刻意只发两条：搜索按请求计费，调研页是一个用户会反复点的入口，
    每条查询都要能单独解释"为什么发它"。
    """
    name = _clean(company, 80)
    if not name:
        return []
    queries = [f"{name} 公司简介 官网 主营业务"]
    # 岗位名进新闻查询没有意义（新闻是按公司写的），但进第一条能让"这条路在招
    # 什么人"出现在结果里，所以岗位只拼进基本信息那条。
    if role.strip():
        queries[0] = f"{name} {_clean(role, 40)} 公司简介 官网 业务"
    queries.append(f"{name} 最新消息 新闻 动态")
    return queries


async def _one_query(query: str, config: SearchConfig) -> tuple[str, list[dict[str, str]], str]:
    """跑一条查询，返回 ``(query, 结果, 失败原因)``；失败原因空串表示没问题。

    ``depth="snippet"``：卡片只要标题/摘要/站点信息，不需要正文——抓正文会让
    每条查询多花几次 fetch，而简报那条路本来就会读页面。
    """
    try:
        results = await aggregate_search(query, config, limit=_PER_QUERY_LIMIT, depth="snippet")
    except AssistantSearchError as exc:
        logger.info("调研卡片查询失败 query=%r reason=%s", query, exc.public_message)
        return query, [], exc.public_message
    except Exception:  # noqa: BLE001 - 卡片是锦上添花，不能把整页拖垮
        logger.exception("调研卡片查询发生内部错误 query=%r", query)
        return query, [], "搜索服务暂时不可用"
    return query, [dict(item) for item in results], ""


def _dedupe(items: list[dict[str, str]]) -> list[dict[str, str]]:
    """按 canonical URL 去重，保留首次出现的那条（先到的查询优先）。"""
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for item in items:
        url = str(item.get("url") or "")
        if not url:
            continue
        key = canonical_url(url) or url.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _assemble(pairs: list[tuple[str, list[dict[str, str]]]]) -> list[dict[str, Any]]:
    """把两条查询的结果拼成卡片列表：官网 → 新闻（新→旧）→ 其它。"""
    tagged: list[tuple[dict[str, str], str]] = []
    for query, items in pairs:
        prefer_news = "新闻" in query or "动态" in query
        for item in items:
            tagged.append((item, _card_kind(item, prefer_news=prefer_news)))

    official: list[dict[str, Any]] = []
    news: list[dict[str, Any]] = []
    overview: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for item, kind in tagged:
        card = _to_card(item, kind)
        if not card["title"] or not card["url"]:
            continue
        # 同标题不同 URL 的转载页（常见于新闻通稿）只留第一条。
        title_key = card["title"].casefold()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        if kind == CARD_KIND_OFFICIAL:
            official.append(card)
        elif kind == CARD_KIND_NEWS:
            news.append(card)
        else:
            overview.append(card)

    # 新闻按日期降序；没有日期的排后面（保持原始名次，不假装它是最新的）。
    news.sort(key=lambda card: card["date"] or "", reverse=True)
    # 官方域名天然权威，按权威度再排一次让最官方的那条当第一张。
    official.sort(key=lambda card: card["authority"] or 0.0, reverse=True)

    ordered = official[:MAX_OFFICIAL_CARDS] + news[:MAX_NEWS_CARDS] + overview
    return ordered[:MAX_CARDS]


async def build_company_cards(company: str, role: str, config: SearchConfig) -> CardSection:
    """A 路入口：并发两条查询 → 去重 → 分类 → 卡片。

    永不抛异常（除非调用方传了空公司名，那属于调用方 bug，由编排层先拦）。
    """
    queries = build_queries(company, role)
    if not queries:
        return CardSection()

    tasks = [asyncio.ensure_future(_one_query(query, config)) for query in queries]
    positions = {task: index for index, task in enumerate(tasks)}
    done, pending = await asyncio.wait(tasks, timeout=_CARDS_BUDGET_SECONDS)
    for task in pending:
        task.cancel()
        logger.warning("调研卡片查询超出 %.1f 秒预算，本次丢弃", _CARDS_BUDGET_SECONDS)
    # 取消后仍要收一次结果，否则会留下 "Task exception was never retrieved" 噪音。
    outcomes = await asyncio.gather(*done, return_exceptions=True)

    # **必须按计划顺序回填**：去重规则是"先到的那条留下"，顺序一变，保留哪条副本
    # 就成了并发调度的结果（官网/新闻两条查询会给出同一篇文章的不同写法）。
    collected: list[tuple[int, Any]] = [
        (positions[task], outcome) for task, outcome in zip(done, outcomes, strict=False)
    ]
    collected.sort(key=lambda pair: pair[0])

    pairs: list[tuple[str, list[dict[str, str]]]] = []
    failures: list[str] = []
    for _position, outcome in collected:
        if isinstance(outcome, BaseException):
            logger.warning("调研卡片查询以未预期的方式失败：%s", type(outcome).__name__)
            failures.append("搜索服务暂时不可用")
            continue
        query, items, failure = outcome
        pairs.append((query, items))
        if failure:
            failures.append(failure)

    cards = _assemble(pairs)
    logger.info(
        "调研卡片完成 queries=%s cards=%s official=%s news=%s failures=%s",
        len(queries),
        len(cards),
        sum(1 for card in cards if card["kind"] == CARD_KIND_OFFICIAL),
        sum(1 for card in cards if card["kind"] == CARD_KIND_NEWS),
        len(failures),
    )
    return CardSection(cards=cards, queries=queries, failures=failures)


__all__ = [
    "AUTHORITY_HIGH_THRESHOLD",
    "CARD_KIND_NEWS",
    "CARD_KIND_OFFICIAL",
    "CARD_KIND_OVERVIEW",
    "MAX_CARDS",
    "CardSection",
    "build_company_cards",
    "build_queries",
    "parse_authority",
]

# SPDX-License-Identifier: Apache-2.0
"""受限的 Bing RSS 搜索，只返回公开结果摘要，不抓取结果页面。"""

import html
import logging
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx

from .assistant_web_search_rules import (
    _deduplicate,
    _normalized_query,
    build_search_query,
    filter_relevant_results,
    rank_results,
)
from .assistant_web_search_rules import (
    _matched_career_terms as _matched_career_terms,
)
from .assistant_web_search_rules import (
    is_third_party_source as is_third_party_source,
)
from .assistant_web_search_rules import (
    official_like_score as official_like_score,
)
from .search_errors import BING_RSS_EMPTY_MESSAGE as BING_RSS_EMPTY_MESSAGE
from .search_errors import AssistantSearchError as AssistantSearchError

logger = logging.getLogger(__name__)

BING_SEARCH_URL = "https://cn.bing.com/search"
_FALLBACK_SEARCH_URL = "https://www.bing.com/search"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
# 返回上限提到 8：搜索摘要本来就是线索而非结论，给模型更多可挑选的来源比少而精
# 更有用（筛选规则仍在，明显无关的结果不会进来）。
_MAX_RESULTS = 8
_MAX_CANDIDATE_RESULTS = 15
_TAG_RE = re.compile(r"\s+")
_RESUMEFORGE_MARKERS = (
    "简历通",
    "resumeforge",
    "求职助手",
    "简历预览",
    "求职统计界面",
    "求职进度界面",
)
_LOCAL_APP_ACTION_MARKERS = (
    "怎么",
    "如何",
    "什么是",
    "能做什么",
    "介绍",
    "文档",
    "指南",
    "关于",
    "使用",
    "在哪",
    "哪里",
    "按钮",
    "功能",
    "设置",
    "更新",
    "安装",
    "打开",
    "修改",
    "删除",
    "查询",
    "有没有",
    "能不能",
    "是否",
)


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _plain_text(value: str, max_chars: int) -> str:
    parser = _HTMLTextExtractor()
    try:
        parser.feed(value)
        parser.close()
        text = " ".join(parser.parts)
    except Exception:  # noqa: BLE001 - 搜索摘要损坏时退回实体解码文本
        text = html.unescape(value)
    text = _TAG_RE.sub(" ", text).strip()
    return text[:max_chars]


def _child_text(node: ET.Element, name: str) -> str:
    # 两边都 casefold：RSS 的标签大小写不统一（`pubDate` vs `pubdate`），
    # 只折一边会让 `pubDate` 永远取不到——"日期全丢"就是这样发生的。
    wanted = name.casefold()
    for child in node:
        if child.tag.rsplit("}", 1)[-1].casefold() == wanted:
            return child.text or ""
    return ""


def _safe_result_url(value: str) -> str:
    value = value.strip()
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return ""
    if parsed.username or parsed.password:
        return ""
    return value[:2048]


def is_local_resume_forge_question(value: str) -> bool:
    """判断问题是不是在问 ResumeForge 自身的用法。

    这类问题的权威资料在本地能力地图、README 和使用指南里。即使用户打开了联网开关，
    也不应把「简历通怎么用」送进公开搜索，否则很容易拿到无关的同名产品或通用简历文章。
    该判断只用于拦截模型误用搜索（``web_search`` 工具会直接回一段本地指引、不打网络），
    不影响用户查询外部招聘信息。
    """
    normalized = _normalized_query(value).casefold()
    if not normalized:
        return False
    has_product = any(marker.casefold() in normalized for marker in _RESUMEFORGE_MARKERS)
    has_action = any(marker.casefold() in normalized for marker in _LOCAL_APP_ACTION_MARKERS)
    return has_product and has_action


def parse_bing_rss(xml_bytes: bytes, limit: int = _MAX_RESULTS) -> list[dict[str, str]]:
    """解析体积已受限的 RSS；显式拒绝 DTD/实体声明，避免 XML 实体展开。

    ``pubDate`` 归一成 ``published_at``（ISO）：用户的原话是「不要引入过时东西」，
    而旧实现把它整条丢掉，于是 2021 年的招聘公告和上周的岗位在模型眼里一模一样。
    解析不出来就**不带这个字段**（下游显示「日期未知」），绝不用抓取时间顶替。
    """
    upper = xml_bytes.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise AssistantSearchError("联网搜索返回了不安全的响应格式")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise AssistantSearchError("联网搜索返回了无法解析的响应") from exc

    results: list[dict[str, str]] = []
    # 函数级 import：``services.search`` 的 ``__init__`` 会导入聚合层，而聚合层又导入本模块，
    # 模块级 import 会在这条路径上形成循环（``canonical`` / ``passages`` 同理）。
    from ..search.dates import parse_published_at

    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1].casefold() != "item":
            continue
        url = _safe_result_url(_child_text(node, "link"))
        title = _plain_text(_child_text(node, "title"), 300)
        if not url or not title:
            continue
        item = {
            "title": title,
            "url": url,
            "snippet": _plain_text(_child_text(node, "description"), 1000),
        }
        published = parse_published_at(_child_text(node, "pubDate"))
        if published:
            item["published_at"] = published
        results.append(item)
        if len(results) >= max(1, min(limit, _MAX_CANDIDATE_RESULTS)):
            break
    return results


async def _fetch_rss_once(url: str, query: str) -> bytes:
    timeout = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
    headers = {
        "Accept": "application/rss+xml, application/xml;q=0.9",
        "User-Agent": "ResumeForge/0.2 (+local career assistant)",
    }
    try:
        async with (
            httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client,
            client.stream(
                "GET",
                url,
                params={"q": query, "format": "rss", "mkt": "zh-CN", "setlang": "zh-hans"},
                headers=headers,
            ) as response,
        ):
            if response.status_code != 200:
                logger.warning("Bing RSS 搜索失败 status=%s", response.status_code)
                raise AssistantSearchError("联网搜索服务暂时不可用，请稍后重试")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > _MAX_RESPONSE_BYTES:
                    raise AssistantSearchError("联网搜索返回内容过大，已停止读取")
                body.extend(chunk)
    except httpx.TimeoutException as exc:
        raise AssistantSearchError("联网搜索响应超时，请稍后重试") from exc
    except httpx.RequestError as exc:
        raise AssistantSearchError("无法连接联网搜索服务，请检查网络状态") from exc
    return bytes(body)


async def fetch_bing_rss(query: str) -> bytes:
    """请求固定 Bing 端点；不跟随重定向，也不记录用户查询。

    国内网络走 ``cn.bing.com``，它不可用时退回 ``www.bing.com``——两个端点返回同一种
    RSS，多一次尝试就能覆盖"某个域被拦但另一个可用"的情况。
    """
    last_error: AssistantSearchError | None = None
    for url in (BING_SEARCH_URL, _FALLBACK_SEARCH_URL):
        try:
            return await _fetch_rss_once(url, query)
        except AssistantSearchError as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


async def search_web(query: str) -> list[dict[str, str]]:
    """执行一次受限 Bing RSS 搜索：查询改写 → 抓取 → 过滤去重 → 排序；零结果抛 AssistantSearchError。"""
    normalized = _normalized_query(query)
    if not normalized:
        raise AssistantSearchError("请先输入要搜索的内容")
    search_query = build_search_query(normalized)
    candidates = parse_bing_rss(await fetch_bing_rss(search_query), limit=_MAX_CANDIDATE_RESULTS)
    if not candidates:
        # 「解析到 0 条」与「有候选但都被相关性过滤掉」是两件事，必须分开报：
        # 前者是端点结构变了（换来源/等修复），后者是换关键词就能解决。
        raise AssistantSearchError(BING_RSS_EMPTY_MESSAGE)
    results = rank_results(_deduplicate(filter_relevant_results(candidates, normalized)))[
        :_MAX_RESULTS
    ]
    if not results:
        # 零结果就如实报错，**不再**以"问题含已知求职词"为前提：那样非求职类问题即使被
        # 过滤得一条不剩也会静默返回空，模型可能据此瞎编。报错会让调用方明确"没拿到资料"。
        raise AssistantSearchError(
            "没有找到与当前问题直接相关的公开来源。可以换成更具体的公司名、岗位名或技术方向再搜一次。"
        )
    logger.info("Bing RSS 搜索完成 result_count=%s", len(results))
    return results

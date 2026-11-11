# SPDX-License-Identifier: Apache-2.0
"""正文补全与选段（P4-06 / P4-07 / P4-09 / P4-10 的实现处）。

从 ``aggregate.py`` 拆出来，理由有两个：

- ``aggregate.py`` 已经贴着 500 行预算（单文件上限），继续往里加会破坏守卫；
- 这一段是**纯编排**（谁去抓、抓回来怎么选段），与"并发调度 + 融合 + 排序"不是一回事，
  混在一个文件里改一处要读两遍。

流程：

1. 免抓名单（``domains.is_summary_only``）直接跳过，保留搜索给的 snippet；
2. 已经有正文的（DeepSeek/Tavily/Jina 一次就带回了）不重复抓；
3. 其余先试 ``/tools/fetch``（DeepSeek 账号级不可用时整段回落），再本地抓；
   本地抽出空串时才走 ``r.jina.ai`` 兜底（``page_reader`` 的 ``reader_fallback``）；
4. 所有正文交给 ``passages.select_context`` 按**总字符预算**选段，0 命中的页整页跳过。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .deepseek import DeepSeekUnavailable, fetch_deepseek_text
from .domains import is_summary_only
from .page_reader import fetch_page_text
from .passages import select_context
from .providers.jina import read_jina_page

logger = logging.getLogger(__name__)

# 超出档位页数预算的结果仍带正文时（DeepSeek/Tavily 一次就给了），只留这么多字符：
# 它们不进"选段"，给个能判断相关性的片段即可，别挤掉真正被选中的那几段。
CONTENT_EXCERPT_CHARS = 1_200


def jina_reader(api_key: str):
    """把 ``r.jina.ai`` 包成 ``page_reader`` 的兜底回调（无 key 时返回 None）。

    返回 ``None`` 而不是一个空实现：``fetch_page_text`` 用它判断"有没有兜底"，
    没配 key 时就该完全走本地路径，连一次空调用都不该有。
    """
    if not api_key:
        return None

    async def _reader(url: str, max_chars: int) -> str:
        return await read_jina_page(url, api_key=api_key, max_chars=max_chars)

    return _reader


async def enrich_with_page_text(
    # 值不是纯字符串：``passages`` 是 ``[{"index", "title"}]``（见 ``passages.select_context``）。
    results: list[dict[str, Any]],
    query: str,
    *,
    pages: int,
    max_passages: int,
    total_chars: int,
    api_key: str = "",
    jina_api_key: str = "",
    page_fetcher: Callable[..., Awaitable[str]] | None = None,
    deepseek_fetcher: Callable[[str, str], Awaitable[str]] | None = None,
) -> list[str]:
    """为前 ``pages`` 条补正文并选段；返回给人看的说明（进 ``notes``）。

    ``page_fetcher`` / ``deepseek_fetcher`` 由调用方（``aggregate``）传入**它模块里的
    那一个**，而不是在这里直接引用导入名：测试与 ``conftest`` 的"禁真网"桩替换的是
    ``aggregate`` 模块上的名字，这里若用本模块的导入名，桩就不生效、测试会真的联网。
    """
    page_fetch = page_fetcher or fetch_page_text
    deepseek_fetch = deepseek_fetcher or fetch_deepseek_text
    notes: list[str] = []
    targets = results[:pages] if pages > 0 else []
    if not targets or max_passages <= 0 or total_chars <= 0:
        return notes

    # 免抓名单（P4-06）：知乎/公众号/小红书这类站点对非浏览器请求返回登录墙，
    # 抓到的"正文"比摘要还少，还白挨一次风控。
    skipped = [item for item in targets if is_summary_only(str(item.get("url") or ""))]
    fetchable = [item for item in targets if not is_summary_only(str(item.get("url") or ""))]
    if skipped:
        notes.append(f"{len(skipped)} 条结果来自需要登录的站点，只展示摘要")

    # 搜索阶段已经带回正文的条目直接沿用，不重复抓（那正是 need_content 的价值）。
    if api_key:
        pending = [item for item in fetchable if not str(item.get("text") or "").strip()]
        if pending:
            try:
                fetched = await asyncio.gather(
                    *(deepseek_fetch(str(item["url"]), api_key) for item in pending)
                )
                for item, text in zip(pending, fetched, strict=False):
                    if text:
                        item["text"] = text
            except DeepSeekUnavailable:
                # 账号级不可用：逐条再试只是多打几次网络，直接整段回落本地。
                logger.info("DeepSeek 抓取不可用，本次正文补全整段回落本地")

    missing = [item for item in fetchable if not str(item.get("text") or "").strip()]
    if missing:
        reader = jina_reader(jina_api_key)
        fallback = await asyncio.gather(
            *(page_fetch(str(item["url"]), reader_fallback=reader) for item in missing)
        )
        for item, text in zip(missing, fallback, strict=False):
            if text:
                item["text"] = text

    payload = [
        {"url": str(item.get("url") or ""), "text": str(item.get("text") or "")}
        for item in fetchable
        if str(item.get("text") or "").strip()
    ]
    if not payload:
        return notes
    selected = select_context(payload, query, max_passages=max_passages, total_chars=total_chars)
    by_url = {str(entry["url"]): entry for entry in selected}
    target_ids = {id(item) for item in targets}
    for item in results:
        url = str(item.get("url") or "")
        if id(item) in target_ids:
            # 预算内的条目**只保留选段**：没有命中任何查询词项的页整页跳过
            # （把一屏导航塞给模型比不给更糟）。
            item.pop("text", None)
            item.pop("passages", None)
            entry = by_url.get(url)
            if entry is not None:
                item["text"] = str(entry["text"])
                # ``select_context`` 里是 ``[{"index", "title"}]``；类型上它是 object，
                # 但原样透传即可（下游只做 JSON 序列化），不必逐个字段重建。
                passages = entry["passages"]
                if isinstance(passages, list):
                    item["passages"] = passages
        else:
            # 预算外的条目：来源自带正文（DeepSeek/Tavily）就留个短摘，不参与选段。
            text = str(item.get("text") or "")
            if text:
                item["text"] = text[:CONTENT_EXCERPT_CHARS]
    return notes


__all__ = ["CONTENT_EXCERPT_CHARS", "enrich_with_page_text", "jina_reader"]

# SPDX-License-Identifier: Apache-2.0
"""正文分块选段（P4-07）：把「整页正文」变成「与问题相关的 2~3 段」。

## 为什么不是 ``text[:1200]``

旧实现取 ``results[:count]`` 再 ``text[:1200]`` 头部截断。绝大多数页面开头是**导航、
面包屑、Cookie 提示、相关推荐**，于是模型读到的是一屏菜单的拼接，答案在第 5 段也读不到
（实测：答案段落在 1200 字之后时，旧实现命中率是 0）。

## 做法（纯函数，无 IO，无全局状态）

1. 滑窗切块：目标 400 字、步长 = 400 − 60 重叠（切点尽量落在空白处，英文单词不截断；
   没有任何分隔符的超长单段也能切）；
2. 打分：复用 ``filter_relevant_results`` 的**同一套词项提取**（``_matched_career_terms``，
   按出现顺序、越靠前权重越高），命中次数 × 权重求和；
3. 取 top N 块（``score > 0``），按块序还原成人能读的顺序后拼成 ``text``；
4. **0 命中的页整页跳过**（调用方只保留摘要）——把 1200 字导航塞给模型比不给更糟；
5. 预算按**总字符**分配（见 :func:`select_context`），不是每页均分；
6. 跨页按正文前 80 字指纹去重（同一篇文章被两个来源抓到时不重复占预算）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: 切块目标长度（题面要求 300–400 字一带）。
CHUNK_TARGET_CHARS = 400
#: 相邻块的重叠长度：答案正好横跨切点时，两侧各留 60 字就不会丢。
CHUNK_OVERLAP_CHARS = 60
#: 未命中任何词项的块不参与拼装；拼装时的上限由调用方（档位预算）决定。
PASSAGE_TITLE_CHARS = 40
FINGERPRINT_CHARS = 80
#: 单页最少也要给这么多字符，否则 deep 档 5 页会把预算切得太碎（每页 800 → 够 2 段）。
MIN_PAGE_CHARS = 400

_SEPARATOR_RE = re.compile(r"[\s\u3000，。！？、；：,.!?;:()（）\[\]【】\"'“”‘’]+")
_ASCII_WORD = re.compile(r"[a-z0-9]")
_CHUNK_TITLE_TAIL = ("…",)


@dataclass(frozen=True)
class Passage:
    """一个命中块：``index`` 是它在本页正文里的块序（0 起）。"""

    index: int
    text: str
    score: float


def _advance(text: str, start: int, end: int) -> int:
    """算下一块的起点：先按重叠回退，再保证至少前进 1 个字（否则死循环）。"""
    step = max(1, end - start - CHUNK_OVERLAP_CHARS)
    return start + step


def chunk_text(
    text: str,
    *,
    target: int = CHUNK_TARGET_CHARS,
    overlap: int = CHUNK_OVERLAP_CHARS,
) -> list[Passage]:
    """把正文切成互相重叠的块；空正文返回空列表。

    切点优先落在空白/标点上（在 ``target`` 前后 40 字内找最近的边界），找不到就硬切——
    超长单段（没有换行、没有标点的 JSON/日志页）也必须能切，这是"超长单段"用例。
    """
    body = (text or "").strip()
    if not body:
        return []
    if len(body) <= target:
        return [Passage(index=0, text=body, score=0.0)]

    chunks: list[Passage] = []
    start = 0
    while start < len(body):
        end = min(start + target, len(body))
        if end < len(body):
            window = body[start + target - 40 : end + 40]
            boundary = max(window.rfind(" "), window.rfind("\n"), window.rfind("。"))
            if boundary > 40:
                end = min(len(body), start + target - 40 + boundary + 1)
        piece = body[start:end].strip()
        if piece:
            chunks.append(Passage(index=len(chunks), text=piece, score=0.0))
        if end >= len(body):
            break
        start = _advance(body, start, end)
        # 防御：任何情况下都要前进，否则 while 会变成死循环（改坏这条会挂住整次搜索）。
        if start <= 0 or start >= len(body):
            break
    return chunks


def query_terms(query: str) -> list[tuple[str, float]]:
    """查询词项与权重：复用 ``filter_relevant_results`` 的分词（不写第二份词典）。

    权重：越靠前的词项越重（``1.0 + 0.5 × (n − i − 1) / max(1, n − 1)``），
    因为 ``build_search_query`` 输出的顺序本身就是"主体 → 限定 → 招聘词"。
    没有任何已知求职词时退回按分隔符切分（保留长度 ≥ 2 的片段）。
    """
    # 函数级 import：``services.search`` 包被 ``assistant_web_search`` 反向依赖，
    # 模块级 import 会构成循环（见 canonical.py 的同一条说明）。
    from ..assistant.assistant_web_search import _matched_career_terms

    normalized = " ".join(str(query or "").split())
    if not normalized:
        return []
    matched = _matched_career_terms(normalized)
    terms = [term for term in matched if term]
    if not terms:
        seen: set[str] = set()
        for piece in _SEPARATOR_RE.split(normalized.casefold()):
            piece = piece.strip()
            if len(piece) >= 2 and piece not in seen:
                seen.add(piece)
                terms.append(piece)
    if not terms:
        return []
    count = len(terms)
    return [
        (term.casefold(), 1.0 + 0.5 * (count - index - 1) / max(1, count - 1))
        for index, term in enumerate(terms)
    ]


def _count(text: str, term: str) -> int:
    """英文词项按词边界计数（避免 ``java`` 命中 ``javascript``），中文按子串计数。"""
    if not term:
        return 0
    if _ASCII_WORD.search(term):
        pattern = re.compile(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])")
        return len(pattern.findall(text))
    return text.count(term)


def score_text(terms: list[tuple[str, float]], text: str) -> float:
    """词项加权命中分；同一词项多次出现最多计 3 次（防止关键词堆砌刷分）。"""
    haystack = (text or "").casefold()
    if not haystack or not terms:
        return 0.0
    total = 0.0
    for term, weight in terms:
        hits = _count(haystack, term)
        if hits:
            total += weight * min(hits, 3)
    return total


def rank_passages(text: str, query: str) -> list[Passage]:
    """按得分降序返回本页所有块（同分按块序，保证结果确定）。"""
    terms = query_terms(query)
    if not terms:
        return []
    scored = [
        Passage(index=chunk.index, text=chunk.text, score=score_text(terms, chunk.text))
        for chunk in chunk_text(text)
    ]
    scored.sort(key=lambda passage: (-passage.score, passage.index))
    return scored


def passage_title(text: str) -> str:
    """块标题：正文前 40 字（够人一眼认出是哪一段），截断时补省略号。"""
    body = " ".join((text or "").split())
    if len(body) <= PASSAGE_TITLE_CHARS:
        return body
    return body[:PASSAGE_TITLE_CHARS] + _CHUNK_TITLE_TAIL[0]


def select_passages(
    text: str, query: str, *, max_passages: int = 2, max_chars: int = 1800
) -> list[Passage]:
    """选段：top N 命中块（``score > 0``），按块序还原，总长不超过 ``max_chars``。

    预算不够时**保留分最高的那一段**而不是"按顺序先塞满"——排第一的块就是最像答案的。
    """
    if max_passages <= 0 or max_chars <= 0:
        return []
    ranked = [passage for passage in rank_passages(text, query) if passage.score > 0]
    if not ranked:
        return []
    chosen = ranked[:max_passages]
    chosen.sort(key=lambda passage: passage.index)

    kept: list[Passage] = []
    used = 0
    for passage in chosen:
        if kept and used + len(passage.text) > max_chars:
            continue
        kept.append(passage)
        used += len(passage.text)
    return kept


def fingerprint(text: str, *, chars: int = FINGERPRINT_CHARS) -> str:
    """跨页去重指纹：正文前 ``chars`` 个非空白字符（同一篇文章转载后仍然相同）。"""
    return "".join((text or "").split())[:chars].casefold()


def select_context(
    pages: list[dict[str, str]],
    query: str,
    *,
    max_passages: int,
    total_chars: int,
) -> list[dict[str, object]]:
    """按**总字符**预算给每页选段；返回 ``[{url, text, passages:[{index,title}]}]``。

    - 预算不按页均分：每页先按"剩余预算 ÷ 剩余页数"拿一个份额，用不完的留给后面的页；
    - 0 命中的页不返回（调用方据此只保留摘要）；
    - 跨页指纹相同的页（同一篇文章的镜像）只取第一份。
    """
    budget = max(0, int(total_chars))
    result: list[dict[str, object]] = []
    seen: set[str] = set()
    if budget <= 0 or max_passages <= 0:
        return result

    for position, page in enumerate(pages):
        remaining_pages = max(1, len(pages) - position)
        if budget <= 0:
            break
        text = str(page.get("text") or "")
        if not text.strip():
            continue
        mark = fingerprint(text)
        if mark and mark in seen:
            continue
        share = max(MIN_PAGE_CHARS, budget // remaining_pages)
        cap = min(budget, share, max_passages * CHUNK_TARGET_CHARS)
        picked = select_passages(text, query, max_passages=max_passages, max_chars=cap)
        if not picked:
            continue
        if mark:
            seen.add(mark)
        joined = "\n".join(passage.text for passage in picked)
        budget -= len(joined)
        result.append(
            {
                "url": str(page.get("url") or ""),
                "text": joined,
                "passages": [
                    {"index": passage.index, "title": passage_title(passage.text)}
                    for passage in picked
                ],
            }
        )
    return result


__all__ = [
    "CHUNK_OVERLAP_CHARS",
    "CHUNK_TARGET_CHARS",
    "FINGERPRINT_CHARS",
    "MIN_PAGE_CHARS",
    "PASSAGE_TITLE_CHARS",
    "Passage",
    "chunk_text",
    "fingerprint",
    "passage_title",
    "query_terms",
    "rank_passages",
    "score_text",
    "select_context",
    "select_passages",
]

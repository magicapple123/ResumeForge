# SPDX-License-Identifier: Apache-2.0
"""知识库的切块与混合检索（#29A）。

现状：services/rag 的索引只覆盖简历资料条目（ConsumedProfile 的 chunk），知识库
（knowledge_entry）在 rag 链路上零命中——助手只能靠关键词 LIKE 找条目。

做法：不新建第二套检索栈，而是把知识条目切成 chunk 后复用 rag_hybrid 的数学：
- 切块：按 Markdown 标题（#/##/###）切；没有标题就按长度窗口切（每块 <=600 字）；
- 关键词路：标题 / 摘要+要点 / 正文里的查询词命中（标题与摘要加权）；
- 向量路：调用方传入 query_vector 与 chunk_vectors 时才启用（真实模型走
  services/llm/embeddings 的现有运行时，不起第二份模型）；未配置/失败 → 只回退
  关键词路（与 rag_service 的"失败即回退"同一语义，绝不把异常抛给调用方）；
- 融合：复用 rag_hybrid.fuse_rrf（RRF 对两路量纲不敏感，比手工加权稳）；
- 返回 {id, title, snippet, score}；snippet 优先摘要（#29E：命中优先返回摘要省 token），
  没有摘要才回落到命中 chunk 的正文片段。

为什么不做常驻索引：知识库是用户手写的几十到几百条，进程内缓存还要处理编辑/软删/
恢复的失效；每次检索重算的代价在这个量级上可以忽略（与 rag_index 的请求级热点不同）。
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models.knowledge_entry import KnowledgeEntry
from . import trash
from .rag.rag_hybrid import RankedHit, cosine_similarity, fuse_rrf

#: 单个 chunk 的最大字符数（无标题长文按窗口切）。
MAX_CHUNK_CHARS = 600
#: 一次检索最多处理的条目数（知识库规模上限，挡住异常数据）。
MAX_CANDIDATES = 1000
#: 关键词路的候选条数（RRF 只关心名次，不需要全量）。
KEYWORD_RANK_LIMIT = 30
#: 向量路的候选条数。
VECTOR_RANK_LIMIT = 30
#: snippet 的最大字符数。
SNIPPET_CHARS = 160

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


@dataclass(frozen=True)
class KnowledgeChunk:
    """一条知识条目切出的一块正文。chunk_id 用于向量映射（entry_id:序号）。"""

    chunk_id: str
    entry_id: int
    heading: str
    text: str
    #: 条目标题（向量化时与 heading/text 一起编码：标题本身往往就是最强语义信号）。
    title: str = ""


def chunk_embedding_text(chunk: KnowledgeChunk) -> str:
    """一块 chunk 的向量化输入：标题 + 小节标题 + 正文（标题缺了才轮到小节标题）。"""
    parts = [part for part in (chunk.title, chunk.heading, chunk.text) if part]
    return "\n".join(parts)


@dataclass(frozen=True)
class KnowledgeHit:
    """一条检索命中：正文仍由 get_knowledge 取，这里只给定位与摘要。"""

    entry_id: int
    title: str
    snippet: str
    score: float
    matched_heading: str = ""
    used_vector: bool = False


def split_markdown_chunks(entry: KnowledgeEntry) -> tuple[KnowledgeChunk, ...]:
    """按 Markdown 标题切块；标题段本身不单独成块（避免只有标题的空 chunk）。"""
    content = entry.content or ""
    source = content.strip() or (entry.summary or entry.reason or entry.title or "")
    if not source.strip():
        return ()
    chunks: list[KnowledgeChunk] = []
    heading = ""
    buffer: list[str] = []

    def flush() -> None:
        text = "\n".join(buffer).strip()
        if text:
            chunks.append(
                KnowledgeChunk(
                    chunk_id=f"{entry.id}:{len(chunks)}",
                    entry_id=int(entry.id),
                    heading=heading,
                    text=text,
                    title=entry.title or "",
                )
            )

    for line in source.splitlines():
        match = _HEADING.match(line.strip())
        if match is not None:
            flush()
            heading = match.group(2).strip()
            buffer = []
            continue
        buffer.append(line)
    flush()
    if not chunks:
        # 没有正文可切（只有标题）：用标题兜一块，保证关键词路仍能命中标题。
        chunks.append(
            KnowledgeChunk(
                chunk_id=f"{entry.id}:0",
                entry_id=int(entry.id),
                heading="",
                text=entry.title or "",
                title=entry.title or "",
            )
        )
    # 无标题超长正文：按窗口切，保证每块都进得了 embedding 的输入预算。
    windowed: list[KnowledgeChunk] = []
    for chunk in chunks:
        for offset in range(0, len(chunk.text), MAX_CHUNK_CHARS):
            piece = chunk.text[offset : offset + MAX_CHUNK_CHARS]
            windowed.append(
                KnowledgeChunk(
                    chunk_id=f"{chunk.entry_id}:{len(windowed)}",
                    entry_id=chunk.entry_id,
                    heading=chunk.heading,
                    text=piece,
                    title=chunk.title,
                )
            )
    return tuple(windowed)


def entry_chunks(
    db: Session, *, limit: int = MAX_CANDIDATES
) -> dict[int, tuple[KnowledgeChunk, ...]]:
    """当前全库（未删除）条目的切块结果；供向量路一次性编码。"""
    rows = (
        db.query(KnowledgeEntry)
        .filter(trash.live_only(KnowledgeEntry))
        .order_by(KnowledgeEntry.id.desc())
        .limit(limit)
        .all()
    )
    result: dict[int, tuple[KnowledgeChunk, ...]] = {}
    for entry in rows:
        chunks = split_markdown_chunks(entry)
        if chunks:
            result[int(entry.id)] = chunks
    return result


def _query_terms(query: str) -> list[str]:
    """查询词与二元 shingle（中文没有空格，双字滑窗是最便宜的近似）。"""
    term = (query or "").strip().casefold()
    if not term:
        return []
    terms = [term]
    if len(term) > 2:
        terms.extend(term[i : i + 2] for i in range(len(term) - 1))
    return list(dict.fromkeys(terms))


def keyword_score(query: str, entry: KnowledgeEntry) -> float:
    """关键词路打分：标题权重最高，摘要/要点次之，正文再次。"""
    terms = _query_terms(query)
    if not terms:
        return 0.0
    title = (entry.title or "").casefold()
    summary = " ".join([entry.summary or "", " ".join(entry.key_points or [])]).casefold()
    body = (entry.content or "").casefold()
    score = 0.0
    for term in terms:
        weight = 1.0 if len(term) == 2 else 2.0
        score += weight * (title.count(term) * 6 + summary.count(term) * 3 + body.count(term))
    return round(score, 4)


def _snippet(entry: KnowledgeEntry, chunks: Sequence[KnowledgeChunk], match_index: int) -> str:
    """摘要优先（#29E），没有摘要才回落到命中 chunk 的正文片段。"""
    summary = (entry.summary or "").strip()
    if summary:
        return summary[:SNIPPET_CHARS]
    if match_index < len(chunks):
        text = chunks[match_index].text.replace("\n", " ").strip()
        if text:
            return text[:SNIPPET_CHARS]
    return (entry.title or "")[:SNIPPET_CHARS]


def _rank(hits: list[RankedHit]) -> list[RankedHit]:
    """按分数降序编号名次（RRF 只吃名次；同分保持原顺序）。"""
    hits.sort(key=lambda hit: (-hit.score, hit.rank))
    return [
        RankedHit(
            canonical_item_hash=hit.canonical_item_hash,
            section_key=hit.section_key,
            rank=index,
            score=hit.score,
        )
        for index, hit in enumerate(hits, start=1)
    ]


def hybrid_search(
    db: Session,
    query: str,
    *,
    limit: int = 8,
    company: str = "",
    query_vector: Sequence[float] | None = None,
    chunk_vectors: Mapping[str, Sequence[float]] | None = None,
    embedder: Callable[[str], Sequence[float]] | None = None,
) -> tuple[list[KnowledgeHit], dict]:
    """关键词 + 向量的混合检索（#29A 的唯一入口）。

    返回 (hits, diagnostics)。diagnostics 记录 keyword_count / vector_count /
    fallback_reason，供证据与诊断使用；任何向量侧异常都退化为关键词路而不是抛出。
    chunk_vectors 与 embedder 二选一：API 端点先异步编码再传 chunk_vectors；
    纯同步调用方（测试 / 助手工具）可以传同步 embedder。
    """
    if not (query or "").strip():
        return [], {"keyword_count": 0, "vector_count": 0, "fallback_reason": "empty_query"}
    candidate_query = db.query(KnowledgeEntry).filter(trash.live_only(KnowledgeEntry))
    if company.strip():
        # #29D：按公司筛选时只在关联了这家公司的条目里检索（不改变混合算法本身）。
        candidate_query = candidate_query.filter(KnowledgeEntry.company == company.strip())
    rows = candidate_query.order_by(KnowledgeEntry.id.desc()).limit(MAX_CANDIDATES).all()
    diagnostics: dict = {
        "keyword_count": 0,
        "vector_count": 0,
        "fallback_reason": "",
        "candidates": len(rows),
    }
    by_entry = {int(entry.id): entry for entry in rows}
    chunks_by_entry = {int(entry.id): split_markdown_chunks(entry) for entry in rows}

    keyword_hits: list[RankedHit] = []
    for entry in rows:
        score = keyword_score(query, entry)
        if score <= 0:
            continue
        keyword_hits.append(
            RankedHit(
                canonical_item_hash=str(entry.id), section_key="knowledge", rank=0, score=score
            )
        )
    keyword_hits = _rank(keyword_hits)[:KEYWORD_RANK_LIMIT]
    diagnostics["keyword_count"] = len(keyword_hits)

    vector_scores: dict[int, float] = {}
    if query_vector is not None:
        vectors = chunk_vectors
        if vectors is None and embedder is not None:
            try:
                vectors = {
                    chunk.chunk_id: embedder(chunk_embedding_text(chunk))
                    for chunks in chunks_by_entry.values()
                    for chunk in chunks
                }
            except Exception:  # noqa: BLE001 - 编码失败只回退关键词路
                vectors = None
                diagnostics["fallback_reason"] = "embedding_failed"
        if vectors:
            for entry_id, chunks in chunks_by_entry.items():
                best = 0.0
                for chunk in chunks:
                    vector = vectors.get(chunk.chunk_id)
                    if vector is None:
                        continue
                    best = max(best, cosine_similarity(query_vector, vector))
                if best > 0:
                    vector_scores[entry_id] = round(best, 4)
        else:
            diagnostics["fallback_reason"] = diagnostics["fallback_reason"] or "no_vectors"
    else:
        diagnostics["fallback_reason"] = "keyword_only"

    vector_hits = _rank(
        [
            RankedHit(
                canonical_item_hash=str(entry_id), section_key="knowledge", rank=0, score=score
            )
            for entry_id, score in vector_scores.items()
        ]
    )[:VECTOR_RANK_LIMIT]
    diagnostics["vector_count"] = len(vector_hits)

    if keyword_hits and vector_hits:
        fused = fuse_rrf(tuple(keyword_hits), tuple(vector_hits))
        scores = dict(fused.scores)
    elif vector_hits:
        scores = {str(hit.canonical_item_hash): float(hit.score) for hit in vector_hits}
    else:
        scores = {str(hit.canonical_item_hash): float(hit.score) for hit in keyword_hits}

    hits: list[KnowledgeHit] = []
    for key, score in scores.items():
        try:
            entry_id = int(key)
        except ValueError:
            continue
        entry = by_entry.get(entry_id)
        if entry is None:
            continue
        chunks = chunks_by_entry.get(entry_id, ())
        match_index = 0
        used_vector = entry_id in vector_scores
        hits.append(
            KnowledgeHit(
                entry_id=entry_id,
                title=entry.title or "",
                snippet=_snippet(entry, chunks, match_index),
                score=round(float(score), 4),
                matched_heading=(chunks[0].heading if chunks else ""),
                used_vector=used_vector,
            )
        )
    hits.sort(key=lambda hit: (-hit.score, -int(hit.used_vector), hit.entry_id))
    return hits[: max(1, limit)], diagnostics


__all__ = [
    "KEYWORD_RANK_LIMIT",
    "MAX_CANDIDATES",
    "MAX_CHUNK_CHARS",
    "SNIPPET_CHARS",
    "VECTOR_RANK_LIMIT",
    "KnowledgeChunk",
    "KnowledgeHit",
    "chunk_embedding_text",
    "entry_chunks",
    "hybrid_search",
    "keyword_score",
    "split_markdown_chunks",
]

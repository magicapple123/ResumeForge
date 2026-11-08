# SPDX-License-Identifier: Apache-2.0
"""关键词候选与向量候选的融合（计划 §3.3 / §3.5 / Phase 3）。

**融合只决定"哪些条目获得 boost"**——最终仍由 `_select_entries` 的分区名额、预算、
grounding 与一致性检查裁决。三条硬性质：

1. **精确命中保留硬优先级**：boost 加在 `_score_item()` 分数之上，技能路径
   （`_select_skills`）完全不吃 boost；证书/工具名/数字指标的直接命中仍由既有打分
   决定名次。
2. **融合分先定点化再比较**：所有融合分先 `round(score, 4)`，平局由
   `_select_entries` 的 key 回落原 index 顺序（cosine 的 float 末位差异在跨平台
   累加顺序下会漂移，不定点化会让"同分"变成"偶发选中不同条目"）。
3. **同一 entry 跨 chunk 去重**：按 `canonical_item_hash` 取最高分，一个 entry
   最多贡献一个候选。

只对 `rag_policy.is_section_boostable()` 为真的分区产生候选：内置四分区（教育/工作/
校园/项目）与 `filter_by_job=True` 的自建板块；awards 不参与岗位筛选、skills 走独立
硬优先级路径、扩展栏目按资料顺序保留——它们都不受 boost 影响。

融合分怎么进排序（**实测修正**）：`_select_entries` 的排序分是"整数关键词分 +
boost"，因此 boost 必须与整数分同量级才有意义。RRF 的 `1/(K+rank)≈0.016` 会被
12 分的技能命中完全淹没（实测 RRF 融合与 baseline 相同，见交付报告 Phase 3 迭代记录），
所以生产默认用**加权融合**：`boost = VECTOR_WEIGHT × cosine`，并把权重钉在 10——
低于 12（技能直接命中的硬优先级），保证"精确命中技能/证书/工具名的条目"永远排在
纯语义命中之前，同时让语义补召回真正参与排序。RRF 作为免调权的基线融合实现保留，
供诊断/后续 reranker 阶段复用。
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ...schemas.profile_projection import ConsumedProfile
from ..profile.profile_context import build_consumed_data
from ..profile.profile_matching import _score_item
from ..profile.profile_relevance_constants import SECTION_PRIMARY_FIELDS
from .rag_chunking import ChunkingResult, canonical_item_hash
from .rag_policy import BOOSTABLE_BUILTIN_SECTIONS, is_section_boostable

#: RRF 常数（论文默认 60）：越大越平滑，60 对两路排序都足够稳定。
RRF_K = 60
#: 加权融合的向量权重。必须 < 12（`_score_item` 的技能直接命中分）：这样"精确技能/
#: 证书/工具名命中"的条目保留硬优先级，向量只补充同义/跨语言表达的候选。
#: 取值依据（真实 granite-97m 实测，60 组评测集）：W=8 → R@10 0.6194 / nDCG 0.432；
#: W=10 → R@10 0.6361 / nDCG 0.4397；W=12 起会与技能命中同权，失去"硬优先级"。
VECTOR_WEIGHT = 10.0
#: 融合分定点化位数（计划 §3.3 的硬要求：先 round 再比较）。
FUSION_ROUND = 4


@dataclass(frozen=True)
class RankedHit:
    """一路排序里的一条命中（`rank` 从 1 起，越小越相关）。"""

    canonical_item_hash: str
    section_key: str
    rank: int
    score: float
    chunk_id: str = ""


@dataclass(frozen=True)
class FusedBoost:
    """融合结果：canonical_item_hash → 融合分（已定点化）。"""

    scores: dict[str, float]
    keyword_count: int
    vector_count: int


def keyword_ranking(consumed: ConsumedProfile, focus: Any) -> tuple[RankedHit, ...]:
    """当前关键词链在**可 boost 分区**上的确定性排序（复用 `_score_item`，不复制规则）。"""
    full = build_consumed_data(consumed)
    rows: list[tuple[float, int, str, dict[str, Any]]] = []
    order = 0
    for section_key in consumed.participating_keys:
        if section_key not in BOOSTABLE_BUILTIN_SECTIONS:
            continue
        primary_field = SECTION_PRIMARY_FIELDS.get(section_key, "")
        for item in full.get(section_key) or []:
            if not isinstance(item, dict) or not str(item.get(primary_field, "")).strip():
                continue
            rows.append((float(_score_item(item, section_key, focus)), order, section_key, item))
            order += 1
    rows.sort(key=lambda row: (-row[0], row[1]))
    return tuple(
        RankedHit(
            canonical_item_hash=canonical_item_hash(section_key, item),
            section_key=section_key,
            rank=rank,
            score=round(score, FUSION_ROUND),
        )
        for rank, (score, _order, section_key, item) in enumerate(rows, start=1)
    )


def cosine_similarity(
    left: tuple[float, ...] | list[float], right: tuple[float, ...] | list[float]
) -> float:
    """纯 Python cosine（无 numpy）：语料上限 320 条，检索不是瓶颈（计划 §2.2）。"""
    if len(left) != len(right) or not left:
        return 0.0
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right, strict=True):
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if left_norm <= 0.0 or right_norm <= 0.0:
        return 0.0
    return dot / math.sqrt(left_norm * right_norm)


def vector_ranking(
    chunks: tuple[Any, ...],
    query_vector: tuple[float, ...] | list[float],
    chunk_vectors: Mapping[str, tuple[float, ...] | list[float]],
    *,
    boostable: ConsumedProfile | None = None,
) -> tuple[RankedHit, ...]:
    """向量候选排序：只对可 boost 分区、有向量的 chunk 打分，按 entry 去重。"""
    scored: list[tuple[float, int, Any]] = []
    for order, chunk in enumerate(chunks):
        if boostable is not None and not is_section_boostable(chunk.section_key, boostable):
            continue
        vector = chunk_vectors.get(chunk.chunk_id)
        if vector is None:
            continue
        score = cosine_similarity(query_vector, vector)
        scored.append((score, order, chunk))
    scored.sort(key=lambda row: (-round(row[0], FUSION_ROUND), row[1]))
    hits: list[RankedHit] = []
    seen: set[str] = set()
    for rank, (score, _order, chunk) in enumerate(scored, start=1):
        if chunk.canonical_item_hash in seen:
            continue
        seen.add(chunk.canonical_item_hash)
        hits.append(
            RankedHit(
                canonical_item_hash=chunk.canonical_item_hash,
                section_key=chunk.section_key,
                rank=rank,
                score=round(score, FUSION_ROUND),
                chunk_id=chunk.chunk_id,
            )
        )
    return tuple(hits)


def fuse_rrf(
    keyword_hits: tuple[RankedHit, ...],
    vector_hits: tuple[RankedHit, ...],
    *,
    k: int = RRF_K,
) -> FusedBoost:
    """RRF 融合两路排序；按 canonical hash 去重，结果已 `round(..., 4)`。"""
    totals: dict[str, float] = {}
    for hits in (keyword_hits, vector_hits):
        for hit in hits:
            totals[hit.canonical_item_hash] = totals.get(hit.canonical_item_hash, 0.0) + (
                1.0 / (k + hit.rank)
            )
    scores = {key: round(value, FUSION_ROUND) for key, value in totals.items()}
    return FusedBoost(scores=scores, keyword_count=len(keyword_hits), vector_count=len(vector_hits))


def vector_weighted_scores(vector_hits: tuple[RankedHit, ...]) -> dict[str, float]:
    """加权融合的 boost 分量：`VECTOR_WEIGHT × cosine`（同一 entry 取最高分、已定点化）。

    关键词分不在这个 map 里——它由 `_select_entries` 的 `_ranked_score` 现算并相加，
    避免同一信号被计两次。未命中向量的条目按 0 分处理（等价于没有补召回）。
    """
    scores: dict[str, float] = {}
    for hit in vector_hits:
        # 负相似度不能变成"负 boost"：那会让本来关键词命中的条目被语义信号扣分，
        # 与"向量只做补召回"的语义相反。截到 0 分等价于没有补召回。
        value = round(VECTOR_WEIGHT * max(0.0, float(hit.score)), FUSION_ROUND)
        if value > scores.get(hit.canonical_item_hash, float("-inf")):
            scores[hit.canonical_item_hash] = value
    return scores


def build_boost(
    consumed: ConsumedProfile,
    focus: Any,
    chunking: ChunkingResult,
    query_vector: tuple[float, ...] | list[float],
    chunk_vectors: Mapping[str, tuple[float, ...] | list[float]],
) -> FusedBoost:
    """完整融合入口：关键词排序 + 向量排序 → boost map（键 = canonical_item_hash）。

    boost 只装**向量分量**（加权 cosine×10）；关键词分由 `_select_entries` 叠加，
    因此最终排序 = 关键词分 + 10×cosine，先 round(4) 再比较、平局回落原 index 顺序。
    """
    keyword_hits = keyword_ranking(consumed, focus)
    boostable_hashes = set(chunking.entry_by_canonical)
    keyword_hits = tuple(hit for hit in keyword_hits if hit.canonical_item_hash in boostable_hashes)
    vector_hits = vector_ranking(chunking.chunks, query_vector, chunk_vectors, boostable=consumed)
    scores = vector_weighted_scores(vector_hits)
    return FusedBoost(scores=scores, keyword_count=len(keyword_hits), vector_count=len(vector_hits))


__all__ = [
    "FUSION_ROUND",
    "RRF_K",
    "VECTOR_WEIGHT",
    "FusedBoost",
    "RankedHit",
    "build_boost",
    "cosine_similarity",
    "fuse_rrf",
    "keyword_ranking",
    "vector_ranking",
    "vector_weighted_scores",
]

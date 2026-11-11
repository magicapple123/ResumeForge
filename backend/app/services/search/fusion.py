# SPDX-License-Identifier: Apache-2.0
"""多来源名次融合：RRF（P4-03）。

## 为什么换成 RRF

旧实现 ``_interleave`` 轮流取一条再按 ``official_like_score`` 重排，"同一结果被多源命中"
完全不加分：三个来源都认的一条（相关性强）和只有一个来源给的一条（可能凑数）在排序上
没有区别。RRF（``Σ 1/(k + rank)``，k=60）就是为这件事设计的免调权融合。

## 计算复用 RAG 的实现（不写第二份）

``services/rag/rag_hybrid.py`` 已有 ``fuse_rrf`` + ``RRF_K`` + ``FUSION_ROUND``，本模块
**直接调用它**，只补一件它做不到的事：它接受两路，而搜索聚合有 2–6 路。

做法是逐源调用 ``fuse_rrf(单源排序, ())`` 拿到该源的 ``{key: 1/(k+rank)}`` 再求和。
数学上等价于一次性多路融合（RRF 是逐源独立求和的），并且**计分公式、k、定点化位数
全部只有一份实现**——`rag_hybrid` 那边改 k 或改舍入，这里自动跟着变。
改用 ``fuse_rrf`` 的两路签名去改造它并不划算：那需要改 ``services/rag/**``（本批不属于
搜索泳道），而多出的代码只有下面这 6 行求和。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

#: 对外暴露的两个常量与 RAG 侧保持一致（测试用它们断言固定分数）。
DEFAULT_RRF_K = 60


def _rag():
    """惰性取 RAG 的 RRF 实现。

    函数级 import 有两个理由：① ``rag_hybrid`` → ``profile_context`` → 半个别名链，
    搜索模块在导入期不需要付这份代价；② 避免"搜索 ← rag"在将来形成循环。
    """
    from ..rag.rag_hybrid import FUSION_ROUND, RRF_K, RankedHit, fuse_rrf

    return FUSION_ROUND, RRF_K, RankedHit, fuse_rrf


def rrf_scores(
    rankings: Mapping[str, Sequence[str]], *, k: int = DEFAULT_RRF_K
) -> dict[str, float]:
    """``{来源: [canonical url, ...]}`` → ``{canonical url: RRF 分}``（已定点化）。

    每个来源内部的列表顺序就是名次（第 1 条 rank=1）。空列表的来源不参与。
    """
    fusion_round, rag_k, ranked_hit, fuse_rrf = _rag()
    effective_k = rag_k if k == DEFAULT_RRF_K else k
    totals: dict[str, float] = {}
    for source, ordered in rankings.items():
        items = [str(item) for item in ordered if item]
        if not items:
            continue
        hits = tuple(
            ranked_hit(canonical_item_hash=item, section_key=source, rank=rank, score=0.0)
            for rank, item in enumerate(items, start=1)
        )
        partial = fuse_rrf(hits, (), k=effective_k).scores
        for key, value in partial.items():
            totals[key] = round(totals.get(key, 0.0) + value, fusion_round)
    return totals


def blend(
    scores: Mapping[str, float],
    bonuses: Mapping[str, float] | None = None,
) -> dict[str, float]:
    """把附加信号（如时效加权）加到融合分上，同样定点化后再比较。"""
    fusion_round, _rag_k, _ranked_hit, _fuse_rrf = _rag()
    extra = bonuses or {}
    return {key: round(value + extra.get(key, 0.0), fusion_round) for key, value in scores.items()}


__all__ = ["DEFAULT_RRF_K", "blend", "rrf_scores"]

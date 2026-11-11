# SPDX-License-Identifier: Apache-2.0
"""RAG 使用状态的对外表示（#30）。

设计要点（取自详册 §#30）：

* **配置状态 ≠ 使用状态**。设置页那个开关只回答"能不能用"；本条回答"这一次用没用上"。
  把"已启用但本次无命中"渲染成绿色"已开启"就是虚假接地感，比不显示更糟。
* 五个 state 必须分开：``off`` / ``empty`` / ``miss`` / ``hit`` / ``fallback``。
* ``hit_count`` 只能是**条目数**（``len(boost)``），不能数 chunk——虚增会直接损害信任。
* ``fallback`` 必须带 ``elapsed_ms``，让用户分清"慢"和"坏"。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .rag_chunking import ChunkingResult

#: 语义检索未启用（用户关掉 / 没配模型）。
RAG_STATE_OFF = "off"
#: 已启用但索引里没有可检索的条目。
RAG_STATE_EMPTY = "empty"
#: 已启用、跑完了，但这次没有命中。
RAG_STATE_MISS = "miss"
#: 命中（``boost`` 非空）。
RAG_STATE_HIT = "hit"
#: 超时/异常后回退到关键词链。
RAG_STATE_FALLBACK = "fallback"

_OFF_REASONS = frozenset({"disabled", "not_configured"})
_FALLBACK_REASONS = frozenset({"budget_exceeded", "error", "exception"})


def rag_state_payload(
    scope: Any,
    *,
    elapsed_ms: int | None = None,
) -> dict[str, Any]:
    """把 ``SelectionBoost`` 压成给前端的三层信息（state / 计数 / 原因）。

    参数 ``scope`` 允许是 ``None``（RAG 未参与本次生成）——那与"关掉了"同义。
    """
    boost: Mapping[str, float] = getattr(scope, "boost", None) or {}
    extra_terms = getattr(scope, "extra_terms", None) or ()
    reason = (getattr(scope, "fallback_reason", "") or "").strip()

    if reason in _OFF_REASONS:
        state = RAG_STATE_OFF
    elif reason == "empty_index":
        state = RAG_STATE_EMPTY
    elif reason in _FALLBACK_REASONS:
        state = RAG_STATE_FALLBACK
    elif boost:
        state = RAG_STATE_HIT
    elif reason:
        # 认不出的原因按"没命中"处理，但把原文带给前端，别吞掉诊断信息。
        state = RAG_STATE_MISS
    else:
        state = RAG_STATE_MISS

    payload: dict[str, Any] = {
        "state": state,
        "hit_count": len(boost),
        "expanded_terms": len(extra_terms),
        "reason": reason,
    }
    if state == RAG_STATE_FALLBACK:
        payload["elapsed_ms"] = int(elapsed_ms or 0)
    # L3 明细：命中了谁、各提升多少。前端"影响 N 个条目 ▾"列表直接消费这份数据，
    # 列表长度必须等于 hit_count（同一次 boost 派生，不另算一套）。
    impacts = getattr(scope, "impacts", None) or ()
    if state == RAG_STATE_HIT and impacts:
        payload["impacts"] = [dict(item) for item in impacts]
    return payload


#: #30 回执里的条目名：只做「这是谁」的锚点，详情正文不进回执（完整内容仍走资料页）。
_IMPACT_TITLE_MAX = 60
#: 与 rag_chunking._HEADER_SEPARATOR 同值：display_text 首行是「分区名｜主字段值」。
_IMPACT_SEPARATOR = "｜"


def impact_details(
    chunking: ChunkingResult, scored: list[tuple[str, float]]
) -> tuple[dict[str, Any], ...]:
    """把融合分映射回真实条目（#30 L3 明细）；与 boost 同一份数据，长度必须相等。

    找不到 chunk 的键保留一条空明细而不是丢弃：hit_count == len(impacts) 是前端
    「命中 N 条」列表的唯一不变量，丢一条就会显示命中 3 条却只列出 2 条。
    """
    by_hash: dict[str, Any] = {}
    for chunk in chunking.chunks:
        by_hash.setdefault(chunk.canonical_item_hash, chunk)
    details: list[dict[str, Any]] = []
    for canonical_hash, score in scored:
        chunk = by_hash.get(canonical_hash)
        if chunk is None:
            details.append({"entry_id": "", "title": "", "section": "", "delta": round(score, 4)})
            continue
        header = (chunk.display_text or "").split("\n", 1)[0]
        title = header.split(_IMPACT_SEPARATOR, 1)[-1] if _IMPACT_SEPARATOR in header else header
        details.append(
            {
                "entry_id": chunk.entry_id,
                "title": title.strip()[:_IMPACT_TITLE_MAX],
                "section": chunk.section_name,
                "delta": round(float(score), 4),
            }
        )
    return tuple(details)

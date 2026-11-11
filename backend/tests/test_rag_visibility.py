# SPDX-License-Identifier: Apache-2.0
"""#30 的 RAG 状态五态映射（纯函数）。"""

from __future__ import annotations

from app.services.rag.rag_seam import SelectionBoost
from app.services.rag.rag_visibility import (
    RAG_STATE_EMPTY,
    RAG_STATE_FALLBACK,
    RAG_STATE_HIT,
    RAG_STATE_MISS,
    RAG_STATE_OFF,
    rag_state_payload,
)


def test_disabled_and_not_configured_are_off() -> None:
    for reason in ("disabled", "not_configured"):
        payload = rag_state_payload(SelectionBoost(fallback_reason=reason))
        assert payload["state"] == RAG_STATE_OFF
        assert payload["hit_count"] == 0
        # 关掉时不带耗时：那会让用户以为"试过但失败了"。
        assert "elapsed_ms" not in payload


def test_empty_index_is_not_miss() -> None:
    """索引为空 ≠ 没命中——后者是"检索跑了但没找到"，前者是"根本没东西可找"。"""
    payload = rag_state_payload(SelectionBoost(fallback_reason="empty_index"))
    assert payload["state"] == RAG_STATE_EMPTY


def test_hit_counts_entries_not_chunks() -> None:
    scope = SelectionBoost(boost={"hash-a": 0.12, "hash-b": 0.31}, extra_terms=("缓存",))
    payload = rag_state_payload(scope)
    assert payload["state"] == RAG_STATE_HIT
    assert payload["hit_count"] == 2
    assert payload["expanded_terms"] == 1


def test_enabled_but_no_hit_is_miss() -> None:
    payload = rag_state_payload(SelectionBoost())
    assert payload["state"] == RAG_STATE_MISS
    assert payload["hit_count"] == 0


def test_budget_exceeded_is_fallback_with_elapsed() -> None:
    payload = rag_state_payload(SelectionBoost(fallback_reason="budget_exceeded"), elapsed_ms=153)
    assert payload["state"] == RAG_STATE_FALLBACK
    # 必须带耗时，用户才能分清"慢"和"坏"。
    assert payload["elapsed_ms"] == 153


def test_none_scope_is_miss_not_off() -> None:
    """scope 为 None 表示"这条链没参与"，与用户主动关闭不同：不能报 off 说"未启用"。"""
    payload = rag_state_payload(None)
    assert payload["state"] == RAG_STATE_MISS


def test_hit_carries_impacts_with_matching_length() -> None:
    """L3 明细与命中计数必须同源：列表长度 = hit_count（否则"命中 3 条"只列 2 条）。"""
    impacts = (
        {"entry_id": "e1", "title": "订单服务改造", "section": "项目经历", "delta": 0.31},
        {"entry_id": "e2", "title": "支付重构", "section": "项目经历", "delta": 0.12},
    )
    scope = SelectionBoost(
        boost={"hash-a": 0.31, "hash-b": 0.12}, extra_terms=("缓存",), impacts=impacts
    )
    payload = rag_state_payload(scope)
    assert payload["state"] == RAG_STATE_HIT
    assert payload["hit_count"] == len(payload["impacts"]) == 2
    assert payload["impacts"][0]["title"] == "订单服务改造"


def test_non_hit_states_do_not_carry_impacts() -> None:
    """没命中却带明细 = 自相矛盾的回执；off/fallback 一律不渲染 L3 列表。"""
    off = rag_state_payload(
        SelectionBoost(
            fallback_reason="disabled",
            impacts=({"entry_id": "e1", "title": "不该出现", "delta": 0.1},),
        )
    )
    assert "impacts" not in off
    fallback = rag_state_payload(
        SelectionBoost(
            fallback_reason="budget_exceeded",
            impacts=({"entry_id": "e1", "title": "不该出现", "delta": 0.1},),
        ),
        elapsed_ms=90,
    )
    assert "impacts" not in fallback

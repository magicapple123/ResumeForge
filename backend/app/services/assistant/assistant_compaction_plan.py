# SPDX-License-Identifier: Apache-2.0
"""上下文压缩的组合决策（问题清单 #10）：这一轮该不动 / 只遮蔽 / 遮蔽 + 摘要。

单独成文件是 500 行硬闸门的结果，也因为这一层是**唯一同时依赖两个输入源**的地方：

- ``messages``：这一轮真正要发给模型的视图（含本轮工具结果，所以 L1 在这里生效）；
- ``history``：带 ``id`` 的历史消息，决定摘要覆盖到哪一条（``covered_until``）。

两者对不上（角色序列不一致）时它只退回 L1：宁可这一轮不摘要，也不能摘要错区间——
把"用户的提问 + 助手的回答"错配进摘要，比不压缩严重得多。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from .assistant_compaction import (
    DEFAULT_MASK_PERCENT,
    DEFAULT_SUMMARY_PERCENT,
    SummaryRegion,
    plan_mask,
    summary_block_present,
    summary_region,
)

# ===== 组合决策 =====


@dataclass(frozen=True)
class CompactionLimits:
    """两个阈值（设置页可改；默认 60 / 75）。"""

    mask_percent: float = DEFAULT_MASK_PERCENT
    summary_percent: float = DEFAULT_SUMMARY_PERCENT


@dataclass(frozen=True)
class CompactionPlan:
    """一次压缩的完整计划：层、要遮蔽的下标、摘要切点与理由。"""

    level: str = "none"
    mask_indices: tuple[int, ...] = ()
    released_tokens: int = 0
    summary_cut_index: int = 1
    summary_region: SummaryRegion = field(default_factory=SummaryRegion)
    history_count: int = 0
    reason: str = ""


def plan_compaction(
    messages: list[dict[str, Any]],
    history: list[dict[str, Any]],
    *,
    window_tokens: int,
    percent: float | None,
    limits: CompactionLimits | None = None,
    state: dict[str, Any] | None = None,
    history_count: int = 0,
) -> CompactionPlan:
    """决定这一轮该做什么：不动 / 只遮蔽 / 遮蔽 + 摘要。

    ``history`` 是带 ``id`` 的历史消息；``history_count`` 是它在 ``messages`` 里
    实际存在的条数（``history_messages_for_model`` 会按字符预算从最旧裁掉一些，
    所以它一般是 ``history`` 的一个后缀）。两者对不上时**只做 L1**：摘要宁可本轮
    不做，也不能摘要错区间。
    """
    limits = limits or CompactionLimits()
    if not messages or window_tokens <= 0 or percent is None:
        return CompactionPlan(reason="no_window")
    if percent < limits.mask_percent:
        return CompactionPlan(reason="below_mask_threshold")
    mask_plan = plan_mask(messages, window_tokens=window_tokens, percent=percent)
    overlay = CompactionPlan(
        level="mask" if mask_plan.indices else "none",
        mask_indices=mask_plan.indices,
        released_tokens=mask_plan.released_tokens,
        reason=mask_plan.reason or "mask_only",
    )
    if percent < limits.summary_percent:
        return overlay
    history_slice = history[-history_count:] if history_count > 0 else list(history)
    if not history_slice:
        return overlay
    base = 2 if summary_block_present(messages) else 1
    aligned = messages[base : base + len(history_slice)]
    if len(aligned) != len(history_slice) or [message.get("role") for message in aligned] != [
        entry.get("role") for entry in history_slice
    ]:
        return replace(overlay, reason="align_failed")
    covered = state.get("covered_until_message_id") if isinstance(state, dict) else None
    region = summary_region(history_slice, covered_until_message_id=covered)
    if not region.message_ids:
        return replace(overlay, reason="nothing_to_summarize")
    covered_ids = set(region.message_ids)
    positions = [
        index
        for index, entry in enumerate(history_slice)
        if entry.get("id") is not None and int(entry["id"]) in covered_ids
    ]
    if not positions:
        return replace(overlay, reason="align_failed")
    return CompactionPlan(
        level="summary",
        mask_indices=mask_plan.indices,
        released_tokens=mask_plan.released_tokens,
        summary_cut_index=base + positions[-1] + 1,
        summary_region=region,
        history_count=len(history_slice),
        reason="summary",
    )


__all__ = ["CompactionLimits", "CompactionPlan", "plan_compaction"]

# SPDX-License-Identifier: Apache-2.0
"""上下文压缩的 IO 层（问题清单 #10）。

纯决策在 ``assistant_compaction`` / ``assistant_compaction_plan`` / ``assistant_compaction_summary``；
这里只做三件必须碰外部世界的事：读写三个设置项（``AppSetting`` KV，不新建表）、
读写 ``chat_conversation.compaction``（迁移 0011 的可空 JSON 列）、调一次摘要模型。

三条纪律：**失败不阻断发送**（超时/非法 JSON/报错一律转成 ``failed`` 标记，本轮继续
发出去）；**原文永不删除**（压缩只影响"发给模型的视图"，「还原」= 清空该列）；
**不做摘要的摘要**（新摘要与旧摘要走确定性合并）。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import ChatConversation, ChatMessage
from ..llm import create_provider
from ..llm.base import BaseLLMProvider
from ..model_context_windows import configured_model_window
from ..settings_service import get_llm_config
from . import assistant_compaction as core
from . import assistant_compaction_summary as summary_ops
from .assistant_compaction_plan import CompactionLimits, plan_compaction
from .assistant_compaction_settings import (
    COMPACTION_MODEL_KEY,
    MASK_PERCENT_KEY,
    SUMMARY_PERCENT_KEY,
    CompactionSettings,
    get_compaction_settings,
    save_compaction_settings,
)
from .assistant_persistence import history_snapshot

logger = logging.getLogger(__name__)

#: 摘要调用的硬超时。它是一次全量输入的调用，比普通对话更慢，但也不能无限等——
#: 等太久会把整条流的时间预算吃掉，而压缩本来是为了让对话继续。
SUMMARY_TIMEOUT_SECONDS = 90.0
#: dry-run 预估摘要块大小时用的中位值（状态卡实测多在 200–600 token）。预览用它，
#: 真跑后用实测 token 覆盖，所以这个数字只影响"预估"那一行，不影响任何真实预算。
PREVIEW_SUMMARY_TOKENS = 400


class CompactionUnavailable(RuntimeError):
    """摘要不可用（超时 / 非法 JSON / 调用失败）。API 层转成 503，流内转成降级。"""


# ===== 会话状态读写（chat_conversation.compaction） =====


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_compaction(db: Session, conversation_id: int) -> dict[str, Any]:
    """读会话的压缩状态；没压缩过 / 列里是脏数据都返回空 dict。"""
    row = db.get(ChatConversation, conversation_id)
    payload = getattr(row, "compaction", None) if row is not None else None
    return payload if isinstance(payload, dict) else {}


def save_compaction(db: Session, conversation_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """整体写回压缩状态（不做增量更新：半份状态比没有状态更危险）。"""
    row = db.get(ChatConversation, conversation_id)
    if row is None:
        return payload
    row.compaction = payload
    db.commit()
    return payload


def clear_compaction(db: Session, conversation_id: int) -> None:
    """「还原」：清空该列即回到原文视图（原文从来没被删除过）。"""
    row = db.get(ChatConversation, conversation_id)
    if row is None:
        return
    row.compaction = None
    db.commit()


def compaction_state_out(payload: dict[str, Any]) -> dict[str, Any]:
    """把落库的压缩状态收窄成前端契约（未知字段不带出去）。"""
    if not isinstance(payload, dict) or not payload:
        return {}
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else None
    meta = (summary or {}).get("compacted") if isinstance(summary, dict) else None
    meta = meta if isinstance(meta, dict) else {}
    # 先绑到局部变量再 isinstance：pyright 不把两次 ``payload.get(...)`` 调用当成同一个
    # 表达式，三元里右侧那次没被收窄，会报「None 没有 get」。
    raw_mask = payload.get("last_mask")
    last_mask: dict[str, Any] = raw_mask if isinstance(raw_mask, dict) else {}
    covered = payload.get("covered_until_message_id")
    return {
        "covered_until_message_id": int(covered) if covered is not None else None,
        "turns": int(meta.get("turns") or 0),
        "tokens_before": int(payload.get("tokens_before") or 0),
        "tokens_after": int(payload.get("tokens_after") or 0),
        "model": str(payload.get("model") or ""),
        "created_at": str(payload.get("created_at") or ""),
        "masked_tool_results": int(last_mask.get("count") or 0),
    }


# ===== 摘要调用 =====


def resolve_summary_provider(
    db: Session, provider: BaseLLMProvider | None, settings: CompactionSettings
) -> BaseLLMProvider | None:
    """摘要模型可配：空 = 跟随当前对话模型（用户已确认的口径）。

    只有用户显式填了别的模型才另建一个 provider；建不出来就退回当前模型——
    压缩失败会降级，但"因为模型名写错导致这一轮发都发不出去"是不可接受的。
    """
    if not settings.model:
        return provider
    try:
        config = get_llm_config(db).model_copy(update={"model": settings.model})
        return create_provider(config)
    except Exception:  # noqa: BLE001 - 配置异常一律回落到当前模型
        logger.warning("压缩模型不可用，已回落到当前对话模型")
        return provider


async def summarize_region(
    provider: BaseLLMProvider | None,
    region: core.SummaryRegion,
    *,
    timeout: float = SUMMARY_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """调一次模型把区间压成状态卡；任何失败都抛 ``CompactionUnavailable``。"""
    if provider is None:
        raise CompactionUnavailable("尚未配置大模型 API")
    prompt = summary_ops.build_summary_prompt(region)
    try:
        text = await asyncio.wait_for(provider.chat(prompt, thinking=False), timeout=timeout)
    except TimeoutError as exc:
        raise CompactionUnavailable("摘要超时") from exc
    except Exception as exc:  # noqa: BLE001 - 第三方调用，全部按不可用降级
        logger.warning("上下文摘要调用失败：%s", type(exc).__name__)
        raise CompactionUnavailable("摘要调用失败") from exc
    parsed = summary_ops.parse_summary(text if isinstance(text, str) else "")
    if parsed is None:
        raise CompactionUnavailable("摘要模型没有返回可用的结构化摘要")
    return parsed


# ===== 流内接线（每轮组装后、调模型前） =====


def _apply_stored_summary(
    messages: list[dict[str, Any]],
    history_slice: list[dict[str, Any]],
    state: dict[str, Any],
) -> list[dict[str, Any]]:
    """把既有摘要插回 pin 之后，并丢掉已被它覆盖的历史消息。

    ``messages`` 每一轮都是从 DB 重新拼的，摘要块不是历史消息，所以必须每轮补回；
    已覆盖的那几条如果还在（会话没长到被字符预算裁掉），也不能再发出去。
    """
    if core.summary_block_present(messages):
        return messages
    summary = state.get("summary")
    if not isinstance(summary, dict):
        return messages
    aligned = messages[1 : 1 + len(history_slice)]
    same = [message.get("role") for message in aligned] == [
        entry.get("role") for entry in history_slice
    ]
    covered = state.get("covered_until_message_id")
    prefix = core.covered_prefix_length(history_slice, covered) if same else 0
    return summary_ops.apply_summary(messages, summary, cut_index=1 + prefix)


def _persist_mask_stats(
    factory: Callable[[], Any], conversation_id: int, count: int, released_tokens: int
) -> None:
    """记一条"上次遮蔽了几条工具结果"（面板要显示它，且它是 L1 真的生效的证据）。"""
    if count <= 0:
        return
    try:
        with factory() as db:
            state = load_compaction(db, conversation_id)
            payload = dict(state)
            payload["last_mask"] = {
                "count": int(count),
                "released_tokens": int(released_tokens),
                "at": _now_iso(),
            }
            save_compaction(db, conversation_id, payload)
    except Exception:  # noqa: BLE001 - 统计写失败不影响这一轮
        logger.warning("上下文遮蔽统计写入失败（已忽略）")


async def compact_before_model(
    messages: list[dict[str, Any]],
    *,
    history: list[dict[str, Any]],
    history_count: int,
    factory: Callable[[], Any],
    conversation_id: int | None,
    provider: BaseLLMProvider | None,
    window_tokens: int,
    percent: float | None,
    limits: CompactionLimits | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """流内唯一入口：返回（这一轮真正要发给模型的 messages, 标记）。

    标记里的 ``failed=True`` 会被调用方写进助手消息的 ``context.compaction_failed``，
    前端据此提示一次「本次未能压缩，请稍后重试」，而不是让用户面对一个静默失败的
    长对话继续变长。
    """
    if conversation_id is None or not messages:
        return messages, {}
    with factory() as db:
        settings = get_compaction_settings(db)
        state = load_compaction(db, conversation_id)
    history_slice = history[-history_count:] if history_count > 0 else list(history)
    current = _apply_stored_summary(messages, history_slice, state)
    plan = plan_compaction(
        current,
        history,
        window_tokens=window_tokens,
        percent=percent,
        limits=limits or settings.limits,
        state=state,
        history_count=history_count,
    )
    flags: dict[str, Any] = {}
    if plan.mask_indices:
        current = core.mask_tool_results(current, plan.mask_indices)
        flags["masked_tool_results"] = len(plan.mask_indices)
        flags["released_tokens"] = plan.released_tokens
    if plan.level != "summary" or not plan.summary_region.message_ids:
        _persist_mask_stats(factory, conversation_id, len(plan.mask_indices), plan.released_tokens)
        return current, flags
    tokens_before = core.messages_tokens(current)
    with factory() as db:
        summary_provider = resolve_summary_provider(db, provider, settings)
    try:
        parsed = await summarize_region(summary_provider, plan.summary_region)
    except CompactionUnavailable as exc:
        logger.warning("本轮上下文摘要失败，已降级：%s", exc)
        flags["failed"] = True
        if percent is not None and percent > core.HARD_LIMIT_PERCENT:
            # 兜底硬闸：宁可丢历史，也不能让请求撞 context_length_exceeded。
            current = core.hard_limit_trim(current)
            flags["hard_trimmed"] = True
        _persist_mask_stats(factory, conversation_id, len(plan.mask_indices), plan.released_tokens)
        return current, flags
    previous = state.get("summary") if isinstance(state.get("summary"), dict) else None
    merged = summary_ops.merge_summary(
        previous,
        parsed,
        message_ids=plan.summary_region.message_ids,
        turns=plan.summary_region.turns,
    )
    current = summary_ops.apply_summary(current, merged, cut_index=plan.summary_cut_index)
    tokens_after = core.messages_tokens(current)
    payload = {
        "summary": merged,
        "covered_until_message_id": plan.summary_region.until_message_id,
        "tokens_before": tokens_before,
        "tokens_after": tokens_after,
        "model": _provider_model(provider, settings.model),
        "created_at": _now_iso(),
    }
    if isinstance(state.get("last_mask"), dict):
        payload["last_mask"] = state["last_mask"]
    with factory() as db:
        save_compaction(db, conversation_id, payload)
    flags["compacted"] = True
    flags["compaction"] = compaction_state_out(payload)
    return current, flags


# ===== 手动压缩（L3：dry-run 预估 / 真跑 / 还原） =====


def _latest_usage(db: Session, conversation_id: int) -> dict[str, Any]:
    """最近一条助手消息落库的用量（与 ``GET /context-usage`` 同一来源）。"""
    row = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.role == "assistant",
        )
        .order_by(ChatMessage.id.desc())
        .first()
    )
    context = row.context if row is not None and isinstance(row.context, dict) else {}
    usage = context.get("context_usage")
    return usage if isinstance(usage, dict) else {}


async def run_manual_compaction(
    conversation_id: int,
    db: Session,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    """用户主动压缩：先 dry-run 出预估，确认后才真跑（真跑会消耗一次模型调用）。

    ``dry_run=True`` 时**不写库、不调模型**：返回的 ``percent_after`` 是按状态卡
    中位大小估的，界面必须标「预计」，不能当成实测。
    """
    settings = get_compaction_settings(db)
    state = load_compaction(db, conversation_id)
    history = history_snapshot(db, conversation_id)
    window_tokens = configured_model_window(get_llm_config(db)).tokens
    usage = _latest_usage(db, conversation_id)
    tokens_before = int(usage.get("total") or 0)
    if tokens_before <= 0:
        tokens_before = core.messages_tokens(
            [
                {"role": str(entry.get("role") or ""), "content": entry.get("content") or ""}
                for entry in history
            ]
        )
    covered = state.get("covered_until_message_id")
    region = core.summary_region(history, covered_until_message_id=covered)
    percent_before = _percent(tokens_before, window_tokens)
    payload: dict[str, Any] = {
        "dry_run": dry_run,
        "percent_before": percent_before,
        "percent_after": percent_before,
        "turns_covered": region.turns,
        "tool_results_masked": 0,
        "model": settings.model or str(getattr(get_llm_config(db), "model", "")),
        "created_at": "",
        "covered_until_message_id": covered,
        "summary": state.get("summary") if isinstance(state.get("summary"), dict) else None,
        "compaction": compaction_state_out(state) or None,
        "reason": "",
    }
    if not region.message_ids:
        payload["reason"] = "nothing_to_summarize"
        return payload
    estimated_after = max(0, tokens_before - region.tokens + PREVIEW_SUMMARY_TOKENS)
    payload["percent_after"] = _percent(estimated_after, window_tokens)
    if dry_run:
        return payload
    try:
        base_provider = create_provider(get_llm_config(db))
    except Exception as exc:  # noqa: BLE001 - 没有可用配置时按"摘要不可用"处理
        raise CompactionUnavailable("尚未配置大模型 API") from exc
    provider = resolve_summary_provider(db, base_provider, settings)
    parsed = await summarize_region(provider, region)
    previous = state.get("summary") if isinstance(state.get("summary"), dict) else None
    merged = summary_ops.merge_summary(
        previous, parsed, message_ids=region.message_ids, turns=region.turns
    )
    summary_tokens = summary_ops.summary_block_tokens(merged)
    tokens_after = max(0, tokens_before - region.tokens + summary_tokens)
    stored = {
        "summary": merged,
        "covered_until_message_id": region.until_message_id,
        "tokens_before": tokens_before,
        "tokens_after": tokens_after,
        "model": _provider_model(provider, settings.model),
        "created_at": _now_iso(),
    }
    if isinstance(state.get("last_mask"), dict):
        stored["last_mask"] = state["last_mask"]
    save_compaction(db, conversation_id, stored)
    payload.update(
        {
            "percent_after": _percent(tokens_after, window_tokens),
            "model": stored["model"],
            "created_at": stored["created_at"],
            "covered_until_message_id": region.until_message_id,
            "summary": merged,
            "compaction": compaction_state_out(stored),
        }
    )
    return payload


def _provider_model(provider: BaseLLMProvider | None, fallback: str) -> str:
    """provider 上真正生效的模型名（用于"上次压缩用了哪个模型"这条审计信息）。"""
    config = getattr(provider, "config", None)
    model = str(getattr(config, "model", "") or "") if config is not None else ""
    return model or fallback


def _percent(tokens: int, window_tokens: int) -> float | None:
    """与后端 `assistant_context_usage` 同口径：窗口为 0 时是 None（没有分母）。"""
    if window_tokens <= 0:
        return None
    return round(tokens / window_tokens * 100, 1)


__all__ = [
    "COMPACTION_MODEL_KEY",
    "CompactionSettings",
    "CompactionUnavailable",
    "MASK_PERCENT_KEY",
    "SUMMARY_PERCENT_KEY",
    "SUMMARY_TIMEOUT_SECONDS",
    "clear_compaction",
    "compact_before_model",
    "compaction_state_out",
    "get_compaction_settings",
    "load_compaction",
    "resolve_summary_provider",
    "run_manual_compaction",
    "save_compaction",
    "save_compaction_settings",
    "summarize_region",
]

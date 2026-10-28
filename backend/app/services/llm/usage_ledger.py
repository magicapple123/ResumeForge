# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本：把既有 LLMUsage 规范化落库并按任务/模型汇总。

- 复用既有 LLMUsage（services.llm.usage）：不新增计量口径，token 缺失就是 None。
- **不保存提示词/回复/密钥/个人资料**：本模块的入参只有 LLMUsage 或 provider 实例，
  连正文都没有可传的入口。
- 结束原因（finish_reason）逐条落库，并按任务/模型做计数汇总（stop/length/cancelled/…）。
- 费用**只在用户配置了单价时**估算。单价从 0067 起是**可命名的记录**（``usage_pricing_record``），
  单位是**每百万 token**，并把输入拆成"缓存命中 / 未命中"两档——命中价通常只有未命中的
  1/10，合并成一个输入价会把省下来的钱算没。老的单价格式（``llm_price_per_1k_*`` 设置项与
  ``RF_LLM_PRICE_PER_1K_*`` 环境变量）仍然读得到，换算 ×1000 后按"命中=未命中"兜底。
  没配置就 estimated=False + reason，**不臆造金额**；token 未知的行不参与金额。
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.llm_usage import LLMUsageRecord
from .usage import FINISH_STOP, LLMUsage, summarize_usages
from .usage_pricing import (
    COST_NO_TOKEN,
    COST_NOT_CONFIGURED,
    COST_PARTIAL,
    DEFAULT_CURRENCY,
    PRICING_ENV_CURRENCY,
    PRICING_ENV_INPUT,
    PRICING_ENV_OUTPUT,
    PRICING_KEY_CURRENCY,
    PRICING_KEY_INPUT,
    PRICING_KEY_OUTPUT,
    UsagePricing,
    activate_pricing_record,
    create_pricing_record,
    delete_pricing_record,
    estimate_cost,
    list_pricing_records,
    load_pricing,
    pricing_from_record,
    pricing_payload,
    pricing_record_payload,
    rename_pricing_record,
)
from .usage_tasks import (
    TASK_APPLY,
    TASK_ASSISTANT,
    TASK_CLAIMS,
    TASK_DRILL,
    TASK_INTERVIEW,
    TASK_JOB_ANALYSIS,
    TASK_JOB_MATCH,
    TASK_JOB_PARSE,
    TASK_PROFILE_PARSE,
    TASK_RESUME_GENERATE,
    TASK_RESUME_OPTIMIZE,
    TASK_RESUME_REVISE,
    TASK_RESUME_RISK,
    TASK_RESUME_SCENARIO,
    TASK_RESUME_SUGGESTIONS,
    TASK_RESUME_TRANSLATE,
    TASK_RESUME_WRITING,
    TASK_TEMPLATE,
    TASK_TRACKER,
    TASK_UNKNOWN,
    TASK_WEBFORM,
    ambient_task,
    record_ambient_usage,
    set_ambient_task,
    task_for_path,
)

logger = logging.getLogger(__name__)

FINISH_UNKNOWN = "unknown"
_MAX_TASK_LENGTH = 32

# 未配置价格时的统一口径（不在日志/响应里出现任何用户内容）。
def _normalize_task(task: str | None) -> str:
    cleaned = (task or "").strip()[:_MAX_TASK_LENGTH]
    return cleaned or TASK_UNKNOWN


def record_llm_usage(
    db: Session,
    *,
    task: str,
    usage: LLMUsage | None = None,
    model: str = "",
    resume_id: int | None = None,
    finish_reason: str | None = None,
) -> LLMUsageRecord:
    """记录一次调用；usage=None 表示"调用发生但用量未知"（token 留 NULL）。"""
    prompt_tokens = usage.prompt_tokens if usage is not None else None
    completion_tokens = usage.completion_tokens if usage is not None else None
    cache_hit_tokens = usage.cache_hit_tokens if usage is not None else None
    cache_miss_tokens = (
        max(0, prompt_tokens - cache_hit_tokens)
        if prompt_tokens is not None and cache_hit_tokens is not None
        else None
    )
    pricing = load_pricing(db)
    cost = estimate_cost(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cache_hit_tokens=cache_hit_tokens,
        pricing=pricing,
    )
    record = LLMUsageRecord(
        task=_normalize_task(task),
        model=(model or (usage.model if usage is not None else ""))[:64],
        resume_id=resume_id,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cache_hit_tokens=cache_hit_tokens,
        cache_miss_tokens=cache_miss_tokens,
        total_tokens=usage.total_tokens if usage is not None else None,
        duration_ms=usage.elapsed_ms if usage is not None else None,
        finish_reason=(
            finish_reason
            or (usage.finish_reason if usage is not None else FINISH_UNKNOWN)
            or FINISH_STOP
        )[:32],
        retries=usage.retries if usage is not None else 0,
        cost_estimate=cost,
        cost_currency=(pricing.currency if cost is not None and pricing is not None else ""),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record



def record_provider_usage(
    db: Session,
    *,
    task: str,
    provider: Any,
    resume_id: int | None = None,
    finish_reason: str | None = None,
) -> LLMUsageRecord:
    """从 provider.last_usage（既有约定）取用量落库；FakeProvider 没有该属性时记未知。

    ``finish_reason`` 显式传入时优先（例如调用方在适配器返回值之外还有更准确的中断原因）。
    """
    usage = getattr(provider, "last_usage", None)
    if not isinstance(usage, LLMUsage):
        usage = None
    return record_llm_usage(
        db, task=task, usage=usage, resume_id=resume_id, finish_reason=finish_reason
    )


def summarize_app_usages(
    usages: list[LLMUsage], *, finish_reason: str | None = None
) -> dict[str, Any] | None:
    """复用既有内存口径（assistant/生成链路已经这样汇总）；不新增第二套算法。"""
    return summarize_usages(usages, finish_reason=finish_reason)


def _sum_or_none(values: list[int | None]) -> int | None:
    """只要有一项未知就整体 None——部分和会被误读成完整值。"""
    total = 0
    for value in values:
        if value is None:
            return None
        total += value
    return total


def _sum_known(values: list[int | None]) -> int | None:
    """只累加已知值；全都未知返回 None（区别于"确实是 0"）。"""
    known = [value for value in values if value is not None]
    if not known:
        return None
    return sum(known)


def _finish_reason_counts(rows: list[LLMUsageRecord]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        reason = (row.finish_reason or FINISH_UNKNOWN)[:32]
        counts[reason] = counts.get(reason, 0) + 1
    return dict(sorted(counts.items()))


def _bucket(key: str, rows: list[LLMUsageRecord]) -> dict[str, Any]:
    return {
        "key": key,
        "calls": len(rows),
        "retries": sum(row.retries or 0 for row in rows),
        "prompt_tokens": _sum_or_none([row.prompt_tokens for row in rows]),
        "completion_tokens": _sum_or_none([row.completion_tokens for row in rows]),
        # 缓存两档只累加"有记录"的行，并单独报出缺记录的行数：老账本没有这个信息，
        # 但也不该因此把整段历史显示成"未知"。
        "cache_hit_tokens": _sum_known([row.cache_hit_tokens for row in rows]),
        "cache_miss_tokens": _sum_known([row.cache_miss_tokens for row in rows]),
        "cache_unknown_calls": sum(1 for row in rows if row.cache_hit_tokens is None),
        "total_tokens": _sum_or_none([row.total_tokens for row in rows]),
        "duration_ms": _sum_or_none([row.duration_ms for row in rows]),
        "unknown_token_calls": sum(1 for row in rows if row.total_tokens is None),
        # 结束原因计数（stop/length/cancelled/error/…）：R04 要求按任务/模型汇总。
        "finish_reasons": _finish_reason_counts(rows),
    }


def _cost_summary(rows: list[LLMUsageRecord], pricing: UsagePricing | None) -> dict[str, Any]:
    """费用只在配置了单价时估算；否则如实说"未配置"，不臆造金额。"""
    if pricing is None:
        return {
            "estimated": False,
            "currency": "",
            "amount": None,
            "reason": COST_NOT_CONFIGURED,
        }
    estimates: list[float] = []
    for row in rows:
        amount = estimate_cost(
            prompt_tokens=row.prompt_tokens,
            completion_tokens=row.completion_tokens,
            cache_hit_tokens=row.cache_hit_tokens,
            pricing=pricing,
        )
        if amount is not None:
            estimates.append(amount)
    if not estimates:
        return {
            "estimated": False,
            "currency": pricing.currency,
            "amount": None,
            "reason": COST_NO_TOKEN,
        }
    partial = len(estimates) != len(rows)
    return {
        "estimated": True,
        "currency": pricing.currency,
        "amount": round(sum(estimates), 6),
        "reason": COST_PARTIAL if partial else "",
    }


def summarize_usage(
    db: Session,
    *,
    task: str | None = None,
    since: datetime | None = None,
) -> dict[str, Any]:
    """按任务/模型汇总；token 未知的调用单独计数，不混进总数。"""
    statement = select(LLMUsageRecord).order_by(LLMUsageRecord.id)
    if task:
        statement = statement.where(LLMUsageRecord.task == task)
    if since is not None:
        statement = statement.where(LLMUsageRecord.created_at >= since)
    rows = list(db.execute(statement).scalars().all())

    by_task: dict[str, list[LLMUsageRecord]] = {}
    by_model: dict[str, list[LLMUsageRecord]] = {}
    for row in rows:
        by_task.setdefault(row.task or TASK_UNKNOWN, []).append(row)
        by_model.setdefault(row.model or "", []).append(row)
    totals = _bucket("total", rows)
    pricing = load_pricing(db)
    return {
        "records": len(rows),
        "since": since,
        "tasks": [_bucket(key, value) for key, value in sorted(by_task.items())],
        "models": [_bucket(key, value) for key, value in sorted(by_model.items())],
        "totals": totals,
        "unknown_token_records": sum(1 for row in rows if row.total_tokens is None),
        "cost": _cost_summary(rows, pricing),
    }


def serialize_usage_record(row: LLMUsageRecord) -> dict[str, Any]:
    """单条诊断形状；**没有任何正文/密钥字段**。"""
    return {
        "id": row.id,
        "task": row.task,
        "model": row.model,
        "resume_id": row.resume_id,
        "prompt_tokens": row.prompt_tokens,
        "cache_hit_tokens": row.cache_hit_tokens,
        "cache_miss_tokens": row.cache_miss_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "duration_ms": row.duration_ms,
        "finish_reason": row.finish_reason,
        "retries": row.retries,
        "cost_estimate": row.cost_estimate,
        "cost_currency": row.cost_currency,
        "created_at": row.created_at,
    }


def list_recent_records(
    db: Session, *, task: str | None = None, limit: int = 100
) -> list[LLMUsageRecord]:
    """最近 N 条用量记录（新→旧）；只给数字/枚举，供诊断界面逐条查看。"""
    statement = select(LLMUsageRecord).order_by(LLMUsageRecord.id.desc())
    if task:
        statement = statement.where(LLMUsageRecord.task == task)
    safe_limit = max(1, min(int(limit), 500))
    return list(db.execute(statement.limit(safe_limit)).scalars().all())


__all__ = [
    "COST_NOT_CONFIGURED",
    "COST_NO_TOKEN",
    "COST_PARTIAL",
    "DEFAULT_CURRENCY",
    "FINISH_UNKNOWN",
    "PRICING_ENV_CURRENCY",
    "PRICING_ENV_INPUT",
    "PRICING_ENV_OUTPUT",
    "PRICING_KEY_CURRENCY",
    "PRICING_KEY_INPUT",
    "PRICING_KEY_OUTPUT",
    "activate_pricing_record",
    "create_pricing_record",
    "delete_pricing_record",
    "list_pricing_records",
    "pricing_record_payload",
    "rename_pricing_record",
    "TASK_APPLY",
    "TASK_ASSISTANT",
    "TASK_CLAIMS",
    "TASK_DRILL",
    "TASK_INTERVIEW",
    "TASK_JOB_ANALYSIS",
    "TASK_JOB_MATCH",
    "TASK_JOB_PARSE",
    "TASK_PROFILE_PARSE",
    "TASK_RESUME_GENERATE",
    "TASK_RESUME_OPTIMIZE",
    "TASK_RESUME_REVISE",
    "TASK_RESUME_RISK",
    "TASK_RESUME_SCENARIO",
    "TASK_RESUME_SUGGESTIONS",
    "TASK_RESUME_TRANSLATE",
    "TASK_RESUME_WRITING",
    "TASK_TEMPLATE",
    "TASK_TRACKER",
    "TASK_UNKNOWN",
    "TASK_WEBFORM",
    "UsagePricing",
    "ambient_task",
    "estimate_cost",
    "list_recent_records",
    "load_pricing",
    "pricing_from_record",
    "pricing_payload",
    "record_ambient_usage",
    "record_llm_usage",
    "record_provider_usage",
    "serialize_usage_record",
    "set_ambient_task",
    "summarize_app_usages",
    "summarize_usage",
    "task_for_path",
]

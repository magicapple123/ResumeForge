# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本：把既有 LLMUsage 规范化落库并按任务/模型汇总。

- 复用既有 LLMUsage（services.llm.usage）：不新增计量口径，token 缺失就是 None。
- **不保存提示词/回复/密钥/个人资料**：本模块的入参只有 LLMUsage 或 provider 实例，
  连正文都没有可传的入口。
- 费用只按用户配置单价估算；当前没有价格配置来源，所以 summary 一律
  estimated=False + reason，不臆造金额。将来接入价格配置时只需在 _cost_summary
  里读配置，接口形状不变。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.llm_usage import LLMUsageRecord
from .usage import LLMUsage, summarize_usages

# 任务类别（前端按这些值做分组；未知任务原样保留，不丢数据）。
TASK_RESUME_GENERATE = "resume_generate"
TASK_RESUME_REVISE = "resume_revise"
TASK_RESUME_SUGGESTIONS = "resume_suggestions"
TASK_RESUME_TRANSLATE = "resume_translate"
TASK_RESUME_OPTIMIZE = "resume_optimize"
TASK_ASSISTANT = "assistant"
TASK_UNKNOWN = "unknown"

FINISH_UNKNOWN = "unknown"
_MAX_TASK_LENGTH = 32

# 未配置价格时的统一口径（不在日志/响应里出现任何用户内容）。
COST_NOT_CONFIGURED = "未配置模型价格，不估算费用"


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
    record = LLMUsageRecord(
        task=_normalize_task(task),
        model=(model or (usage.model if usage is not None else ""))[:64],
        resume_id=resume_id,
        prompt_tokens=usage.prompt_tokens if usage is not None else None,
        completion_tokens=usage.completion_tokens if usage is not None else None,
        total_tokens=usage.total_tokens if usage is not None else None,
        duration_ms=usage.elapsed_ms if usage is not None else None,
        finish_reason=(
            finish_reason or (usage.finish_reason if usage is not None else FINISH_UNKNOWN)
        )[:32],
        retries=usage.retries if usage is not None else 0,
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
) -> LLMUsageRecord:
    """从 provider.last_usage（既有约定）取用量落库；FakeProvider 没有该属性时记未知。"""
    usage = getattr(provider, "last_usage", None)
    if not isinstance(usage, LLMUsage):
        usage = None
    return record_llm_usage(db, task=task, usage=usage, resume_id=resume_id)


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


def _bucket(key: str, rows: list[LLMUsageRecord]) -> dict[str, Any]:
    return {
        "key": key,
        "calls": len(rows),
        "retries": sum(row.retries or 0 for row in rows),
        "prompt_tokens": _sum_or_none([row.prompt_tokens for row in rows]),
        "completion_tokens": _sum_or_none([row.completion_tokens for row in rows]),
        "total_tokens": _sum_or_none([row.total_tokens for row in rows]),
        "duration_ms": _sum_or_none([row.duration_ms for row in rows]),
        "unknown_token_calls": sum(1 for row in rows if row.total_tokens is None),
    }


def _cost_summary(rows: list[LLMUsageRecord]) -> dict[str, Any]:
    """费用只在全部行都有估算且币种一致时给数字；否则如实说"未配置"。"""
    estimates = [row.cost_estimate for row in rows if row.cost_estimate is not None]
    currencies = {row.cost_currency for row in rows if row.cost_estimate is not None}
    if not rows or not estimates or len(estimates) != len(rows) or len(currencies) != 1:
        return {
            "estimated": False,
            "currency": "",
            "amount": None,
            "reason": COST_NOT_CONFIGURED,
        }
    return {
        "estimated": True,
        "currency": next(iter(currencies)),
        "amount": round(sum(estimates), 6),
        "reason": "",
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
    return {
        "records": len(rows),
        "since": since,
        "tasks": [_bucket(key, value) for key, value in sorted(by_task.items())],
        "models": [_bucket(key, value) for key, value in sorted(by_model.items())],
        "totals": totals,
        "unknown_token_records": sum(1 for row in rows if row.total_tokens is None),
        "cost": _cost_summary(rows),
    }


def serialize_usage_record(row: LLMUsageRecord) -> dict[str, Any]:
    """单条诊断形状；**没有任何正文/密钥字段**。"""
    return {
        "id": row.id,
        "task": row.task,
        "model": row.model,
        "resume_id": row.resume_id,
        "prompt_tokens": row.prompt_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "duration_ms": row.duration_ms,
        "finish_reason": row.finish_reason,
        "retries": row.retries,
        "created_at": row.created_at,
    }

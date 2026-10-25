# SPDX-License-Identifier: Apache-2.0
"""R04 用量账本：把既有 LLMUsage 规范化落库并按任务/模型汇总。

- 复用既有 LLMUsage（services.llm.usage）：不新增计量口径，token 缺失就是 None。
- **不保存提示词/回复/密钥/个人资料**：本模块的入参只有 LLMUsage 或 provider 实例，
  连正文都没有可传的入口。
- 结束原因（finish_reason）逐条落库，并按任务/模型做计数汇总（stop/length/cancelled/…）。
- 费用**只在用户配置了单价时**估算：单价存在 app_setting（``llm_price_per_1k_input`` /
  ``llm_price_per_1k_output`` / ``llm_price_currency``），也可用环境变量
  ``RF_LLM_PRICE_PER_1K_INPUT`` / ``RF_LLM_PRICE_PER_1K_OUTPUT`` / ``RF_LLM_PRICE_CURRENCY``
  兜底。没配置就 estimated=False + reason，**不臆造金额**；token 未知的行不参与金额。
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.llm_usage import LLMUsageRecord
from ...models.setting import AppSetting
from .usage import FINISH_STOP, LLMUsage, summarize_usages
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
COST_NOT_CONFIGURED = "未配置模型价格，不估算费用"
COST_NO_TOKEN = "调用未返回 token，无法估算费用"
COST_PARTIAL = "部分调用未返回 token，费用按已知部分估算"

# 单价配置的存储键与环境变量（设置优先于环境变量；两者都没有 = 不估算）。
PRICING_KEY_INPUT = "llm_price_per_1k_input"
PRICING_KEY_OUTPUT = "llm_price_per_1k_output"
PRICING_KEY_CURRENCY = "llm_price_currency"
PRICING_ENV_INPUT = "RF_LLM_PRICE_PER_1K_INPUT"
PRICING_ENV_OUTPUT = "RF_LLM_PRICE_PER_1K_OUTPUT"
PRICING_ENV_CURRENCY = "RF_LLM_PRICE_CURRENCY"
DEFAULT_CURRENCY = "CNY"
_MAX_PRICE = 1_000_000.0
_MAX_CURRENCY_LENGTH = 8


def _normalize_task(task: str | None) -> str:
    cleaned = (task or "").strip()[:_MAX_TASK_LENGTH]
    return cleaned or TASK_UNKNOWN


@dataclass(frozen=True)
class UsagePricing:
    """用户配置的每千 token 单价（输入/输出分开计费）。"""

    input_per_1k: float
    output_per_1k: float
    currency: str
    source: str  # "settings" | "environment"


def _parse_price(raw: Any) -> float | None:
    """把配置值解析成非负有限浮点；非法/缺失一律 None（不猜价格）。"""
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value < 0 or value > _MAX_PRICE:
        return None
    return value


def _clean_currency(raw: Any) -> str:
    text = str(raw or "").strip()[:_MAX_CURRENCY_LENGTH]
    return text or DEFAULT_CURRENCY


def _pricing_from_values(
    raw_input: Any, raw_output: Any, raw_currency: Any, *, source: str
) -> UsagePricing | None:
    input_price = _parse_price(raw_input)
    output_price = _parse_price(raw_output)
    # 两个单价必须同时有效才估算：只有一侧价格只会算出误导性金额。
    if input_price is None or output_price is None:
        return None
    return UsagePricing(
        input_per_1k=input_price,
        output_per_1k=output_price,
        currency=_clean_currency(raw_currency),
        source=source,
    )


def _setting_value(db: Session, key: str) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return None
    try:
        return json.loads(row.value)
    except (TypeError, ValueError):
        return row.value


def load_pricing(db: Session | None = None) -> UsagePricing | None:
    """读取用户配置的单价：设置优先，其次环境变量；都没有返回 None（= 不估算）。"""
    if db is not None:
        try:
            pricing = _pricing_from_values(
                _setting_value(db, PRICING_KEY_INPUT),
                _setting_value(db, PRICING_KEY_OUTPUT),
                _setting_value(db, PRICING_KEY_CURRENCY),
                source="settings",
            )
        except Exception:  # noqa: BLE001 - 配置读取失败不能反向破坏账本/接口
            logger.warning("读取模型单价配置失败，按未配置处理", exc_info=True)
            pricing = None
        if pricing is not None:
            return pricing
    return _pricing_from_values(
        os.environ.get(PRICING_ENV_INPUT),
        os.environ.get(PRICING_ENV_OUTPUT),
        os.environ.get(PRICING_ENV_CURRENCY),
        source="environment",
    )


def _save_setting(db: Session, key: str, value: Any | None) -> None:
    row = db.get(AppSetting, key)
    if value is None:
        if row is not None:
            db.delete(row)
        return
    serialized = json.dumps(value)
    if row is None:
        db.add(AppSetting(key=key, value=serialized))
    else:
        row.value = serialized


def save_pricing(
    db: Session,
    *,
    input_per_1k: float | None,
    output_per_1k: float | None,
    currency: str = DEFAULT_CURRENCY,
) -> UsagePricing | None:
    """保存/清除单价配置（两项都 None = 清除配置、回到"未知费用"）。

    校验在路由的 Pydantic 层先做（两项同时提供或同时省略）；这里再确认一遍避免
    服务层被绕过时写入单侧价格。
    """
    if (input_per_1k is None) != (output_per_1k is None):
        raise ValueError("输入与输出单价必须同时配置或同时清除")
    if input_per_1k is None:
        for key in (PRICING_KEY_INPUT, PRICING_KEY_OUTPUT, PRICING_KEY_CURRENCY):
            _save_setting(db, key, None)
        db.commit()
        return None
    validated = _pricing_from_values(input_per_1k, output_per_1k, currency, source="settings")
    if validated is None:
        raise ValueError("单价必须是 0 到 1000000 之间的数字")
    _save_setting(db, PRICING_KEY_INPUT, validated.input_per_1k)
    _save_setting(db, PRICING_KEY_OUTPUT, validated.output_per_1k)
    _save_setting(db, PRICING_KEY_CURRENCY, validated.currency)
    db.commit()
    return validated


def estimate_cost(
    *, prompt_tokens: int | None, completion_tokens: int | None, pricing: UsagePricing | None
) -> float | None:
    """按每千 token 单价估算一次调用费用；任一 token 未知或未配置单价 → None。"""
    if pricing is None or prompt_tokens is None or completion_tokens is None:
        return None
    amount = (
        prompt_tokens / 1000.0 * pricing.input_per_1k
        + completion_tokens / 1000.0 * pricing.output_per_1k
    )
    return round(amount, 6)


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
    pricing = load_pricing(db)
    cost = estimate_cost(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        pricing=pricing,
    )
    record = LLMUsageRecord(
        task=_normalize_task(task),
        model=(model or (usage.model if usage is not None else ""))[:64],
        resume_id=resume_id,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
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


def pricing_payload(pricing: UsagePricing | None) -> dict[str, Any]:
    """接口形状：未配置时 configured=False（前端据此隐藏/说明"未配置不估算"）。"""
    if pricing is None:
        return {
            "configured": False,
            "input_per_1k": None,
            "output_per_1k": None,
            "currency": "",
            "source": "",
        }
    return {
        "configured": True,
        "input_per_1k": pricing.input_per_1k,
        "output_per_1k": pricing.output_per_1k,
        "currency": pricing.currency,
        "source": pricing.source,
    }


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
    "pricing_payload",
    "record_ambient_usage",
    "record_llm_usage",
    "record_provider_usage",
    "save_pricing",
    "serialize_usage_record",
    "set_ambient_task",
    "summarize_app_usages",
    "summarize_usage",
    "task_for_path",
]

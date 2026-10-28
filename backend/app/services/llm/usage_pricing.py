# SPDX-License-Identifier: Apache-2.0
"""模型单价与费用估算：一份可命名、可回溯的单价记录，按**每百万 token** 计。

从 ``usage_ledger`` 拆出来的原因：账本负责"记了多少 token"，单价负责"这些 token 值多少钱"，
两件事的变更节奏与依赖完全不同（账本只碰 LLMUsage，单价要碰配置、记录表、环境变量）。
拆开之后 ``estimate_cost`` 也能被单独测试，不必造一整本账。

三条口径（与 ``models/usage_pricing.py`` 一致）：

1. 单位是**每百万 token**：按千计的数字小到看不出差别，估算没有参考价值。
2. 输入拆**缓存命中 / 未命中**两档：命中价通常只有未命中的 1/10，合并会把省下来的钱算没。
3. 老格式（每千 token、单一输入价）仍读得到，换算 ×1000 后按"命中=未命中"兜底——升级后
   不会突然变成"未配置单价"。
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.setting import AppSetting
from ...models.usage_pricing import UsagePricingRecord

logger = logging.getLogger(__name__)

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
_MAX_PRICING_NAME_LENGTH = 64


@dataclass(frozen=True)
class UsagePricing:
    """一份单价（**每百万 token**；输入拆缓存命中 / 未命中）。

    三档都可能为 None：某档没填就当 0 计（界面会说明"该档按 0 计"），而不是整份作废——
    有些服务商没有缓存折扣，命中档留空很正常。
    """

    input_cache_hit_per_million: float | None
    input_cache_miss_per_million: float | None
    output_per_million: float | None
    currency: str
    source: str  # "record" | "settings" | "environment"
    record_id: int | None = None
    name: str = ""

    def has_any_price(self) -> bool:
        return any(
            value is not None
            for value in (
                self.input_cache_hit_per_million,
                self.input_cache_miss_per_million,
                self.output_per_million,
            )
        )


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


def _clean_name(raw: Any) -> str:
    return str(raw or "").strip()[:_MAX_PRICING_NAME_LENGTH]


def _setting_value(db: Session, key: str) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return None
    try:
        return json.loads(row.value)
    except (TypeError, ValueError):
        return row.value


def _active_record(db: Session) -> Any | None:
    """当前生效的单价记录；没有就返回 None（不抛异常：老库可能还没有这张表）。"""
    try:
        return (
            db.execute(
                select(UsagePricingRecord)
                .where(UsagePricingRecord.is_active.is_(True))
                .order_by(UsagePricingRecord.id.desc())
            )
            .scalars()
            .first()
        )
    except Exception:  # noqa: BLE001 - 表不存在/读取失败都按"未配置"处理
        logger.warning("读取单价记录失败，按未配置处理", exc_info=True)
        return None


def pricing_from_record(record: Any) -> UsagePricing:
    return UsagePricing(
        input_cache_hit_per_million=_parse_price(record.input_cache_hit_per_million),
        input_cache_miss_per_million=_parse_price(record.input_cache_miss_per_million),
        output_per_million=_parse_price(record.output_per_million),
        currency=_clean_currency(record.currency),
        source="record",
        record_id=record.id,
        name=record.name or "",
    )


def _legacy_pricing(raw_input: Any, raw_output: Any, raw_currency: Any, *, source: str):
    """老格式（每千 token、只有一个输入价）→ 每百万；命中档与未命中档同价。"""
    input_per_1k = _parse_price(raw_input)
    output_per_1k = _parse_price(raw_output)
    if input_per_1k is None and output_per_1k is None:
        return None
    return UsagePricing(
        input_cache_hit_per_million=(input_per_1k * 1000.0 if input_per_1k is not None else None),
        input_cache_miss_per_million=(input_per_1k * 1000.0 if input_per_1k is not None else None),
        output_per_million=output_per_1k * 1000.0 if output_per_1k is not None else None,
        currency=_clean_currency(raw_currency),
        source=source,
    )


def load_pricing(db: Session | None = None) -> UsagePricing | None:
    """读取当前生效的单价：单价记录 → 老设置项 → 环境变量；都没有返回 None。"""
    if db is not None:
        record = _active_record(db)
        if record is not None:
            pricing = pricing_from_record(record)
            if pricing.has_any_price():
                return pricing
        try:
            legacy = _legacy_pricing(
                _setting_value(db, PRICING_KEY_INPUT),
                _setting_value(db, PRICING_KEY_OUTPUT),
                _setting_value(db, PRICING_KEY_CURRENCY),
                source="settings",
            )
        except Exception:  # noqa: BLE001 - 配置读取失败不能反向破坏账本/接口
            logger.warning("读取模型单价配置失败，按未配置处理", exc_info=True)
            legacy = None
        if legacy is not None:
            return legacy
    return _legacy_pricing(
        os.environ.get(PRICING_ENV_INPUT),
        os.environ.get(PRICING_ENV_OUTPUT),
        os.environ.get(PRICING_ENV_CURRENCY),
        source="environment",
    )


def list_pricing_records(db: Session) -> list[Any]:
    """全部单价记录，新的在前（界面按这个顺序列）。"""
    return list(
        db.execute(select(UsagePricingRecord).order_by(UsagePricingRecord.id.desc()))
        .scalars()
        .all()
    )


def _deactivate_others(db: Session, keep_id: int | None) -> None:
    for row in db.execute(select(UsagePricingRecord)).scalars().all():
        if keep_id is not None and row.id == keep_id:
            continue
        if row.is_active:
            row.is_active = False


def create_pricing_record(
    db: Session,
    *,
    name: str = "",
    input_cache_hit_per_million: float | None = None,
    input_cache_miss_per_million: float | None = None,
    output_per_million: float | None = None,
    currency: str = DEFAULT_CURRENCY,
    activate: bool = True,
) -> Any:
    """新建一份单价记录（默认立即生效），并把其它记录置为非生效。"""
    prices = (input_cache_hit_per_million, input_cache_miss_per_million, output_per_million)
    parsed = [_parse_price(value) for value in prices]
    if all(value is None for value in parsed):
        raise ValueError("至少要填一档单价（缓存命中 / 缓存未命中 / 输出）")
    for raw, value in zip(prices, parsed, strict=True):
        if raw is not None and value is None:
            raise ValueError("单价必须是 0 到 1000000 之间的数字")
    record = UsagePricingRecord(
        name=_clean_name(name),
        input_cache_hit_per_million=parsed[0],
        input_cache_miss_per_million=parsed[1],
        output_per_million=parsed[2],
        currency=_clean_currency(currency),
        is_active=bool(activate),
    )
    db.add(record)
    db.flush()
    if activate:
        _deactivate_others(db, record.id)
    db.commit()
    db.refresh(record)
    return record


def rename_pricing_record(db: Session, record_id: int, name: str) -> Any | None:
    """给一条单价记录改名（只改名字，不动价格与生效状态）。"""
    record = db.get(UsagePricingRecord, record_id)
    if record is None:
        return None
    record.name = _clean_name(name)
    db.commit()
    db.refresh(record)
    return record


def activate_pricing_record(db: Session, record_id: int) -> Any | None:
    """把某条记录设为生效；其它记录同时失效。"""
    record = db.get(UsagePricingRecord, record_id)
    if record is None:
        return None
    record.is_active = True
    _deactivate_others(db, record.id)
    db.commit()
    db.refresh(record)
    return record


def delete_pricing_record(db: Session, record_id: int) -> bool:
    """删除一条记录；删的若是生效那条，把剩下最新的一条顶上去。"""
    record = db.get(UsagePricingRecord, record_id)
    if record is None:
        return False
    was_active = bool(record.is_active)
    db.delete(record)
    db.flush()
    if was_active:
        latest = (
            db.execute(select(UsagePricingRecord).order_by(UsagePricingRecord.id.desc()))
            .scalars()
            .first()
        )
        if latest is not None:
            latest.is_active = True
    db.commit()
    return True


def estimate_cost(
    *,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    pricing: UsagePricing | None,
    cache_hit_tokens: int | None = None,
) -> float | None:
    """按**每百万 token** 三档单价估算一次调用费用。

    缓存命中数未知（0067 之前的账本、或服务商没给 ``cached_tokens``）时，整段输入按
    **未命中价**计——宁可估高，也不要凭空给一个更便宜的数字。任一必需 token 未知或
    没有配置任何单价 → None（不臆造金额）。
    """
    if pricing is None or prompt_tokens is None or completion_tokens is None:
        return None
    hit = cache_hit_tokens if cache_hit_tokens is not None else 0
    hit = max(0, min(hit, prompt_tokens))
    miss = prompt_tokens - hit
    amount = (
        hit / 1_000_000.0 * (pricing.input_cache_hit_per_million or 0.0)
        + miss / 1_000_000.0 * (pricing.input_cache_miss_per_million or 0.0)
        + completion_tokens / 1_000_000.0 * (pricing.output_per_million or 0.0)
    )
    return round(amount, 8)


def pricing_payload(pricing: UsagePricing | None) -> dict[str, Any]:
    """接口形状：未配置时 configured=False（前端据此说明"未配置不估算"）。"""
    if pricing is None:
        return {
            "configured": False,
            "input_cache_hit_per_million": None,
            "input_cache_miss_per_million": None,
            "output_per_million": None,
            "currency": "",
            "source": "",
            "record_id": None,
            "name": "",
        }
    return {
        "configured": True,
        "input_cache_hit_per_million": pricing.input_cache_hit_per_million,
        "input_cache_miss_per_million": pricing.input_cache_miss_per_million,
        "output_per_million": pricing.output_per_million,
        "currency": pricing.currency,
        "source": pricing.source,
        "record_id": pricing.record_id,
        "name": pricing.name,
    }


def pricing_record_payload(record: Any) -> dict[str, Any]:
    """一条单价记录的回显形状（不含任何用户内容）。"""
    return {
        "id": record.id,
        "name": record.name or "",
        "input_cache_hit_per_million": record.input_cache_hit_per_million,
        "input_cache_miss_per_million": record.input_cache_miss_per_million,
        "output_per_million": record.output_per_million,
        "currency": record.currency or DEFAULT_CURRENCY,
        "is_active": bool(record.is_active),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }

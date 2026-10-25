# SPDX-License-Identifier: Apache-2.0
"""R04 用量接口：按任务/模型汇总、单价配置、逐条记录。

边界（与任务书 R04 对齐）：只返回数字/枚举与费用估算，**不返回任何提示词、密钥或
个人资料**；账本表本身也没有这些列（test_usage_ledger 逐列检查）。
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..dataset_registry import read_active_dataset_id
from ..schemas.usage import (
    UsagePricingIn,
    UsagePricingOut,
    UsageRecordListOut,
    UsageRecordOut,
    UsageSummaryOut,
)
from ..services.llm import usage_ledger

router = APIRouter(prefix="/api/usage", tags=["usage"])


def _read_pricing_out(db: Session) -> UsagePricingOut:
    return UsagePricingOut.model_validate(
        usage_ledger.pricing_payload(usage_ledger.load_pricing(db))
    )


@router.get("/summary", response_model=UsageSummaryOut)
def read_usage_summary(
    task: str | None = Query(default=None, max_length=32),
    since: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
) -> UsageSummaryOut:
    """当前数据集的模型用量汇总；token 未知时给 None（不是 0），费用未配置不估算。

    ``cost.estimated`` 只有在用户配置了单价（设置或环境变量）时才可能为 true；
    ``finish_reasons`` 给出按任务/模型的结束原因计数。
    """
    data = usage_ledger.summarize_usage(db, task=task, since=since)
    try:
        data["dataset_id"] = read_active_dataset_id()
    except Exception:  # noqa: BLE001 - 数据集指针不可读时只是少了展示字段
        data["dataset_id"] = None
    return UsageSummaryOut.model_validate(data)


@router.get("/pricing", response_model=UsagePricingOut)
def read_usage_pricing(db: Session = Depends(get_db)) -> UsagePricingOut:
    """当前生效的单价配置；configured=False = 未配置，费用保持未知。"""
    return _read_pricing_out(db)


@router.put("/pricing", response_model=UsagePricingOut)
def write_usage_pricing(
    payload: UsagePricingIn, db: Session = Depends(get_db)
) -> UsagePricingOut:
    """保存/清除每千 token 单价（两项同时给或同时清空）；只影响未来的费用估算。"""
    try:
        usage_ledger.save_pricing(
            db,
            input_per_1k=payload.input_per_1k,
            output_per_1k=payload.output_per_1k,
            currency=payload.currency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _read_pricing_out(db)


@router.get("/records", response_model=UsageRecordListOut)
def read_usage_records(
    task: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> UsageRecordListOut:
    """最近 N 条用量记录（新→旧）：含结束原因/重试/费用快照，**不含任何正文**。"""
    rows = usage_ledger.list_recent_records(db, task=task, limit=limit)
    items = [
        UsageRecordOut.model_validate(usage_ledger.serialize_usage_record(row)) for row in rows
    ]
    return UsageRecordListOut(items=items, count=len(items))

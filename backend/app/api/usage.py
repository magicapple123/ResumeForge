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
    UsagePricingRecordListOut,
    UsagePricingRecordOut,
    UsagePricingRenameIn,
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


def _record_out(record) -> UsagePricingRecordOut:
    return UsagePricingRecordOut.model_validate(usage_ledger.pricing_record_payload(record))


@router.put("/pricing", response_model=UsagePricingOut)
def write_usage_pricing(payload: UsagePricingIn, db: Session = Depends(get_db)) -> UsagePricingOut:
    """保存一份新单价（**每百万 token**，三档）并立即生效。

    每次保存都新建一条带名字的记录，而不是覆盖上一条：用户要能对比"官方价 / 调价后"，
    也要能给已有的记录改名（``PATCH /pricing/records/{id}``）。
    """
    try:
        record = usage_ledger.create_pricing_record(
            db,
            name=payload.name,
            input_cache_hit_per_million=payload.input_cache_hit_per_million,
            input_cache_miss_per_million=payload.input_cache_miss_per_million,
            output_per_million=payload.output_per_million,
            currency=payload.currency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UsagePricingOut.model_validate(
        usage_ledger.pricing_payload(usage_ledger.pricing_from_record(record))
    )


@router.get("/pricing/records", response_model=UsagePricingRecordListOut)
def list_usage_pricing_records(db: Session = Depends(get_db)) -> UsagePricingRecordListOut:
    """全部单价记录（新→旧），含"哪条生效"与创建时间。"""
    rows = usage_ledger.list_pricing_records(db)
    items = [_record_out(row) for row in rows]
    return UsagePricingRecordListOut(items=items, count=len(items))


@router.patch("/pricing/records/{record_id}", response_model=UsagePricingRecordOut)
def rename_usage_pricing_record(
    record_id: int, payload: UsagePricingRenameIn, db: Session = Depends(get_db)
) -> UsagePricingRecordOut:
    """给一条单价记录改名（价格与生效状态都不动）。"""
    record = usage_ledger.rename_pricing_record(db, record_id, payload.name)
    if record is None:
        raise HTTPException(status_code=404, detail="单价记录不存在")
    return _record_out(record)


@router.post("/pricing/records/{record_id}/activate", response_model=UsagePricingOut)
def activate_usage_pricing_record(
    record_id: int, db: Session = Depends(get_db)
) -> UsagePricingOut:
    """切换生效的单价（其它记录同时失效）。"""
    record = usage_ledger.activate_pricing_record(db, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="单价记录不存在")
    return _read_pricing_out(db)


@router.delete("/pricing/records/{record_id}")
def delete_usage_pricing_record(record_id: int, db: Session = Depends(get_db)) -> dict:
    """删除一条单价记录；删掉生效那条时，剩下最新的一条自动顶上。"""
    if not usage_ledger.delete_pricing_record(db, record_id):
        raise HTTPException(status_code=404, detail="单价记录不存在")
    return {"ok": True}


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

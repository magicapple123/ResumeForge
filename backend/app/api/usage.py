# SPDX-License-Identifier: Apache-2.0
"""R04 用量汇总接口：按任务/模型汇总；不返回任何提示词、密钥或个人资料。"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..dataset_registry import read_active_dataset_id
from ..schemas.usage import UsageSummaryOut
from ..services.llm import usage_ledger

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/summary", response_model=UsageSummaryOut)
def read_usage_summary(
    task: str | None = Query(default=None, max_length=32),
    since: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
) -> UsageSummaryOut:
    """当前数据集的模型用量汇总；token 未知时给 None（不是 0），费用未配置不估算。"""
    data = usage_ledger.summarize_usage(db, task=task, since=since)
    try:
        data["dataset_id"] = read_active_dataset_id()
    except Exception:  # noqa: BLE001 - 数据集指针不可读时只是少了展示字段
        data["dataset_id"] = None
    return UsageSummaryOut.model_validate(data)

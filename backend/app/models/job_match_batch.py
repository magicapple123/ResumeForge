"""岗位批量匹配记录模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class JobMatchBatch(Base):
    """一次岗位广场批量适配度分析的完整结果快照。"""

    __tablename__ = "job_match_batch"

    id: Mapped[int] = mapped_column(primary_key=True)
    requested_count: Mapped[int] = mapped_column(Integer, default=0)
    completed_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    # 每项包含岗位快照、匹配结论、参考分和失败原因；不保存完整个人资料。
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    model: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


__all__ = ["JobMatchBatch"]

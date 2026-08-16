"""简历生成记录模型：每次生成都落库，支持历史查看与导出。"""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ResumeRecord(Base):
    __tablename__ = "resume_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    # 目标岗位（快照保存，岗位被删除后记录仍完整可用）
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True
    )
    job_title: Mapped[str] = mapped_column(String(128), default="")
    company: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # 结构化简历
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)  # 一致性校验提醒
    model: Mapped[str] = mapped_column(String(64), default="")
    tone: Mapped[str] = mapped_column(String(32), default="standard")
    parse_error: Mapped[str] = mapped_column(Text, default="")  # JSON 解析失败时留痕
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

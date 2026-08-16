"""岗位模型：手动添加与各抓取源采集的岗位统一入库。"""
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 岗位状态的可选值
JOB_STATUS_OPEN = "开放中"
JOB_STATUS_CLOSED = "已截止"
JOB_STATUS_APPLIED = "已投递"
JOB_STATUSES = (JOB_STATUS_OPEN, JOB_STATUS_CLOSED, JOB_STATUS_APPLIED)


class Job(Base):
    __tablename__ = "job"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(128))
    company: Mapped[str] = mapped_column(String(128), default="")
    location: Mapped[str] = mapped_column(String(64), default="")
    salary: Mapped[str] = mapped_column(String(64), default="")
    job_type: Mapped[str] = mapped_column(String(32), default="校招")  # 校招/实习/社招/其他
    description: Mapped[str] = mapped_column(Text, default="")  # JD 全文
    requirements: Mapped[str] = mapped_column(Text, default="")  # 任职要求（可选）
    # 规则解析出的技能标签：[{"name": "Python", "category": "编程语言"}, ...]
    keywords: Mapped[list[Any]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(64), default="手动添加")  # 来源标识
    source_url: Mapped[str] = mapped_column(String(512), default="")  # 投递链接
    posted_at: Mapped[str] = mapped_column(String(32), default="")  # 发布时间的原始文本
    status: Mapped[str] = mapped_column(String(16), default=JOB_STATUS_OPEN)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

# SPDX-License-Identifier: Apache-2.0
"""知识库条目（第 7 批业务代码的地基）。

第 5 批只建表 + 注册进 ``Base.metadata``，**不实现增删改查业务代码**——那部分属于后续批。
这里先把结构与软删除语义定下来：标题、分类、标签、正文、来源，全部带 ``deleted_at`` 软删除
（进回收站），列表查询届时统一复用 ``services/trash.live_only``。
"""
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class KnowledgeEntry(Base):
    """一条知识库条目。"""

    __tablename__ = "knowledge_entry"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    category: Mapped[str] = mapped_column(String(32), default="", index=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    content: Mapped[str] = mapped_column(Text, default="")
    # 来源（如「手动录入」「面经导入」等，第 7 批定义白名单）。
    source: Mapped[str] = mapped_column(String(64), default="")
    # 0014（#29C/#29D/#29E）：从「笔记列表」升级为「可被全站引用的底座」。
    # 我为什么存这条（<=120 字）——调研结论里这句话比正文更值钱。
    reason: Mapped[str] = mapped_column(String(120), default="", server_default="")
    # 关联公司（可空、有索引）：按公司筛选、面试页「这家公司面经 N 条」。
    company: Mapped[str] = mapped_column(
        String(128), default="", server_default="", index=True
    )
    # 关联岗位（可空外键，SET NULL）：岗位彻底删除后条目仍可读，知识是用户的。
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("job.id", ondelete="SET NULL"), nullable=True
    )
    # 蒸馏结果（#29E）：卡片直接显示摘要，RAG 命中优先返回摘要（省 token）。
    summary: Mapped[str] = mapped_column(String(300), default="", server_default="")
    # 蒸馏要点（JSON 数组）：与 summary 同源，服务列表展示与检索。
    key_points: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # 软删除时间戳：NULL 表示「没删」。列表查询一律复用 ``services/trash.live_only``。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = ["KnowledgeEntry"]

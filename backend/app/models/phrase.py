# SPDX-License-Identifier: Apache-2.0
"""W17 私有表达资产（迁移 0056）。

一条 ResumePhrase = 用户收藏的一句可复用表达（成果/方法/结果/总结/自定义）。
设计约定（wave3 契约 §3）：

- **默认个人私有、按数据集隔离**：每份数据集独立 SQLite 库，表里不存 dataset_id；
  检索/插入全在本地完成，不调用模型、不自动外发。
- **来源可追溯但不复制正文**：source_claim_id / source_resume_id / source_object_id
  只记引用；被引用对象删除时 FK 置 NULL，字符串来源标识保留（证据可读，不猜测）。
- **资产被编辑不回写已插入的简历**：插入产生新的 object_id/point_id（W01），
  更新一律走"先看差异再采纳"的前端流程；本表只提供数据。
- **软删**：deleted_at 列让资产进回收站（第 17 类），彻底删除仍是显式动作。
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 表达类型（前端按它分组；custom 兜底，不限制用户自述）。
PHRASE_KIND_ACHIEVEMENT = "achievement"
PHRASE_KIND_METHOD = "method"
PHRASE_KIND_RESULT = "result"
PHRASE_KIND_SUMMARY = "summary"
PHRASE_KIND_CUSTOM = "custom"
PHRASE_KINDS = (
    PHRASE_KIND_ACHIEVEMENT,
    PHRASE_KIND_METHOD,
    PHRASE_KIND_RESULT,
    PHRASE_KIND_SUMMARY,
    PHRASE_KIND_CUSTOM,
)

# 语言：空串 = 未标注（旧数据/用户不关心）。
PHRASE_LANGUAGES = ("", "zh-CN", "en-US")

MAX_PHRASE_TEXT = 2000
MAX_PHRASE_TAGS = 20
MAX_PHRASE_TAG_LENGTH = 32
MAX_PHRASE_QUALITY_NOTE = 256


class ResumePhrase(Base):
    """一条可复用的私有表达。"""

    __tablename__ = "resume_phrase"
    __table_args__ = (
        Index("ix_resume_phrase_kind", "kind"),
        Index("ix_resume_phrase_language", "language"),
        Index("ix_resume_phrase_deleted_at", "deleted_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 允许项目既有的 **加粗** 标记（渲染层协议），长度上限在服务层校验。
    text: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(
        String(16), default=PHRASE_KIND_CUSTOM, server_default=PHRASE_KIND_CUSTOM
    )
    language: Mapped[str] = mapped_column(String(16), default="", server_default="")
    source_claim_id: Mapped[int | None] = mapped_column(
        ForeignKey("claim_record.id", ondelete="SET NULL"), nullable=True
    )
    source_resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resume_record.id", ondelete="SET NULL"), nullable=True
    )
    source_object_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    job_tags: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    quality_note: Mapped[str] = mapped_column(
        String(MAX_PHRASE_QUALITY_NOTE), default="", server_default=""
    )
    usage_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = [
    "MAX_PHRASE_TAGS",
    "MAX_PHRASE_TAG_LENGTH",
    "MAX_PHRASE_TEXT",
    "PHRASE_KINDS",
    "PHRASE_KIND_ACHIEVEMENT",
    "PHRASE_KIND_CUSTOM",
    "PHRASE_KIND_METHOD",
    "PHRASE_KIND_RESULT",
    "PHRASE_KIND_SUMMARY",
    "PHRASE_LANGUAGES",
    "ResumePhrase",
]

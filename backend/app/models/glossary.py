# SPDX-License-Identifier: Apache-2.0
"""W16 数据集级术语表（迁移 0058）。

一条术语 = "这个词固定译成那个词"（人名/机构/公司/技能/专业术语）。术语表不存 resume_id：
同一数据集内所有简历共享同一套译法，切换简历不会出现两套人名。数据集隔离由独立 SQLite
库结构保证；带 deleted_at → 回收站第 18 类（软删可恢复）。

locked=True 的词在翻译结果中**必须逐字出现 target_term**（服务端校验，不靠提示词）。
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 术语类别（前端分组；term 兜底）。
GLOSSARY_CATEGORY_NAME = "name"
GLOSSARY_CATEGORY_INSTITUTION = "institution"
GLOSSARY_CATEGORY_COMPANY = "company"
GLOSSARY_CATEGORY_SKILL = "skill"
GLOSSARY_CATEGORY_TERM = "term"
GLOSSARY_CATEGORIES = (
    GLOSSARY_CATEGORY_NAME,
    GLOSSARY_CATEGORY_INSTITUTION,
    GLOSSARY_CATEGORY_COMPANY,
    GLOSSARY_CATEGORY_SKILL,
    GLOSSARY_CATEGORY_TERM,
)
GLOSSARY_LANGUAGES = ("zh-CN", "en-US")
MAX_TERM_LENGTH = 128
MAX_TERM_NOTE = 256


class ResumeGlossaryTerm(Base):
    """一条术语对照。"""

    __tablename__ = "resume_glossary_term"
    __table_args__ = (
        UniqueConstraint("source_term", "language_to", name="uq_glossary_term"),
        Index("ix_resume_glossary_term_language_to", "language_to"),
        Index("ix_resume_glossary_term_deleted_at", "deleted_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_term: Mapped[str] = mapped_column(String(128), default="")
    target_term: Mapped[str] = mapped_column(String(128), default="")
    language_from: Mapped[str] = mapped_column(String(16), default="")
    language_to: Mapped[str] = mapped_column(String(16), default="")
    category: Mapped[str] = mapped_column(String(16), default=GLOSSARY_CATEGORY_TERM)
    # 默认锁定：锁定词的译法必须逐字出现在翻译结果里。
    locked: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    note: Mapped[str] = mapped_column(String(256), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = [
    "GLOSSARY_CATEGORIES",
    "GLOSSARY_CATEGORY_COMPANY",
    "GLOSSARY_CATEGORY_INSTITUTION",
    "GLOSSARY_CATEGORY_NAME",
    "GLOSSARY_CATEGORY_SKILL",
    "GLOSSARY_CATEGORY_TERM",
    "GLOSSARY_LANGUAGES",
    "MAX_TERM_LENGTH",
    "MAX_TERM_NOTE",
    "ResumeGlossaryTerm",
]

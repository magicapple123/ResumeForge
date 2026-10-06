"""网申资料中的可重复补充记录。"""
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class WebFormProfileRecord(Base):
    """一条可重复的网申资料补充记录。

    ResumeForge 当前是单用户本地应用，所以与 ``WebFormProfileEntry`` 一样不额外存
    ``profile_id``。字段值使用 JSON 保存，新增网申字段时不需要再次改表结构。
    """

    __tablename__ = "web_form_profile_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_key: Mapped[str] = mapped_column(String(32), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    values: Mapped[dict[str, str]] = mapped_column("payload", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


__all__ = ["WebFormProfileRecord"]

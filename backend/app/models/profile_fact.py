# SPDX-License-Identifier: Apache-2.0
"""补充事实（profile_fact）：九类固定事实、稳定身份、与旧资料表隔离。

**为什么独立成表而不是给旧资料列表加字段**（计划 §8.2）：update_profile 的旧列表
保存是"整体替换"，把新列表默认设成空数组会让旧客户端保存旧资料时清空新增内容。
新事实只由 /api/profile/facts 写入，旧 Profile PUT 完全不接管。

**为什么是固定类型而不是任意 JSON**：只接收论文、科研项目、专利、资格证照、
作品项目、实践/服务经历、荣誉奖项、培训课程、语言能力九类（灵活化契约 §1）；
payload 由 schemas/profile_facts.py 按 kind 严格校验；禁止模型或资产包动态注册
可执行类型。字段的"显示/隐藏/自定义"属于 profile_fact_field_pref（按类型的行为
偏好，不进回收站），事实 payload 仍是值快照。

稳定身份：``fact_id`` 是外部可见的稳定 id（内容排序/保存不重建），``id`` 只是本地主键；
``revision`` 供条件更新（expected_revision）避免多窗口互相覆盖；软删除进回收站。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 九类受支持的补充事实（顺序即对外展示顺序，契约 §1 固定）。
# 新增类型必须同时改这里、schemas/profile_facts.py、fact_field_schema.py 与备份/回收站测试。
PROFILE_FACT_KINDS: tuple[str, ...] = (
    "publication",
    "research_project",
    "patent",
    "credential",
    "work_project",
    "practice",
    "award",
    "training",
    "language",
)


class ProfileFact(Base):
    __tablename__ = "profile_fact"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定身份：``profile-fact:<fact_id>`` 是来源定位写法；排序/保存不改变它。
    fact_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("user_profile.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(24), index=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    # 用户可见的展示顺序；排序不改身份、不改 revision 的业务语义（它参与条件写）。
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


__all__ = ["PROFILE_FACT_KINDS", "ProfileFact"]

# SPDX-License-Identifier: Apache-2.0
"""助手记忆的变更历史（F33）。

为什么单独一张表而不是在 `assistant_memory` 上加列：一条记忆会被反复改（内容、停用、
恢复、被新值取代），"最后一次长什么样"不够用，用户要能回答"助手什么时候改了我的偏好"。
事件是**只追加**的，每条一行，删除记忆时随外键级联清掉。

`before` / `after` 存的是**值**（不是整行 JSON）：记忆只有 kind/key/value/status 四个
有意义的字段，存整行会把来源会话 id 之类的内部标识一起摊到界面上，既无用又多余。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 六种动作：与 API 的 suppress/restore/delete 一一对应，外加 create/update/supersede。
MEMORY_EVENT_CREATE = "create"
MEMORY_EVENT_UPDATE = "update"
MEMORY_EVENT_SUPERSEDE = "supersede"
MEMORY_EVENT_SUPPRESS = "suppress"
MEMORY_EVENT_RESTORE = "restore"
MEMORY_EVENT_DELETE = "delete"
MEMORY_EVENT_ACTIONS: tuple[str, ...] = (
    MEMORY_EVENT_CREATE,
    MEMORY_EVENT_UPDATE,
    MEMORY_EVENT_SUPERSEDE,
    MEMORY_EVENT_SUPPRESS,
    MEMORY_EVENT_RESTORE,
    MEMORY_EVENT_DELETE,
)


class AssistantMemoryEvent(Base):
    """一条记忆变更事件（只追加；按 at 倒序展示）。"""

    __tablename__ = "assistant_memory_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 级联删除：记忆被物理清掉（目前只有测试/维护会这么做）时历史不能留孤儿。
    memory_id: Mapped[int] = mapped_column(
        ForeignKey("assistant_memory.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 取值见 MEMORY_EVENT_ACTIONS。
    action: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    before: Mapped[str] = mapped_column(Text, default="", nullable=False)
    after: Mapped[str] = mapped_column(Text, default="", nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


__all__ = [
    "MEMORY_EVENT_ACTIONS",
    "MEMORY_EVENT_CREATE",
    "MEMORY_EVENT_DELETE",
    "MEMORY_EVENT_RESTORE",
    "MEMORY_EVENT_SUPERSEDE",
    "MEMORY_EVENT_SUPPRESS",
    "MEMORY_EVENT_UPDATE",
    "AssistantMemoryEvent",
]

# SPDX-License-Identifier: Apache-2.0
"""通知（inbox）：所有"该让用户知道"的事件先落一行，界面再决定怎么呈现。

**为什么单独一张表**：提醒到期、任务完成这类事件此前只走"应用内 toast / 桌面通知"，
窗口不在就彻底错过；也没有"未读"这个概念。把事件先落库，通道（toast / 桌面通知 /
页头铃铛）都只是**读这张表的不同视图**，错过还能回看。

结构上的四条取舍：

1. **``dedupe_key`` 唯一**：同一次事件被重复投递（60 秒扫描、开机补扫、并发扫描）时
   只有第一行生效——``services/notifications.emit`` 靠这一列做幂等，调用方不必自己查重。
2. **不存业务对象引用**：正文与深链是**事件当时的快照**（``title`` / ``body`` /
   ``deep_link``）。目标被删后通知仍可读，不会点进去 404 才发现"当时到底提醒了什么"。
3. **``read_at`` 而不是布尔**：用户问"什么时候看到的"时还有答案；未读 = ``read_at IS NULL``。
4. **``expires_at``**：inbox 只保留 30 天（CR-25 口径）。清理任务按这一列删，读侧也按它
   过滤——只靠后台清理会让"到期但还没删"的行短暂可见。

``dataset_key`` 与其它业务表同口径：写入时取当前数据集，读取时核对，备份导入带来的
别的数据集的行不会串台。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

#: 通知类型（开放标签：新事件登记一个常量即可，读侧不枚举）。
NOTIFICATION_TYPE_REMINDER_DUE = "reminder_due"
#: 后台任务（投递/采集批次、AI 任务）到终态：成功、失败、取消各一条。
NOTIFICATION_TYPE_BACKGROUND_TASK = "background_task"
#: 助手长任务到终态（``agent_task`` 的 done/failed）。
NOTIFICATION_TYPE_AGENT_TASK = "agent_task"

#: 客户端（前端）可上报的类型：任务终态由**执行它的那一侧**最先知道，
#: 后端线程写库与前端轮询到终态是两个时钟。其余类型只能由后台事件产生，
#: 否则任何页面都能伪造一条"系统提醒"。
CLIENT_REPORTABLE_TYPES: tuple[str, ...] = (
    NOTIFICATION_TYPE_BACKGROUND_TASK,
    NOTIFICATION_TYPE_AGENT_TASK,
)
#: 严重度：只影响呈现（颜色/是否打断），不改变投递语义。
NOTIFICATION_SEVERITY_INFO = "info"
NOTIFICATION_SEVERITY_WARNING = "warning"
NOTIFICATION_SEVERITIES: tuple[str, ...] = (
    NOTIFICATION_SEVERITY_INFO,
    NOTIFICATION_SEVERITY_WARNING,
)


class Notification(Base):
    """一条通知（inbox 行）。"""

    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(32), default="")
    severity: Mapped[str] = mapped_column(String(16), default=NOTIFICATION_SEVERITY_INFO)
    title: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    # 点通知跳哪：站内路径（如 /tracker?reminder=12）；空串 = 无跳转。
    deep_link: Mapped[str] = mapped_column(String(500), default="")
    # 幂等键：同一次事件只落一行（唯一索引见迁移 0027）。业务侧保证可重建、可读。
    dedupe_key: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    # NULL = 永不过期；提醒类通知默认 30 天后过期（inbox 保留窗口）。
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dataset_key: Mapped[str] = mapped_column(String(32), default="main", nullable=False)


__all__ = [
    "CLIENT_REPORTABLE_TYPES",
    "NOTIFICATION_SEVERITIES",
    "NOTIFICATION_SEVERITY_INFO",
    "NOTIFICATION_SEVERITY_WARNING",
    "NOTIFICATION_TYPE_AGENT_TASK",
    "NOTIFICATION_TYPE_BACKGROUND_TASK",
    "NOTIFICATION_TYPE_REMINDER_DUE",
    "Notification",
]

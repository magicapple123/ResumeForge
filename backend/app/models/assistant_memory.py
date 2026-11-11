# SPDX-License-Identifier: Apache-2.0
"""助手语义记忆（0015，#31A / #18D 合并模型）。

三档记忆里缺的那一档：情景记忆（chat_message 追加日志）与程序记忆（assistant_skill）
已有，**语义记忆**（关于用户/世界的稳定事实）没有。这张表就是它，且**只有这一张**：
手填画像（#18D）source=manual、自动抽取（#31A）source=extracted，避免两份「目标岗位」
互相打架。

生命周期三条（数据不变量，不是 UI 细节）：

1. **kind 白名单**：只记求职相关的七类事实（见 MEMORY_KINDS），其余一律不记。
   白名单同时被抽取器、API 与设置页使用——只在代码里单源，不在 DB 建 CHECK。
2. **冲突不删除**：同类不同值时旧条置 superseded、新条 active，两条都留着，
   必须能回溯「当时说的是什么」。
3. **可见可改**：用户显式删除置 status=deleted（软删，不物理删除），
   source_conversation_id / source_message_id 让设置页能点回原对话。
"""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# ===== kind 白名单（只允许这几类，其余一律不记）=====
MEMORY_KIND_TARGET_ROLE = "target_role"
MEMORY_KIND_CITY = "city"
MEMORY_KIND_SALARY_FLOOR = "salary_floor"
MEMORY_KIND_AVOID_COMPANY = "avoid_company"
MEMORY_KIND_WORK_MODE = "work_mode"
MEMORY_KIND_SKILL_TAG = "skill_tag"
MEMORY_KIND_CONSTRAINT = "constraint"

MEMORY_KINDS: tuple[str, ...] = (
    MEMORY_KIND_TARGET_ROLE,
    MEMORY_KIND_CITY,
    MEMORY_KIND_SALARY_FLOOR,
    MEMORY_KIND_AVOID_COMPANY,
    MEMORY_KIND_WORK_MODE,
    MEMORY_KIND_SKILL_TAG,
    MEMORY_KIND_CONSTRAINT,
)

# 面向用户的 kind 展示名（后端不翻译，前端按 kind 映射语言包）。
MEMORY_KIND_LABELS: dict[str, str] = {
    MEMORY_KIND_TARGET_ROLE: "目标岗位",
    MEMORY_KIND_CITY: "意向城市",
    MEMORY_KIND_SALARY_FLOOR: "薪资底线",
    MEMORY_KIND_AVOID_COMPANY: "不考虑的公司",
    MEMORY_KIND_WORK_MODE: "工作方式",
    MEMORY_KIND_SKILL_TAG: "技术栈",
    MEMORY_KIND_CONSTRAINT: "约束",
}

# ===== 状态 =====
MEMORY_STATUS_ACTIVE = "active"
MEMORY_STATUS_SUPERSEDED = "superseded"
MEMORY_STATUS_DELETED = "deleted"
MEMORY_STATUSES: tuple[str, ...] = (
    MEMORY_STATUS_ACTIVE,
    MEMORY_STATUS_SUPERSEDED,
    MEMORY_STATUS_DELETED,
)

# ===== 来源（#18D 与 #31A 共用一个模型）=====
MEMORY_SOURCE_MANUAL = "manual"
MEMORY_SOURCE_EXTRACTED = "extracted"
MEMORY_SOURCES: tuple[str, ...] = (MEMORY_SOURCE_MANUAL, MEMORY_SOURCE_EXTRACTED)


class AssistantMemory(Base):
    """一条语义记忆：用户明确表达（或可从中稳定抽取）的求职事实。"""

    __tablename__ = "assistant_memory"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 取值见 MEMORY_KINDS；服务端拒绝白名单之外的 kind。
    kind: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    # 维度内的键（例如 salary_floor 可能以城市为键）；无更细维度时留空。
    key: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # 0–1 的置信度：手填默认 1，自动抽取按明确程度给分。
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    source_conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_conversation.id", ondelete="SET NULL"), nullable=True
    )
    source_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_message.id", ondelete="SET NULL"), nullable=True
    )
    # active / superseded / deleted（见模块顶部常量）。
    status: Mapped[str] = mapped_column(String(16), default=MEMORY_STATUS_ACTIVE, nullable=False)
    # manual / extracted（#18D 手填与 #31A 自动抽取共用同一模型）。
    source: Mapped[str] = mapped_column(String(16), default=MEMORY_SOURCE_MANUAL, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


__all__ = [
    "MEMORY_KINDS",
    "MEMORY_KIND_AVOID_COMPANY",
    "MEMORY_KIND_CITY",
    "MEMORY_KIND_CONSTRAINT",
    "MEMORY_KIND_LABELS",
    "MEMORY_KIND_SALARY_FLOOR",
    "MEMORY_KIND_SKILL_TAG",
    "MEMORY_KIND_TARGET_ROLE",
    "MEMORY_KIND_WORK_MODE",
    "MEMORY_SOURCES",
    "MEMORY_SOURCE_EXTRACTED",
    "MEMORY_SOURCE_MANUAL",
    "MEMORY_STATUSES",
    "MEMORY_STATUS_ACTIVE",
    "MEMORY_STATUS_DELETED",
    "MEMORY_STATUS_SUPERSEDED",
    "AssistantMemory",
]

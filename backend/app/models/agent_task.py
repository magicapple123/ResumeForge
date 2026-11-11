# SPDX-License-Identifier: Apache-2.0
"""Agent 任务层：多步计划的持久化状态（T19，依据 T18 Gate 结论）。

**为什么新建表而不是扩展 ai_task**：完整论证在
`.workbuddy/audit/t18-ai-task-vs-agent-task.md`；一句话——`ai_task` 的公开契约是
"单任务生命周期 + 中断即 failed"，而 Agent 任务需要"多步计划 + 每步状态 + 等待人工
确认 + 重启可继续 + 幂等重试"。把后者塞进前者等于让六个既有 AI 入口都承担一套它们
从不使用的状态语义。

结构：

- `agent_task`：计划头（谁、目标、走到哪一步、整体状态）。
- `agent_task_step`：每步一行、状态机独立；唯一约束 `(task_id, step_index)` 保证
  "同一步只有一行"——重试靠 `attempt` 计数 + 条件写，不是新插一行。

跨重启语义（T18 §3）：应用重启时 `running` 一律转 `paused`（**不是** failed）；
`resume_cursor` 记录"下一次该从哪一步继续"，已完成的步骤不重跑。
`waiting_approval` 不占线程、也不被启动恢复放行——只有用户的显式 REST 调用能推进它。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .profile import utcnow

# ===== 任务状态 =====
AGENT_TASK_STATUS_DRAFT = "draft"
AGENT_TASK_STATUS_RUNNING = "running"
AGENT_TASK_STATUS_PAUSED = "paused"
AGENT_TASK_STATUS_WAITING_APPROVAL = "waiting_approval"
AGENT_TASK_STATUS_DONE = "done"
AGENT_TASK_STATUS_FAILED = "failed"
AGENT_TASK_STATUS_CANCELLED = "cancelled"

AGENT_TASK_STATUSES: tuple[str, ...] = (
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STATUS_PAUSED,
    AGENT_TASK_STATUS_WAITING_APPROVAL,
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STATUS_FAILED,
    AGENT_TASK_STATUS_CANCELLED,
)

#: 终态：到达后不再接受推进/暂停/取消（重复取消等幂等语义由服务层单独定义）。
AGENT_TASK_TERMINAL_STATUSES: tuple[str, ...] = (
    AGENT_TASK_STATUS_DONE,
    AGENT_TASK_STATUS_FAILED,
    AGENT_TASK_STATUS_CANCELLED,
)

#: 启动恢复只碰这一个状态：进程死了，running 不会再有人推进。
AGENT_TASK_RUNNING_STATUSES: tuple[str, ...] = (AGENT_TASK_STATUS_RUNNING,)

#: 还没到终态、允许被用户操作（推进/暂停/恢复/取消）的状态。
AGENT_TASK_ACTIVE_STATUSES: tuple[str, ...] = (
    AGENT_TASK_STATUS_DRAFT,
    AGENT_TASK_STATUS_RUNNING,
    AGENT_TASK_STATUS_PAUSED,
    AGENT_TASK_STATUS_WAITING_APPROVAL,
)

# ===== 步骤状态 =====
AGENT_TASK_STEP_STATUS_PENDING = "pending"
AGENT_TASK_STEP_STATUS_RUNNING = "running"
AGENT_TASK_STEP_STATUS_WAITING_APPROVAL = "waiting_approval"
AGENT_TASK_STEP_STATUS_DONE = "done"
AGENT_TASK_STEP_STATUS_FAILED = "failed"
AGENT_TASK_STEP_STATUS_SKIPPED = "skipped"

AGENT_TASK_STEP_STATUSES: tuple[str, ...] = (
    AGENT_TASK_STEP_STATUS_PENDING,
    AGENT_TASK_STEP_STATUS_RUNNING,
    AGENT_TASK_STEP_STATUS_WAITING_APPROVAL,
    AGENT_TASK_STEP_STATUS_DONE,
    AGENT_TASK_STEP_STATUS_FAILED,
    AGENT_TASK_STEP_STATUS_SKIPPED,
)

# ===== 任务来源（开放标签：新入口登记一个常量即可，不影响既有取值） =====
AGENT_TASK_SOURCE_MANUAL = "manual"
AGENT_TASK_SOURCE_REMINDER = "reminder"
# 期一跟进巡检：卡由"沉默超过阈值的求职进度"生成，不是某条提醒的到期扫描。
AGENT_TASK_SOURCE_FOLLOWUP = "followup"
AGENT_TASK_SOURCES: tuple[str, ...] = (
    AGENT_TASK_SOURCE_MANUAL,
    AGENT_TASK_SOURCE_REMINDER,
    AGENT_TASK_SOURCE_FOLLOWUP,
)

# ===== 跟进巡检卡的去重维度（与 source=followup 配套使用） =====
# ``source_ref``：同一 source 下的"桶"标识。两类卡各一个桶——>7 天出跟进卡、
# >21 天出确认卡，二者互斥但同周可并存，所以必须分开去重。
AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP = "stalled_followup"
AGENT_TASK_SOURCE_REF_STALLED_CONFIRM = "stalled_confirm"
AGENT_TASK_SOURCE_REFS: tuple[str, ...] = (
    AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP,
    AGENT_TASK_SOURCE_REF_STALLED_CONFIRM,
)


class AgentTask(Base):
    """一次多步 Agent 任务的计划头。

    `dataset_key` 在创建时写入 `runtime.dataset_scope.current_dataset_id()`，任何读写
    都先核对：备份导入/数据集切换等路径可能把别的数据集的旧行带进当前库，服务层不能
    把"行存在于当前库"当成"属于当前数据集"。
    """

    __tablename__ = "agent_task"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 关联的助手会话（可空：任务可以脱离对话由提醒/手动创建）。刻意不加外键：
    # 会话被删后任务记录仍要留下，用于解释"这个任务是从哪来的"。
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    dataset_key: Mapped[str] = mapped_column(String(32), default="main", nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="")
    # 用户目标原话：步骤是"怎么做"，这里是"为什么做"，失败时可读地解释上下文。
    goal: Mapped[str] = mapped_column(Text, default="")
    # #18A 执行所需的最小输入（JSON）：kind + resume_id/section/instruction、url/limit、
    # job_ids…。只放执行参数，不存正文/隐私/密钥；NULL = 迁移前创建的老任务（执行器不猜，
    # 如实报"缺少执行参数"）。迁移 0017 加列。
    params: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # draft/running/paused/waiting_approval/done/failed/cancelled（见模块顶部常量）。
    status: Mapped[str] = mapped_column(String(24), default=AGENT_TASK_STATUS_DRAFT, index=True)
    # 0 基的"当前/下一步"步骤下标：等于已完成步骤数。所有步骤完成时等于步骤总数。
    resume_cursor: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 来源标签：manual / reminder / …（开放集合，用于事后解释任务从哪来）。
    source: Mapped[str] = mapped_column(String(32), default=AGENT_TASK_SOURCE_MANUAL)
    # T26 事件触发：这张卡由哪条提醒的哪一次到期时刻生成。可空——手动/其它来源不填。
    # **去重键 = (reminder_id, occurrence_due_at)**：同一提醒同一到期时刻重复扫描只生成
    # 一张卡；提醒被延期/改时间 → occurrence_due_at 变 → 允许再生成一条（旧卡保留。
    # 刻意不加外键：提醒被删后任务卡仍要留下解释"从哪来"，与 conversation_id 同一取舍。
    reminder_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurrence_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 期一跟进巡检的去重键（NULL 行不参与唯一约束）：
    # - ``source_ref``：卡属于哪个桶（stalled_followup / stalled_confirm）；
    # - ``occurrence_key``：本地日期所在 ISO 周（如 2026-W45）。
    # 提醒卡两列为 NULL，仍由 (reminder_id, occurrence_due_at) 去重；手动卡同样两列
    # 为 NULL、SQLite 视 NULL 互不相同，所以它们照旧不受任何唯一约束影响。
    source_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurrence_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 失败/取消原因（只写原因，引导文案由前端补）。
    error: Mapped[str] = mapped_column(Text, default="")

    steps: Mapped[list[AgentTaskStep]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="AgentTaskStep.step_index",
    )

    __table_args__ = (
        # T26 去重键：同一提醒的同一 occurrence 只生成一张任务卡（NULL 行不受限，
        # 手动/其它来源的卡 reminder_id 与 occurrence_due_at 都是 NULL）。
        UniqueConstraint(
            "reminder_id",
            "occurrence_due_at",
            name="uq_agent_task_reminder_occurrence",
        ),
        # 跟进巡检去重键：同一 source + 桶 + 周只生成一张卡；两类卡各一个桶。
        # 两列都为 NULL 的行（提醒卡/手动卡）不参与本约束——SQLite 的 UNIQUE 允许多个
        # NULL，所以既有卡一张不丢、不重，语义与 0006 之前逐字一致。
        UniqueConstraint(
            "source",
            "source_ref",
            "occurrence_key",
            name="uq_agent_task_source_occurrence",
        ),
    )


class AgentTaskStep(Base):
    """计划里的一步。

    重试语义刻意分成两层：**行**只有一条（唯一约束 `(task_id, step_index)`），
    "第几次尝试"记在 `attempt` 上——这样"同一步重复完成"不会长出新业务行，
    幂等性可以用行数/计数直接断言。
    """

    __tablename__ = "agent_task_step"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("agent_task.id", ondelete="CASCADE"), index=True
    )
    step_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 步骤类型（fill/confirm/generate/…）：由上层定义，本表只当标签存。
    kind: Mapped[str] = mapped_column(String(32), default="")
    title: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(24), default=AGENT_TASK_STEP_STATUS_PENDING)
    # 输入摘要的哈希：不存原始输入（可能含隐私），只用于判断"重试时输入是否变了"。
    input_digest: Mapped[str] = mapped_column(String(64), default="")
    # 产出的落点标识（如 {"record_id": 7}）；业务结果本体仍保存在各自业务表。
    output_ref: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 第几次尝试完成（计数，不产生新行）。
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    task: Mapped[AgentTask] = relationship(back_populates="steps")

    __table_args__ = (
        UniqueConstraint("task_id", "step_index", name="uq_agent_task_step_task_id_step_index"),
    )


__all__ = [
    "AGENT_TASK_ACTIVE_STATUSES",
    "AGENT_TASK_RUNNING_STATUSES",
    "AGENT_TASK_SOURCES",
    "AGENT_TASK_SOURCE_FOLLOWUP",
    "AGENT_TASK_SOURCE_MANUAL",
    "AGENT_TASK_SOURCE_REFS",
    "AGENT_TASK_SOURCE_REF_STALLED_CONFIRM",
    "AGENT_TASK_SOURCE_REF_STALLED_FOLLOWUP",
    "AGENT_TASK_SOURCE_REMINDER",
    "AGENT_TASK_STATUSES",
    "AGENT_TASK_STATUS_CANCELLED",
    "AGENT_TASK_STATUS_DONE",
    "AGENT_TASK_STATUS_DRAFT",
    "AGENT_TASK_STATUS_FAILED",
    "AGENT_TASK_STATUS_PAUSED",
    "AGENT_TASK_STATUS_RUNNING",
    "AGENT_TASK_STATUS_WAITING_APPROVAL",
    "AGENT_TASK_STEP_STATUSES",
    "AGENT_TASK_STEP_STATUS_DONE",
    "AGENT_TASK_STEP_STATUS_FAILED",
    "AGENT_TASK_STEP_STATUS_PENDING",
    "AGENT_TASK_STEP_STATUS_RUNNING",
    "AGENT_TASK_STEP_STATUS_SKIPPED",
    "AGENT_TASK_STEP_STATUS_WAITING_APPROVAL",
    "AGENT_TASK_TERMINAL_STATUSES",
    "AgentTask",
    "AgentTaskStep",
]

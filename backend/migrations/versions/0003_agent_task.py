# SPDX-License-Identifier: Apache-2.0
"""0003：Agent 任务层——`agent_task` + `agent_task_step`（T19）。

背景（T18 Gate 结论，见 `.workbuddy/audit/t18-ai-task-vs-agent-task.md`）：
`ai_task` 只承载"单任务生命周期、中断即 failed"，无法表达"多步计划 + 每步状态 +
等待人工确认 + 重启可继续 + 幂等重试"。因此新建两张表，而不扩展既有 `ai_task`：

- `agent_task`：计划头（状态 draft/running/paused/waiting_approval/done/failed/cancelled、
  `resume_cursor` 记录下一次该继续的步骤下标、`dataset_key` 记录归属数据集）；
- `agent_task_step`：每步一行，唯一约束 `(task_id, step_index)` 保证"同一步只有一行"
  ——重试是 `attempt` 计数 + 条件写，不产生新行；`task_id` 外键 `ON DELETE CASCADE`。

DDL 只加表/索引/唯一约束，不改动任何既有列与数据。downgrade 反序删除两张表；
表不存在时跳过而不是报错（迁移会跑在"只有部分业务表"的库上，例如旧备份包解出来的
候选库——导入侧先迁移再校验表结构）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_agent_task"
down_revision: str | Sequence[str] | None = "0002_assistant_write_proposal"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """建 `agent_task` 与 `agent_task_step`（含索引与唯一约束）；已存在则跳过。"""
    tables = _table_names()
    if "agent_task" not in tables:
        op.create_table(
            "agent_task",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("conversation_id", sa.Integer(), nullable=True),
            sa.Column("dataset_key", sa.String(length=32), nullable=False, server_default="main"),
            sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("goal", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="draft"),
            sa.Column("resume_cursor", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
        )
        op.create_index(
            "ix_agent_task_conversation_id",
            "agent_task",
            ["conversation_id"],
            unique=False,
        )
        op.create_index("ix_agent_task_status", "agent_task", ["status"], unique=False)

    if "agent_task_step" not in _table_names():
        op.create_table(
            "agent_task_step",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "task_id",
                sa.Integer(),
                sa.ForeignKey("agent_task.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("step_index", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
            sa.Column("input_digest", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("output_ref", sa.JSON(), nullable=True),
            sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint(
                "task_id",
                "step_index",
                name="uq_agent_task_step_task_id_step_index",
            ),
        )
        op.create_index(
            "ix_agent_task_step_task_id",
            "agent_task_step",
            ["task_id"],
            unique=False,
        )


def downgrade() -> None:
    """严格反序删除：先删步骤表（外键子表），再删任务表；不存在则跳过。"""
    tables = _table_names()
    if "agent_task_step" in tables:
        op.drop_table("agent_task_step")
    if "agent_task" in tables:
        op.drop_table("agent_task")

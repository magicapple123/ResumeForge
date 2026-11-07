# SPDX-License-Identifier: Apache-2.0
"""0004：T26 事件触发——agent_task 接提醒 occurrence。

新增两列与一个唯一约束（不改任何既有列/数据）：

-  reminder_id         ：这张任务卡由哪条提醒生成（可空，手动/其它来源不填）。
-  occurrence_due_at   ：该提醒的**这一次**到期时刻（绝对时间，UTC naive，与全库口径一致）。
- 唯一索引 uq_agent_task_reminder_occurrence(reminder_id, occurrence_due_at)：
  去重键。同一提醒同一到期时刻重复扫描只生成一张卡；提醒被延期/改时间 →
  occurrence_due_at 变 → 允许再生成一条（旧卡保留）。NULL 行不受唯一约束限制
  （SQLite 的 UNIQUE 允许多个 NULL），手动任务照常不受影响。

SQLite 不支持 ALTER TABLE ADD CONSTRAINT，所以唯一性用**唯一索引**表达（语义等价；
模型侧对应 UniqueConstraint，二者列集合一致）。downgrade 反序删索引与列，列/索引
不存在时跳过（迁移可能跑在只有部分业务表的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_agent_task_reminder_occurrence"
down_revision: str | Sequence[str] | None = "0003_agent_task"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UNIQUE_NAME = "uq_agent_task_reminder_occurrence"
_COLUMNS = ("reminder_id", "occurrence_due_at")


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("agent_task")}


def _index_names() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {index["name"] for index in inspector.get_indexes("agent_task")}


def upgrade() -> None:
    """给 agent_task 加 occurrence 两列 + 唯一索引；表/列/索引已存在则跳过。"""
    if "agent_task" not in _table_names():
        return
    existing = _columns()
    if "reminder_id" not in existing:
        op.add_column("agent_task", sa.Column("reminder_id", sa.Integer(), nullable=True))
    if "occurrence_due_at" not in existing:
        op.add_column("agent_task", sa.Column("occurrence_due_at", sa.DateTime(), nullable=True))
    if _UNIQUE_NAME not in _index_names():
        op.create_index(_UNIQUE_NAME, "agent_task", list(_COLUMNS), unique=True)


def downgrade() -> None:
    """严格反序：先删唯一索引，再删列；不存在则跳过。"""
    if "agent_task" not in _table_names():
        return
    if _UNIQUE_NAME in _index_names():
        op.drop_index(_UNIQUE_NAME, table_name="agent_task")
    existing = _columns()
    if "occurrence_due_at" in existing:
        op.drop_column("agent_task", "occurrence_due_at")
    if "reminder_id" in existing:
        op.drop_column("agent_task", "reminder_id")

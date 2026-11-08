# SPDX-License-Identifier: Apache-2.0
"""0006：跟进巡检——agent_task 去重键两列 + application_follow_up 决策表。

期一（跟进巡检）的数据层。两件事一起做，因为巡检产出的卡与用户对卡做出的决策必须
同批可用：

-  agent_task 加 source_ref / occurrence_key 两列与唯一索引
   uq_agent_task_source_occurrence：既有唯一约束只覆盖
   (reminder_id, occurrence_due_at)，而跟进卡的 reminder_id 为 NULL——
   SQLite 视 NULL 互不相同，等于没有去重。巡检按"卡类型桶 + ISO 周"命名，
   同一桶同一周只允许一张卡；不同类型（stalled_followup / stalled_confirm）
   各算一个桶，可同周并存。**旧行两列为 NULL，不参与唯一约束**，提醒卡去重语义
   一个字都没变；uq_agent_task_reminder_occurrence 原样保留。
-  application_follow_up：用户对跟进卡的决策（已联系 / 对方已回 / 不跟了）。
   只记录决策，**绝不改** application_track 的状态——「对方已回」不是漏斗推进，
   写进状态会在用户已手工推到「面试」的记录上被 resolve_status() 原样吞掉，
   点了没反应比改错更难查。历史"催过没"没有据可查，新表空起步、不回填。

SQLite 不支持 ALTER TABLE ADD CONSTRAINT，唯一性用**唯一索引**表达（语义等价；
模型侧对应 UniqueConstraint，二者列集合一致）。downgrade 严格反序、表/列/索引不
存在时跳过（迁移会跑在只有部分业务表的库上，例如旧备份解出来的候选库）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_followup_sweep"
down_revision: str | Sequence[str] | None = "0005_conversation_skill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_AGENT_TASK = "agent_task"
_AGENT_TASK_SOURCE_UNIQUE = "uq_agent_task_source_occurrence"
_AGENT_TASK_SOURCE_COLUMNS = ("source", "source_ref", "occurrence_key")
_FOLLOW_UP = "application_follow_up"
_FOLLOW_UP_TRACK_INDEX = "ix_application_follow_up_track_decided"
_FOLLOW_UP_DECISION_CHECK = "ck_application_follow_up_decision"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    """给 agent_task 加两列 + 唯一索引，再建决策表；已存在则跳过。"""
    if _AGENT_TASK in _table_names():
        columns = _column_names(_AGENT_TASK)
        if "source_ref" not in columns:
            op.add_column(_AGENT_TASK, sa.Column("source_ref", sa.String(length=64), nullable=True))
        if "occurrence_key" not in columns:
            op.add_column(
                _AGENT_TASK, sa.Column("occurrence_key", sa.String(length=32), nullable=True)
            )
        if _AGENT_TASK_SOURCE_UNIQUE not in _index_names(_AGENT_TASK):
            op.create_index(
                _AGENT_TASK_SOURCE_UNIQUE,
                _AGENT_TASK,
                list(_AGENT_TASK_SOURCE_COLUMNS),
                unique=True,
            )

    if _FOLLOW_UP not in _table_names():
        op.create_table(
            _FOLLOW_UP,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "track_id",
                sa.Integer(),
                sa.ForeignKey("application_track.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("decided_at", sa.DateTime(), nullable=False),
            sa.Column("decision", sa.String(length=16), nullable=False),
            sa.Column("draft_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            # 决策来自哪张任务卡：可空（历史/手动补录没有卡），刻意不加外键——
            # 任务卡被清理后决策仍要留下解释"当时为什么这么标"。
            sa.Column("task_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.CheckConstraint(
                "decision IN ('contacted','replied','stopped')",
                name=_FOLLOW_UP_DECISION_CHECK,
            ),
        )
        op.create_index(
            _FOLLOW_UP_TRACK_INDEX, _FOLLOW_UP, ["track_id", "decided_at"], unique=False
        )


def downgrade() -> None:
    """严格反序：先删决策表，再删 agent_task 的唯一索引与两列；不存在则跳过。"""
    if _FOLLOW_UP in _table_names():
        if _FOLLOW_UP_TRACK_INDEX in _index_names(_FOLLOW_UP):
            op.drop_index(_FOLLOW_UP_TRACK_INDEX, table_name=_FOLLOW_UP)
        op.drop_table(_FOLLOW_UP)
    if _AGENT_TASK in _table_names():
        if _AGENT_TASK_SOURCE_UNIQUE in _index_names(_AGENT_TASK):
            op.drop_index(_AGENT_TASK_SOURCE_UNIQUE, table_name=_AGENT_TASK)
        columns = _column_names(_AGENT_TASK)
        if "occurrence_key" in columns:
            op.drop_column(_AGENT_TASK, "occurrence_key")
        if "source_ref" in columns:
            op.drop_column(_AGENT_TASK, "source_ref")

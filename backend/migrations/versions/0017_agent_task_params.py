# SPDX-License-Identifier: Apache-2.0
"""0017：#18A 助手长任务执行器——agent_task.params（执行所需的最小输入）。

18A 补真正的后台执行器后，任务不只是"一句话计划"，还要知道执行所需的输入：
哪份简历 + 改写要求、哪个链接 + 条数、哪些岗位。这些参数原本在 task_create 的
arguments 里，建任务时被丢弃（AgentTask 没有 params 列），执行器就拿不到输入。

本迁移只给 agent_task 加一列 `params JSON NULL`（不建表、不删数据、不改索引）：
- 只存**执行所需的最小输入**（resume_id / section / instruction / url / limit / job_ids），
  不存隐私正文、不存密钥；
- NULL = 老任务（本迁移之前创建的）没有可执行参数，执行器见到会如实报错而不是猜；
- 新迁移不改表清单，备份表清单守卫不受影响。

升级/降级都要能跑：表或列不存在时跳过而不是报错（迁移会跑在"只有部分业务表"的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_agent_task_params"
down_revision: str | Sequence[str] | None = "0016_skill_learning"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TASK_TABLE = "agent_task"
_PARAMS_COLUMN = "params"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """给 agent_task 加 params 列；表/列不存在则跳过。"""
    if _TASK_TABLE not in _table_names():
        return
    if _PARAMS_COLUMN in _column_names(_TASK_TABLE):
        return
    op.add_column(_TASK_TABLE, sa.Column(_PARAMS_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    """删本迁移加的列；表/列不存在则跳过。"""
    if _TASK_TABLE not in _table_names():
        return
    if _PARAMS_COLUMN not in _column_names(_TASK_TABLE):
        return
    op.drop_column(_TASK_TABLE, _PARAMS_COLUMN)

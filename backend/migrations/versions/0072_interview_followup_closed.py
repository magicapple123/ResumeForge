# SPDX-License-Identifier: Apache-2.0
"""0072：面试结束后的追问区「停止 / 继续追问」（#41）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

interview_session 一列：

- follow_up_closed_at（DATETIME，可空）：该会话的追问区被用户**收起**的时刻。
  NULL = 追问区开放（历史会话升级后就是这个状态，行为逐字节不变）。

语义上它只影响"还能不能发追问"，**不动**会话的 status：一场已结束（finished）的
面试收起追问之后仍然是 finished，answered_rounds 也不会因此变化——追问从一开始
就不计入轮次。

**升级安全**：表不存在时直接返回；加列前检查已存在，重复执行不报错。可空列保证历史行
升级后仍可继续追问（与 0071 前的行为一致）。

**downgrade 完整可逆**：SQLite 删列走 batch_alter_table（重建表），列移除后表结构
与升级前一致。

Revision ID: 0072_interview_followup_closed
Revises: 0071_interview_materials
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072_interview_followup_closed"
down_revision: str | Sequence[str] | None = "0071_interview_materials"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "interview_session"
_COLUMN = sa.Column("follow_up_closed_at", sa.DateTime(), nullable=True)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def upgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    if "follow_up_closed_at" not in _columns():
        op.add_column(_TABLE, _COLUMN)


def downgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    existing = _columns()
    if "follow_up_closed_at" in existing:
        with op.batch_alter_table(_TABLE) as batch:
            batch.drop_column("follow_up_closed_at")

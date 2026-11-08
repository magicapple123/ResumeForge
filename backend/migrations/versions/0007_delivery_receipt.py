# SPDX-License-Identifier: Apache-2.0
"""0007：投递交付单——apply_task_item 加 receipt_acked_at。

交付单（期一）的读视图是纯读的，唯一的写入面就是「验收」这一个动作：用户在交付单上
点一下表示"我看过了"。只加一列存这个时刻，**不碰漏斗状态**——验收单据不等于推进流程。

旧行该列为 NULL = 未验收，如实呈现，不回填（历史投递没有单据可验收，补一个时间就是
编造）。downgrade 判存在后删列；表/列不存在时跳过（迁移会跑在只有部分业务表的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_delivery_receipt"
down_revision: str | Sequence[str] | None = "0006_followup_sweep"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "apply_task_item"
_COLUMN = "receipt_acked_at"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """加验收时间列；表/列已存在则跳过。"""
    if _TABLE not in _table_names():
        return
    if _COLUMN in _column_names(_TABLE):
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.DateTime(), nullable=True))


def downgrade() -> None:
    """删验收时间列；表/列不存在则跳过。"""
    if _TABLE not in _table_names():
        return
    if _COLUMN not in _column_names(_TABLE):
        return
    op.drop_column(_TABLE, _COLUMN)

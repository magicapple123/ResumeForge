# SPDX-License-Identifier: Apache-2.0
"""0043：模拟面试支持「自动轮数」——新增可空列 ``interview_session.rounds_min``。

用户反馈：固定轮数让每场面试都可预期（"还剩 2 题"），想要真实面试的未知感。
自动轮数模式下 ``rounds`` 兼作**上限**（最迟强制收尾），``rounds_min`` 是下限
（提示词要求 AI 不要早于它结束）；AI 按候选人表现在这个区间内判断何时收尾。

- NULL = 固定轮数（历史行为，``rounds`` 即精确轮数），无需回填。
- 只加列 + 可跳过（列已存在时跳过）+ 完整 downgrade。

Revision ID: 0043_interview_auto_rounds
Revises: 0042_job_origin_source
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043_interview_auto_rounds"
down_revision: str | Sequence[str] | None = "0042_job_origin_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMN = "rounds_min"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # 迁移链也会跑在"只有部分业务表"的历史库上（备份演练就这么干）。
    if not _table_exists(bind, "interview_session"):
        return
    if not _column_exists(bind, "interview_session", COLUMN):
        op.add_column("interview_session", sa.Column(COLUMN, sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "interview_session") and _column_exists(
        bind, "interview_session", COLUMN
    ):
        op.drop_column("interview_session", COLUMN)

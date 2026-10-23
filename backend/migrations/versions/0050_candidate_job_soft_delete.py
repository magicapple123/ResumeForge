# SPDX-License-Identifier: Apache-2.0
"""0050：给 ``candidate_job`` 加 ``deleted_at`` —— 备选岗位进入回收站范围。

为什么需要它：``candidate_job`` 此前是**硬删除**（``db.delete``），而它与「岗位」只差
一步导入——用户误删一条待处理候选的代价和删掉一条正式岗位一样大，硬删除却没有任何
回退路径，界面上只能如实写"无法恢复"。回收站机制（``services/trash.py``）本来就是
为这类"用户会心疼"的内容准备的，补上这一列之后它进回收站、可恢复、可彻底删除。

**只加列**（"旧备份仍可导入"的前提）：``nullable=True``、无 ``server_default``、无索引。
已有行为 NULL（= 没删），与它们此前的可见性**逐字一致**。
SQLite 对可空列加列不需要重建表，也不需要 CHECK 约束；取值范围只有"NULL / 时间戳"
两种，没有需要收口的枚举。

可能跑在只有部分业务表的历史库上：表不存在时跳过而不是报错。

Revision ID: 0050_candidate_job_soft_delete
Revises: 0049_resume_language
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_candidate_job_soft_delete"
down_revision: str | Sequence[str] | None = "0049_resume_language"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "candidate_job"
_COLUMN = "deleted_at"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # 表不存在（残缺历史库）或列已存在（legacy 库先被 create_all + ensure_sqlite_columns
    # 补过列，再从 0001 stamp 走整条链）都直接跳过，不能让整条迁移链失败。
    if not columns or _COLUMN in columns:
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.DateTime(), nullable=True))


def downgrade() -> None:
    columns = _columns()
    if _COLUMN not in columns:
        return
    # 完整降级：已在回收站里的候选会**重新出现在列表里**（列没了就没有"已删除"这个状态），
    # 但库仍然可用——旧版本不认识这一列，留着反而会让"表结构与修订号不一致"。
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

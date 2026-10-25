# SPDX-License-Identifier: Apache-2.0
"""0063：补充事实字段偏好 profile_fact_field_pref（灵活化契约 §3）。

**只加表**（旧备份仍可导入；事实表/旧资料表一个字节都不改）：

- 新表 profile_fact_field_pref：**按事实类型**保存"哪些默认字段被隐藏 + 有哪些自定义
  字段"。事实 payload 仍存值快照，删除字段定义不丢已录值。
- 没有 deleted_at：它是行为偏好而不是用户内容，恢复默认=清空 hidden+custom，不进
  回收站、不参与"凡有 deleted_at 必须登记 TRASH_SPECS"的守卫。
- 表不存在时创建；已存在时跳过（幂等/部分历史库）。表集合 = 迁移前集合 +
  {profile_fact_field_pref}。

Revision ID: 0063_profile_fact_field_pref
Revises: 0062_profile_facts
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0063_profile_fact_field_pref"
down_revision: str | Sequence[str] | None = "0062_profile_facts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "profile_fact_field_pref"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if _TABLE in _tables():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("hidden_fields", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("custom_fields", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind"),
    )


def downgrade() -> None:
    if _TABLE in _tables():
        op.drop_table(_TABLE)

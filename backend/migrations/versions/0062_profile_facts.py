# SPDX-License-Identifier: Apache-2.0
"""0062：补充事实 profile_fact（A3，计划 §7.1/§8.1）。

**只加表**（旧备份仍可导入；旧资料表与旧 Profile PUT 协议一个字节都不改）：

- 新表 ``profile_fact``：固定六类补充事实（论文/科研项目/专利/资格证照/作品项目/
  实践服务经历），稳定 ``fact_id`` 身份、revision 条件写、``deleted_at`` 软删除。
- 新表带 ``deleted_at`` → 必须登记 ``services/trash.py::TRASH_SPECS``（否则"半软删"：
  列表消失、回收站找不到、不能恢复也不能彻底删除）。
- 不搬旧教育/经历/项目表，不重写任何旧 content；表集合 = 迁移前集合 + ``{profile_fact}``。

Revision ID: 0062_profile_facts
Revises: 0061_career_scenarios
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062_profile_facts"
down_revision: str | Sequence[str] | None = "0061_career_scenarios"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "profile_fact"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if _TABLE in _tables():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fact_id", sa.String(length=32), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["profile_id"], ["user_profile.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fact_id"),
    )
    op.create_index("ix_profile_fact_fact_id", _TABLE, ["fact_id"])
    op.create_index("ix_profile_fact_profile_id", _TABLE, ["profile_id"])
    op.create_index("ix_profile_fact_kind", _TABLE, ["kind"])
    op.create_index("ix_profile_fact_created_at", _TABLE, ["created_at"])


def downgrade() -> None:
    if _TABLE in _tables():
        op.drop_table(_TABLE)

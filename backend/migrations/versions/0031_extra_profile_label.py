"""「网申资料」加 ``label`` 列——让字段清单之外的自定义字段在界面上有人话名字。

## 为什么需要它

2026-09-27 的新需求：填表时除了记目录里的字段，还要能记**目录里没有、但这家公司问了**的框
（「导师姓名」「实验室」）。这类字段的 key 是 ``CUSTOM_导师姓名`` 这种形状（前缀是为了让库里
一眼看得出它不是目录字段），但**界面上不能显示这串东西**——用户看到的是自己当初填的那个
栏目名。

目录**里面**的 key 也往这一列写 ``FIELD_LABELS[key]``，看起来冗余（从目录查得到），但它让
"取这条的显示名"只有一条路径：不用在读取处再判断"这个 key 是自定义的还是目录的"。

## 存量行为什么是空串

``server_default=""`` 表示"从目录取名"——存量行都是目录字段，这正是唯一正确的历史语义，
**所以不加数据迁移**：读取时为空就回落到 ``FIELD_LABELS``。

**只加列**：旧备份迁到 head 时自动补齐，不会因为缺列或表集合变化被拒收。

Revision ID: 0031_extra_profile_label
Revises: 0030_extra_profile_source_reuse
Create Date: 2026-09-27
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_extra_profile_label"
down_revision: str | Sequence[str] | None = "0030_extra_profile_source_reuse"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "web_form_profile_entry"

# 照 0030 的形状：``label`` 是默认空串的可空-非空列。空串 = 从目录取名（见模块说明）。
COLUMN = "label"


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    """判存在再加——迁移链也会跑在"只有部分业务表/列"的历史库上。"""
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    if COLUMN in _columns_of(bind, TABLE):
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.String(length=64), nullable=False, server_default=""),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    if COLUMN not in _columns_of(bind, TABLE):
        return
    op.drop_column(TABLE, COLUMN)

"""「网申资料」加 source / reuse 两列——把"学到的"和"手录的"分开，并让用户能定它下次还填不填。

## 为什么必须有两列，而不是只加一列

2026-09-27 的新需求：填表时**主动记下资料里没有、这次填进去了的值**，下次遇到同一个框自动填。

一个只记"学到什么"的方案会在两处出事：

1. **界面分不清来源**。库里多出来的值是程序推断的，用户看到"这个我什么时候填过"无从回答。
   → ``source``（manual / learned）。
2. **一次性的值被永久预填**。内推码、某家公司的申请编号，第二次自动填就是错的。
   → ``reuse``（general / scenario / once），默认 ``general``。

## 存量行为什么落成 manual + general

两列都有 ``server_default``，所以老库里的行自动拿到 ``manual`` / ``general``——它们本来就是
用户在「网申资料」里手录的，也确实该继续预填。**这就是不加数据迁移的理由**：默认值恰好等于
唯一正确的历史语义。

**只加列**：旧备份迁到 head 时自动补齐，不会因为缺列或表集合变化被拒收。

Revision ID: 0030_extra_profile_source_reuse
Revises: 0029_education_cet_scores
Create Date: 2026-09-27
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_extra_profile_source_reuse"
down_revision: str | Sequence[str] | None = "0029_education_cet_scores"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "web_form_profile_entry"

# (列名, 类型, server_default)。默认值见模块说明——它就是历史语义。
NEW_COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str], ...] = (
    ("source", sa.String(length=16), "manual"),
    ("reuse", sa.String(length=16), "general"),
)


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    """逐列判存在再添加——迁移链也会跑在"只有部分业务表/列"的历史库上。"""
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    for column, column_type, server_default in NEW_COLUMNS:
        if column in _columns_of(bind, TABLE):
            continue
        op.add_column(
            TABLE,
            sa.Column(column, column_type, nullable=False, server_default=server_default),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    for column, _column_type, _server_default in reversed(NEW_COLUMNS):
        if column not in _columns_of(bind, TABLE):
            continue
        op.drop_column(TABLE, column)

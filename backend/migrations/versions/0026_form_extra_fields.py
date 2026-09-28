"""网申资料的补充字段：QQ 号、导师、研究方向、意向行业；教育加院系。

## 为什么单独一个迁移，而不是并进 0025

这几列本来写进了 ``0025``，但那时 ``0025`` **已经在开发机上跑过一次**（激活数据集停在
``0025_web_form_fields``）。Alembic 以 revision 为准，已应用的迁移不会再跑，所以往它里面
追加列**不会生效**——症状是接口 500：``no such column: user_profile.qq``。

**迁移一旦在任何地方执行过就不能再改**，这是那个约定存在的理由。所以把 ``0025`` 还原成它
被执行时的样子，这四列改由本迁移加。两个数据集因此都收敛到同一个终态：
先跑 ``0025``（10 列）再跑 ``0026``（4 列）。

「只加列」的性质与 ``0025`` 相同：旧备份迁到 head 时自动补齐，不会因为缺列或表集合变化
被拒收。

Revision ID: 0026_form_extra_fields
Revises: 0025_web_form_fields
Create Date: 2026-09-26
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_form_extra_fields"
down_revision: str | Sequence[str] | None = "0025_web_form_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 与 0025 同形状：(表名, 列名, 类型, server_default)。
NEW_COLUMNS: tuple[tuple[str, str, sa.types.TypeEngine, str], ...] = (
    # 校招表单里很常见的几项（2026-09-26 按腾讯校招简历页的实测字段补）。
    ("user_profile", "qq", sa.String(length=32), ""),
    ("user_profile", "advisor", sa.String(length=64), ""),
    ("user_profile", "research_direction", sa.String(length=128), ""),
    ("user_profile", "preferred_industry", sa.String(length=128), ""),
    ("education", "department", sa.String(length=128), ""),
)


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    """逐列判存在再添加——迁移链也会跑在"只有部分业务表/列"的历史库上。"""
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table, column, column_type, server_default in NEW_COLUMNS:
        if table not in tables:
            continue
        if column in _columns_of(bind, table):
            continue
        op.add_column(
            table,
            sa.Column(column, column_type, nullable=False, server_default=server_default),
        )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table, column, _column_type, _server_default in reversed(NEW_COLUMNS):
        if table not in tables:
            continue
        if column not in _columns_of(bind, table):
            continue
        op.drop_column(table, column)

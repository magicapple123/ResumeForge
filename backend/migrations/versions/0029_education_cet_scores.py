"""教育经历加四六级分数两列。

## 为什么放在教育经历上

网申表单普遍问**四六级具体分数**（不少系统按分数自动筛，只填"已通过"过不了），而成绩是
在**某段学历期间**考出来的，所以它属于教育经历，不属于基本信息。用户也是这么要求的：
"把四六级分数放到教育经历里面"。

自由文本而非整数：``""``（没填）/ ``"512"`` / ``"未考"`` 都可能，不做规范化——规范化只会在
填表时多一层猜测，而站点要的是原样写进去。

**只加列**：旧备份迁到 head 时自动补齐（``server_default`` 保证存量行有值），不会因为缺列
或表集合变化被拒收。

Revision ID: 0029_education_cet_scores
Revises: 0028_web_form_profile
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_education_cet_scores"
down_revision: str | Sequence[str] | None = "0028_web_form_profile"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (表名, 列名, 类型, server_default)。
NEW_COLUMNS: tuple[tuple[str, str, sa.types.TypeEngine, str], ...] = (
    ("education", "cet4_score", sa.String(length=16), ""),
    ("education", "cet6_score", sa.String(length=16), ""),
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
        op.add_column(table, sa.Column(column, column_type, nullable=False, server_default=server_default))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table, column, _column_type, _server_default in reversed(NEW_COLUMNS):
        if table not in tables:
            continue
        if column not in _columns_of(bind, table):
            continue
        op.drop_column(table, column)

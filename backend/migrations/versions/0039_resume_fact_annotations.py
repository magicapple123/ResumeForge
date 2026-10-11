"""给简历记录加「事实来源标注」一列（RF-13）。

只加列：旧备份/旧记录没有该列时按空列表读取（"没有标注"），不需要回填任何
历史数据。标注描述生成时每段内容来自哪条资料事实（grounded / restored /
enhanced_kept），由生成链路纯收集已有映射产出，不调模型。

Revision ID: 0039_resume_fact_annotations
Revises: 0038_user_files
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039_resume_fact_annotations"
down_revision: str | Sequence[str] | None = "0038_user_files"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "resume_record"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        return
    if not _column_exists(bind, TABLE, "fact_annotations"):
        # 只加列：旧行保持 NULL，读取方用 ``or []`` 兜底（与 coverage_notes 一致）。
        op.add_column(TABLE, sa.Column("fact_annotations", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        return
    if _column_exists(bind, TABLE, "fact_annotations"):
        op.drop_column(TABLE, "fact_annotations")

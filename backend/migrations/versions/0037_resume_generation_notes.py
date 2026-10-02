"""给简历记录加「生成说明」与「未收录清单」两列。

Revision ID: 0037_resume_generation_notes
Revises: 0036_chat_conversation_surface
Create Date: 2026-10-01
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037_resume_generation_notes"
down_revision: str | Sequence[str] | None = "0036_chat_conversation_surface"
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
    if not _column_exists(bind, TABLE, "coverage_notes"):
        # 只加列：旧备份/旧记录没有这两列时按空值读取（"没有说明"），
        # 不需要回填任何历史数据。
        op.add_column(TABLE, sa.Column("coverage_notes", sa.JSON(), nullable=True))
    if not _column_exists(bind, TABLE, "rationale"):
        op.add_column(
            TABLE, sa.Column("rationale", sa.Text(), nullable=False, server_default="")
        )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        return
    if _column_exists(bind, TABLE, "rationale"):
        op.drop_column(TABLE, "rationale")
    if _column_exists(bind, TABLE, "coverage_notes"):
        op.drop_column(TABLE, "coverage_notes")

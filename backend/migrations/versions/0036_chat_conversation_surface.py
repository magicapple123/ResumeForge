"""给助手会话增加入口作用域，隔离侧栏与投投悬浮球历史。

Revision ID: 0036_chat_conversation_surface
Revises: 0035_llm_thinking
Create Date: 2026-10-01
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036_chat_conversation_surface"
down_revision: str | Sequence[str] | None = "0035_llm_thinking"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "chat_conversation"
COLUMN = "surface"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE) or _column_exists(bind, TABLE, COLUMN):
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.String(length=16), nullable=False, server_default="page"),
    )
    op.create_index("ix_chat_conversation_surface", TABLE, [COLUMN], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE) or not _column_exists(bind, TABLE, COLUMN):
        return
    inspector = sa.inspect(bind)
    index_names = {item["name"] for item in inspector.get_indexes(TABLE)}
    if "ix_chat_conversation_surface" in index_names:
        op.drop_index("ix_chat_conversation_surface", table_name=TABLE)
    op.drop_column(TABLE, COLUMN)


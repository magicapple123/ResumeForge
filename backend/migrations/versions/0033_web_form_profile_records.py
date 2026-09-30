"""网申资料补充记录支持多条。"""
from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_web_form_profile_records"
down_revision: str | Sequence[str] | None = "0032_web_form_url_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "web_form_profile_record"


def upgrade() -> None:
    bind = op.get_bind()
    if TABLE in set(sa.inspect(bind).get_table_names()):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_key", sa.String(length=32), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(f"ix_{TABLE}_group_key", TABLE, ["group_key"], unique=False)
    op.create_index(
        f"ix_{TABLE}_group_order", TABLE, ["group_key", "sort_order"], unique=False
    )


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    index_names = {index["name"] for index in sa.inspect(bind).get_indexes(TABLE)}
    for index_name in (f"ix_{TABLE}_group_order", f"ix_{TABLE}_group_key"):
        if index_name in index_names:
            op.drop_index(index_name, table_name=TABLE)
    op.drop_table(TABLE)

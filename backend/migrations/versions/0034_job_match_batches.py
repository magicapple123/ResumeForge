"""岗位广场批量匹配结果快照。"""
from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034_job_match_batches"
down_revision: str | Sequence[str] | None = "0033_web_form_profile_records"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "job_match_batch"


def upgrade() -> None:
    bind = op.get_bind()
    if TABLE in set(sa.inspect(bind).get_table_names()):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("requested_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("model", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(f"ix_{TABLE}_created_at", TABLE, ["created_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    index_names = {index["name"] for index in sa.inspect(bind).get_indexes(TABLE)}
    index_name = f"ix_{TABLE}_created_at"
    if index_name in index_names:
        op.drop_index(index_name, table_name=TABLE)
    op.drop_table(TABLE)

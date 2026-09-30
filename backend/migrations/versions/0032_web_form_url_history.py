"""保存网申目标网址历史。"""
from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_web_form_url_history"
down_revision: str | Sequence[str] | None = "0031_extra_profile_label"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if "web_form_url_history" in set(sa.inspect(bind).get_table_names()):
        return
    op.create_table(
        "web_form_url_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("url", name="uq_web_form_url_history_url"),
    )
    op.create_index(
        "ix_web_form_url_history_url", "web_form_url_history", ["url"], unique=False
    )
    op.create_index(
        "ix_web_form_url_history_last_used_at",
        "web_form_url_history",
        ["last_used_at"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "web_form_url_history" not in set(sa.inspect(bind).get_table_names()):
        return
    op.drop_index("ix_web_form_url_history_last_used_at", table_name="web_form_url_history")
    op.drop_index("ix_web_form_url_history_url", table_name="web_form_url_history")
    op.drop_table("web_form_url_history")

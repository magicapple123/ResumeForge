# SPDX-License-Identifier: Apache-2.0
"""0057：resume_review_annotation —— W18 离线对象批注。

**只加表**：既有表结构不动，旧备份仍可导入；新表在旧包中不存在，导入侧候选库迁移建表，
旧数据零回填。表不加 deleted_at（用 status=dismissed 表达"不要了"，保持回收站 17 类不变）。

Revision ID: 0057_review_annotations
Revises: 0056_resume_phrases
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0057_review_annotations"
down_revision: str | Sequence[str] | None = "0056_resume_phrases"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_review_annotation"


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if _TABLE in _existing_tables():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "share_package_id",
            sa.Integer(),
            sa.ForeignKey("share_package.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "resume_id",
            sa.Integer(),
            sa.ForeignKey("resume_record.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_version_id",
            sa.Integer(),
            sa.ForeignKey("resume_version.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("snapshot_sha256", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("external_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("object_id", sa.String(length=32), nullable=True),
        sa.Column("point_id", sa.String(length=32), nullable=True),
        sa.Column("path", sa.String(length=256), nullable=True),
        sa.Column("field", sa.String(length=64), nullable=True),
        sa.Column("quoted_text", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("reviewer", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("share_package_id", "external_id", name="uq_annotation_pkg_external"),
    )
    op.create_index("ix_annotation_resume_status", _TABLE, ["resume_id", "status"])
    op.create_index("ix_resume_review_annotation_created_at", _TABLE, ["created_at"])


def downgrade() -> None:
    if _TABLE in _existing_tables():
        op.drop_table(_TABLE)

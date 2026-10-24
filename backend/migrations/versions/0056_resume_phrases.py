# SPDX-License-Identifier: Apache-2.0
"""0056：resume_phrase —— W17 私有表达资产（数据集隔离 + 备份完整 + 回收站第 17 类）。

**只加表**：不改既有表结构，旧备份仍可导入；新表在旧备份包里不存在，导入侧候选库迁移
会建出来，旧数据零回填。

软删列 deleted_at 让表达资产进入项目统一的回收站（services/trash.py 的 TRASH_SPECS
第 17 类）；彻底删除仍是显式动作。

Revision ID: 0056_resume_phrases
Revises: 0055_resume_versions
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0056_resume_phrases"
down_revision: str | Sequence[str] | None = "0055_resume_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_phrase"


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if _TABLE in _existing_tables():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="custom"),
        sa.Column("language", sa.String(length=16), nullable=False, server_default=""),
        sa.Column(
            "source_claim_id",
            sa.Integer(),
            sa.ForeignKey("claim_record.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_resume_id",
            sa.Integer(),
            sa.ForeignKey("resume_record.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_object_id", sa.String(length=32), nullable=True),
        sa.Column("job_tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("quality_note", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_resume_phrase_kind", _TABLE, ["kind"])
    op.create_index("ix_resume_phrase_language", _TABLE, ["language"])
    op.create_index("ix_resume_phrase_deleted_at", _TABLE, ["deleted_at"])
    op.create_index("ix_resume_phrase_created_at", _TABLE, ["created_at"])


def downgrade() -> None:
    if _TABLE in _existing_tables():
        op.drop_table(_TABLE)

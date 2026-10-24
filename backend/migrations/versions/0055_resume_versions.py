# SPDX-License-Identifier: Apache-2.0
"""0055：W13 命名版本（resume_version）与岗位变体（resume_variant）。

**只加表**（"旧备份仍可导入"的前提）：既有表结构一个列都不动。新表在旧备份包里不存在，
导入侧的候选库迁移会建出来；旧数据无需回填，旧记录不读新表 = 零影响。

- resume_version 存**不可变快照**（内容 + 渲染上下文 + 岗位快照 + 父版本 + 冻结标记），
  所以"已投递/冻结版本不被后续编辑覆盖"是结构性的；恢复历史 = 写一份新的当前版本。
- resume_variant 存岗位变体的独立内容与排版上下文；W16 会在它上面补 language /
  variant_group_id 两列，故本迁移不预置（一张表由引入它的迁移建列）。

表不存在时跳过；完整 downgrade（依赖倒序：先删变体，再删版本——版本被变体引用）。
非空列带 server_default，旧包/直接 INSERT 均成立。

Revision ID: 0055_resume_versions
Revises: 0054_resume_document_mode
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0055_resume_versions"
down_revision: str | Sequence[str] | None = "0054_resume_document_mode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("resume_version", "resume_variant")


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _existing_tables()
    if "resume_version" not in existing:
        op.create_table(
            "resume_version",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "resume_id",
                sa.Integer(),
                sa.ForeignKey("resume_record.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("change_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "job_id", sa.Integer(), sa.ForeignKey("job.id", ondelete="SET NULL"), nullable=True
            ),
            sa.Column("job_title", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("company", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("content", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("render_context", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("content_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("params_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "parent_version_id",
                sa.Integer(),
                sa.ForeignKey("resume_version.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("frozen", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_resume_version_resume_id", "resume_version", ["resume_id"])
        op.create_index("ix_resume_version_created_at", "resume_version", ["created_at"])

    if "resume_variant" not in existing:
        op.create_table(
            "resume_variant",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "resume_id",
                sa.Integer(),
                sa.ForeignKey("resume_record.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(length=256), nullable=False, server_default=""),
            sa.Column(
                "job_id", sa.Integer(), sa.ForeignKey("job.id", ondelete="SET NULL"), nullable=True
            ),
            sa.Column("job_title", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("company", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("content", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("render_context", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("content_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column(
                "base_version_id",
                sa.Integer(),
                sa.ForeignKey("resume_version.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "last_synced_version_id",
                sa.Integer(),
                sa.ForeignKey("resume_version.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("synced_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_resume_variant_resume_id", "resume_variant", ["resume_id"])


def downgrade() -> None:
    existing = _existing_tables()
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)

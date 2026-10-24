# SPDX-License-Identifier: Apache-2.0
"""0059：W19 导出配置（resume_export_preset）与交付原件归档（resume_export_artifact）。

**只加表**：既有表结构不动，旧备份仍可导入；新表在旧包中不存在，导入侧候选库迁移建表，
旧数据零回填。原件字节落新数据集资产目录 export_archive/（ASSET_CATEGORIES 同批登记，
进备份）。删除语义：显式 API 删行 + 删文件，不自动清理。

Revision ID: 0059_resume_export
Revises: 0058_resume_bilingual
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059_resume_export"
down_revision: str | Sequence[str] | None = "0058_resume_bilingual"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("resume_export_preset", "resume_export_artifact")


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()
    if "resume_export_preset" not in existing:
        op.create_table(
            "resume_export_preset",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("config", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("name", name="uq_resume_export_preset_name"),
        )
        op.create_index("ix_resume_export_preset_name", "resume_export_preset", ["name"])
    if "resume_export_artifact" not in existing:
        op.create_table(
            "resume_export_artifact",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "delivery_id",
                sa.Integer(),
                sa.ForeignKey("resume_delivery_record.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "resume_id",
                sa.Integer(),
                sa.ForeignKey("resume_record.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("kind", sa.String(length=16), nullable=False, server_default="rendered"),
            sa.Column("export_format", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("filename", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("media_type", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("disk_name", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("resource_manifest", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index(
            "ix_resume_export_artifact_delivery_id", "resume_export_artifact", ["delivery_id"]
        )
        op.create_index(
            "ix_resume_export_artifact_resume_id", "resume_export_artifact", ["resume_id"]
        )
        op.create_index(
            "ix_resume_export_artifact_disk_name", "resume_export_artifact", ["disk_name"]
        )


def downgrade() -> None:
    existing = _tables()
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)

"""新增用户文件副本表 user_file。

数据库里的用户文件（资料箱附件、个人照片、岗位备注图、备选岗位截图、助手附件）
都以 base64 data URL 存在列里；这张表给它们各自的**磁盘副本**登记一条元信息，
内容本身落在 `<数据库同目录>/user_files/`，不进这张表。只加表：旧备份没有这张表
时按空列表读取（"还没有副本"），不需要回填任何历史数据。

Revision ID: 0038_user_files
Revises: 0037_resume_generation_notes
Create Date: 2026-10-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_user_files"
down_revision: str | Sequence[str] | None = "0037_resume_generation_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "user_file"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # 内容指纹：同一份内容只落一次盘，来源变化只并入 sources_json。
        sa.Column("sha256", sa.String(length=64), nullable=False, index=True),
        # 落盘文件名（<sha 前 16 位>-<安全化原名>），由服务端生成，客户端不参与。
        sa.Column("disk_name", sa.String(length=160), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column(
            "mime",
            sa.String(length=120),
            nullable=False,
            server_default="application/octet-stream",
        ),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        # 首次来源标注；后续来源并入 sources_json（JSON 数组，去重追加）。
        sa.Column("source_type", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("source_ref", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("sources_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        return
    op.drop_table(TABLE)

"""新增投递快照表 resume_delivery_record（RF-17），并给两表加血缘/快照列。

- ``resume_delivery_record``：投递/显式关联/导出那一刻的冻结快照（内容、渲染配置、
  双指纹）。全部岗位/标题/公司字段是冗余快照，外键 SET NULL——被引用行删除后
  证据仍可读。只加表：旧备份没有这张表时按空列表读取，不需要回填任何历史数据。
- ``resume_record.parent_revision_id``：版本血缘（由哪份简历派生），旧行 NULL
  即「独立版本」，读取方不做推断。
- ``application_track.resume_title``：投递时所用简历的标题快照，旧行空串。

Revision ID: 0040_resume_delivery_records
Revises: 0039_resume_fact_annotations
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040_resume_delivery_records"
down_revision: str | Sequence[str] | None = "0039_resume_fact_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "resume_delivery_record"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        # 冗余快照 + SET NULL 外键：岗位/简历/投递记录被删后证据仍可读。
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("resume_id", sa.Integer(), nullable=True),
            sa.Column("job_id", sa.Integer(), nullable=True),
            sa.Column("track_id", sa.Integer(), nullable=True),
            sa.Column("source", sa.String(length=16), nullable=False, server_default="apply"),
            sa.Column("resume_title", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("job_title", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("company", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("content", sa.JSON(), nullable=False),
            sa.Column("render_context", sa.JSON(), nullable=False),
            sa.Column("content_sha256", sa.String(length=64), nullable=False),
            sa.Column("rendered_config_sha256", sa.String(length=64), nullable=False),
            sa.Column("export_format", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("filename", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("pages", sa.Integer(), nullable=True),
            sa.Column("model", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["resume_id"], ["resume_record.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["job_id"], ["job.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["track_id"], ["application_track.id"], ondelete="SET NULL"
            ),
        )
        op.create_index(
            "ix_resume_delivery_record_resume_id", TABLE, ["resume_id"]
        )
        op.create_index("ix_resume_delivery_record_job_id", TABLE, ["job_id"])
        op.create_index("ix_resume_delivery_record_created_at", TABLE, ["created_at"])
    if _table_exists(bind, "resume_record") and not _column_exists(
        bind, "resume_record", "parent_revision_id"
    ):
        # 版本血缘：旧行 NULL = 独立版本（手写简历与全部历史记录都落在这里）。
        op.add_column(
            "resume_record",
            sa.Column("parent_revision_id", sa.Integer(), nullable=True),
        )
    if _table_exists(bind, "application_track") and not _column_exists(
        bind, "application_track", "resume_title"
    ):
        # 投递所用简历的标题快照：旧行空串 = 历史关联未知（界面如实标注）。
        op.add_column(
            "application_track",
            sa.Column("resume_title", sa.String(length=256), nullable=False, server_default=""),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "application_track") and _column_exists(
        bind, "application_track", "resume_title"
    ):
        op.drop_column("application_track", "resume_title")
    if _table_exists(bind, "resume_record") and _column_exists(
        bind, "resume_record", "parent_revision_id"
    ):
        # create_all 建的库中该列带着自引用 FK，SQLite 的裸 DROP COLUMN 会报
        # "unknown column in foreign key definition"——走 batch 重建表（0002 修复
        # legacy FK 的同一手法）。命名约定给匿名约束一个稳定名字，保证反射后能重建。
        with op.batch_alter_table(
            "resume_record",
            recreate="always",
            naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"},
        ) as batch_op:
            batch_op.drop_column("parent_revision_id")
    if _table_exists(bind, TABLE):
        op.drop_table(TABLE)

# SPDX-License-Identifier: Apache-2.0
"""RF-18：application_track 加渠道列，新增状态变化事件表 application_track_event。

- ``application_track.channel``：用户自选的投递渠道（枚举含 ``unknown``，旧行默认
  未知）。与既有 ``source``（记录来源：这一行怎么进系统的）语义分开，不动 ``source``。
  只加列：旧行 server_default ``unknown`` = 历史渠道未知，不从任何现有字段推断。
- ``application_track_event``：状态变化事件的追加留痕（事件时间、来源、原/新状态、
  是否用户确认）。**只对新增状态变化写**——历史不回填：从当前状态或 ``updated_at``
  反推"曾经到过哪一步"就是在编造历史，旧行没有事件，分析侧如实标注覆盖率。

只加表 + 只加列：旧备份没有这张表/列时照常导入，不需要回填任何历史数据。

Revision ID: 0041_track_channel_and_events
Revises: 0040_resume_delivery_records
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041_track_channel_and_events"
down_revision: str | Sequence[str] | None = "0040_resume_delivery_records"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "application_track_event"


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            # CASCADE：进度记录被彻底删除时事件跟着删，不留孤儿事件。
            sa.Column("track_id", sa.Integer(), nullable=False),
            sa.Column("event_at", sa.DateTime(), nullable=False),
            sa.Column("status_date", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("source", sa.String(length=16), nullable=False, server_default="system"),
            sa.Column("user_confirmed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("from_status", sa.String(length=24), nullable=False, server_default=""),
            sa.Column("to_status", sa.String(length=24), nullable=False, server_default=""),
            sa.ForeignKeyConstraint(
                ["track_id"], ["application_track.id"], ondelete="CASCADE"
            ),
        )
        op.create_index("ix_application_track_event_track_id", TABLE, ["track_id"])
        op.create_index("ix_application_track_event_event_at", TABLE, ["event_at"])
    if _table_exists(bind, "application_track") and not _column_exists(
        bind, "application_track", "channel"
    ):
        # 渠道默认未知：历史行一律未知，不猜。
        op.add_column(
            "application_track",
            sa.Column("channel", sa.String(length=24), nullable=False, server_default="unknown"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    # 先删事件表再删渠道列：事件表的 FK 引用着 application_track.id，SQLite 里
    # 对被 FK 引用的表做列变更要 batch 重建，这里只 drop 一个普通列（channel 无
    # FK/索引），且删掉事件表后引用也不存在了，顺序保证干净。
    if _table_exists(bind, TABLE):
        op.drop_index("ix_application_track_event_event_at", TABLE)
        op.drop_index("ix_application_track_event_track_id", TABLE)
        op.drop_table(TABLE)
    if _table_exists(bind, "application_track") and _column_exists(
        bind, "application_track", "channel"
    ):
        op.drop_column("application_track", "channel")

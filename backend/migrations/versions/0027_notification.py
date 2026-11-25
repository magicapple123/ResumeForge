# SPDX-License-Identifier: Apache-2.0
"""0027：提醒到期真的通知（CR-22）——``notification`` 表 + ``reminder.last_notified_at``。

两件事同批，是因为它们是一条链路的两端：`reminder` 上的投递标记负责"只发一次"，
`notification` 负责"发出去的东西能被回看"。拆成两条迁移会让中间状态出现"标记已发但
没地方存通知"。

结构取舍（详见 ``models/notification.py`` 模块注释）：

1. ``dedupe_key`` **唯一索引**：60 秒扫描、开机补扫、并发扫描都可能重复触达同一事件，
   唯一索引是幂等的最后一道闸；服务层先查再插只是省一次异常。
2. ``deep_link`` / ``title`` / ``body`` 是**事件当时的快照**，不是外键——目标被删后通知
   仍可读。
3. ``expires_at`` 只做读时过滤（inbox 保留 30 天），物理清理由后台任务另做。

``reminder.last_notified_at`` 可空：NULL = 从没提醒过。``last_notified_at < remind_at``
的条件更新让"改期后自然再提醒一次"，而重复扫描同一时刻只影响 0 行。

升级/降级都幂等：表/列已存在（或部分业务表缺失）时跳过而不是报错。列定义与
``models/notification.py`` / ``models/reminder.py`` 逐字一致（含索引名与 server_default），
``tests/test_model_migration_index_parity.py`` 会双向比对。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_notification"
down_revision: str | Sequence[str] | None = "0026_apply_queue_image_ids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "notification"
_REMINDER_TABLE = "reminder"
_DEDUPE_INDEX = f"ix_{_TABLE}_dedupe_key"
_CREATED_INDEX = f"ix_{_TABLE}_created_at"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """建通知表 + 给 reminder 加投递标记列（已存在则跳过）。"""
    tables = _table_names()
    if _TABLE not in tables:
        op.create_table(
            _TABLE,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("type", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("severity", sa.String(length=16), nullable=False, server_default="info"),
            sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("deep_link", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("dedupe_key", sa.String(length=200), nullable=False),
            sa.Column("read_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("dataset_key", sa.String(length=32), nullable=False, server_default="main"),
        )
        op.create_index(_DEDUPE_INDEX, _TABLE, ["dedupe_key"], unique=True)
        op.create_index(_CREATED_INDEX, _TABLE, ["created_at"])

    if _REMINDER_TABLE in tables and "last_notified_at" not in _column_names(_REMINDER_TABLE):
        op.add_column(_REMINDER_TABLE, sa.Column("last_notified_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """删列/删表；不存在则跳过（降级会丢"哪些已提醒过"与 inbox 历史，这是结构回退的代价）。"""
    tables = _table_names()
    if _REMINDER_TABLE in tables and "last_notified_at" in _column_names(_REMINDER_TABLE):
        with op.batch_alter_table(_REMINDER_TABLE) as batch:
            batch.drop_column("last_notified_at")
    if _TABLE not in tables:
        return
    existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(_TABLE)}
    for index_name in (_CREATED_INDEX, _DEDUPE_INDEX):
        if index_name in existing:
            op.drop_index(index_name, table_name=_TABLE)
    op.drop_table(_TABLE)

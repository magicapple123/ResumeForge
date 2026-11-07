# SPDX-License-Identifier: Apache-2.0
"""0002：助手写操作提案落库 + 消息类别列（T01 单一事实源）。

背景（P0）：写操作提案原先只存进程内存（TTL 300s），用户确认执行成功后后端只
``mark_executed``、不写会话消息；下一轮拼上下文时没有任何代码读提案状态，模型只能
复述历史里那句"等待用户在界面上确认"。重启后内存清空，前端查询 404，更是无法解释。

本迁移建立 ``assistant_write_proposal``（单一事实源）并给 ``chat_message`` 增加两列：

- ``kind``：normal / proposal_result。``proposal_result`` 是五条终态的**派生**回写
  （best-effort：写失败不影响状态正确性）；
- ``proposal_id``：回写消息关联的提案 id，与 ``kind`` 组成唯一幂等键
  ``uq_chat_message_proposal_kind``（同一条提案的同类回写只允许一条）。

DDL 只加表/列/索引，不改动任何既有列与数据。downgrade 反向删除；表/列/索引不存在时
跳过而不是报错（迁移可能跑在只有部分业务表的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_assistant_write_proposal"
down_revision: str | Sequence[str] | None = "0001_baseline_v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    """建提案表（含索引）并给 chat_message 加 kind / proposal_id。"""
    if "assistant_write_proposal" not in _table_names():
        op.create_table(
            "assistant_write_proposal",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("proposal_id", sa.String(length=32), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=True),
            sa.Column("message_id", sa.Integer(), nullable=True),
            sa.Column("dataset_key", sa.String(length=32), nullable=False),
            sa.Column("dataset_generation", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tool_name", sa.String(length=64), nullable=False),
            sa.Column("arguments", sa.JSON(), nullable=False),
            sa.Column("arguments_digest", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("preview", sa.JSON(), nullable=False),
            sa.Column(
                "target_fingerprint", sa.String(length=64), nullable=False, server_default=""
            ),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
            sa.Column("result_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("executed_at", sa.DateTime(), nullable=True),
            sa.Column("batch_id", sa.String(length=32), nullable=True),
        )
        op.create_index(
            "ix_assistant_write_proposal_proposal_id",
            "assistant_write_proposal",
            ["proposal_id"],
            unique=True,
        )
        op.create_index(
            "ix_assistant_write_proposal_conversation_id",
            "assistant_write_proposal",
            ["conversation_id"],
            unique=False,
        )
        op.create_index(
            "ix_assistant_write_proposal_dataset_key",
            "assistant_write_proposal",
            ["dataset_key"],
            unique=False,
        )
        op.create_index(
            "ix_assistant_write_proposal_status",
            "assistant_write_proposal",
            ["status"],
            unique=False,
        )
        op.create_index(
            "ix_assistant_write_proposal_created_at",
            "assistant_write_proposal",
            ["created_at"],
            unique=False,
        )
        op.create_index(
            "ix_assistant_write_proposal_expires_at",
            "assistant_write_proposal",
            ["expires_at"],
            unique=False,
        )

    if "chat_message" in _table_names():
        columns = _column_names("chat_message")
        if "kind" not in columns:
            op.add_column(
                "chat_message",
                sa.Column("kind", sa.String(length=16), nullable=False, server_default="normal"),
            )
        if "proposal_id" not in columns:
            op.add_column(
                "chat_message", sa.Column("proposal_id", sa.String(length=32), nullable=True)
            )
        if "uq_chat_message_proposal_kind" not in _index_names("chat_message"):
            # SQLite 的唯一索引允许多个 NULL：普通消息（proposal_id IS NULL）不互相冲突。
            op.create_index(
                "uq_chat_message_proposal_kind",
                "chat_message",
                ["proposal_id", "kind"],
                unique=True,
            )


def downgrade() -> None:
    """严格反序删除：先删消息表索引/列，再删提案表。"""
    if "chat_message" in _table_names():
        if "uq_chat_message_proposal_kind" in _index_names("chat_message"):
            op.drop_index("uq_chat_message_proposal_kind", table_name="chat_message")
        columns = _column_names("chat_message")
        if "proposal_id" in columns:
            op.drop_column("chat_message", "proposal_id")
        if "kind" in columns:
            op.drop_column("chat_message", "kind")
    if "assistant_write_proposal" in _table_names():
        op.drop_table("assistant_write_proposal")

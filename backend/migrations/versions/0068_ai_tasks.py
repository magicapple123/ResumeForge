# SPDX-License-Identifier: Apache-2.0
"""0068：通用 AI 任务表 ``ai_task``。

**只加表**，不动任何既有表：旧备份仍可导入，历史库缺哪张表就跳过哪一步。

改动前只有简历生成有任务表（``resume_generate_task``），其余 AI 入口是"请求-响应一体"
——连接一断就白跑，用户既看不到进度也没有取消入口。本表是所有 AI 入口共用的任务登记行：
``kind`` 区分业务，``payload`` 存输入摘要，``result_ref`` 存"完成后点通知跳哪"的标识。
业务结果仍留在各自业务表里，本表只负责任务生命周期，所以清理任务记录永远不动业务数据。

**升级安全**：迁移链也会跑在"只有部分业务表"的历史库上，所以先查存在性再建表；
没有任何外键——``result_ref`` 用 JSON 存标识而不是外键，是为了任务记录可以被独立清理
（一个已删除简历的旧任务行不该因为外键而阻塞删除或留下悬挂引用）。

**downgrade 完整可逆**：只删本表，先按真实表名从 inspector 取索引名再逐条 drop
（索引名随 SQLAlchemy 版本变化，硬编码会留下"删表成功、删索引失败"的半途状态），
索引删不掉时继续删表——重复 downgrade 不报错。

Revision ID: 0068_ai_tasks
Revises: 0067_usage_pricing_records
Create Date: 2026-10-28
"""

import contextlib
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0068_ai_tasks"
down_revision: str | Sequence[str] | None = "0067_usage_pricing_records"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "ai_task"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _create_table() -> None:
    if _has_table(_TABLE):
        # 重复升级（例如手工建过表 / 半途失败重跑）不重复创建，也不改既有列。
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("label", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("result_ref", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_index(f"ix_{_TABLE}_status", _TABLE, ["status"])
    op.create_index(f"ix_{_TABLE}_kind", _TABLE, ["kind"])
    op.create_index(f"ix_{_TABLE}_created_at", _TABLE, ["created_at"])


def _index_names() -> list[str]:
    """本表现有索引名（按真实名取，不猜命名规则）。表不在时返回空列表。"""
    if not _has_table(_TABLE):
        return []
    return [index["name"] for index in _inspector().get_indexes(_TABLE) if index.get("name")]


def upgrade() -> None:
    _create_table()


def downgrade() -> None:
    if not _has_table(_TABLE):
        return
    for name in _index_names():
        # 索引可能已被手动删除或由 SQLite 自动生成：删不掉就继续，最终以删表为准。
        with contextlib.suppress(Exception):
            op.drop_index(name, table_name=_TABLE)
    op.drop_table(_TABLE)

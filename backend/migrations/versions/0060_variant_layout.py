# SPDX-License-Identifier: Apache-2.0
"""0060：W16 变体独立排版（resume_variant.layout）+ 旧库缺列兜底。

**只加列**（既有表集合前后不变，旧备份仍可导入；旧数据零回填）：

- ``resume_variant.layout``：JSON nullable。W16「两份独立排版」的持久覆盖——NULL = 继承
  （派生时的 render_context 基底快照或当前简历排版），非空 = 这条变体自己的排版上下文。
  旧变体读到 NULL 行为不变。
- ``resume_phrase.job_tags`` 与 ``llm_usage_record.finish_reason`` 的**权威来源**分别是
  0056_resume_phrases 与 0053_resume_provenance（常规迁移链上本来就有这两列）。这里只对
  「部分历史库 / 手工建表库」做缺列兜底：已存在则跳过，不重复建列、不改既有列定义。

表不存在时跳过而不是报错：迁移链也会跑在只有部分业务表的历史库上。

**完整 downgrade 的边界**：只删本迁移真正引入的 ``resume_variant.layout``；
``job_tags`` / ``finish_reason`` 的 canonical 归属是 0056/0053，降级**不删**——删掉会破坏
更早 revision 的语义并丢数据（这两个列在常规链上根本不是 0060 建的）。

Revision ID: 0060_variant_layout
Revises: 0059_resume_export
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060_variant_layout"
down_revision: str | Sequence[str] | None = "0059_resume_export"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VARIANT_TABLE = "resume_variant"
_LAYOUT_COLUMN = "layout"
# 权威归属不在这里的兜底列：(表名, 列名, 列定义)。
_BACKFILL_COLUMNS: tuple[tuple[str, str, sa.Column], ...] = (
    (
        "resume_phrase",
        "job_tags",
        sa.Column("job_tags", sa.JSON(), nullable=False, server_default="[]"),
    ),
    (
        "llm_usage_record",
        "finish_reason",
        sa.Column("finish_reason", sa.String(length=32), nullable=False, server_default=""),
    ),
)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    tables = _tables()
    if _VARIANT_TABLE in tables and _LAYOUT_COLUMN not in _columns(_VARIANT_TABLE):
        op.add_column(
            _VARIANT_TABLE,
            sa.Column(_LAYOUT_COLUMN, sa.JSON(), nullable=True),
        )
    for table, column_name, column in _BACKFILL_COLUMNS:
        if table in tables and column_name not in _columns(table):
            op.add_column(table, column)


def downgrade() -> None:
    tables = _tables()
    if _VARIANT_TABLE in tables and _LAYOUT_COLUMN in _columns(_VARIANT_TABLE):
        with op.batch_alter_table(_VARIANT_TABLE) as batch:
            batch.drop_column(_LAYOUT_COLUMN)

# SPDX-License-Identifier: Apache-2.0
"""0061：职业场景 + 生成上下文快照（A1，计划 §7.1/§7.5）。

**只加表 + 只加可空列**（旧备份仍可导入；旧数据零回填、零重写）：

- 新表 ``career_scenario``：当前数据集保存的职业场景（每数据集独立 SQLite 库）。
  归档代替删除（没有 deleted_at），所以不进回收站。
- 四个 nullable JSON 列，全部是 **server-owned 上下文快照**，与 content /
  format_config / render_context 分开存：
  * ``resume_generate_task.context_snapshot``：创建任务时冻结（runner 只读它）；
  * ``resume_record.context_snapshot``：本次生成的记录；
  * ``resume_version.context_snapshot``：命名版本不可变快照的一部分；
  * ``resume_variant.context_snapshot``：派生变体继承来源说明。
  NULL = 未记录/未使用（旧记录），读取侧不得按当前场景回填。

**表集合断言按迁移类型区分**：本迁移是"加表 + 加列"，迁移后表集合 = 迁移前集合 +
``{career_scenario}``；四个目标表若存在则各多一列，不存在则跳过（部分历史库）。

Revision ID: 0061_career_scenarios
Revises: 0060_variant_layout
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061_career_scenarios"
down_revision: str | Sequence[str] | None = "0060_variant_layout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "career_scenario"
_COLUMN = "context_snapshot"
_SNAPSHOT_TABLES = (
    "resume_generate_task",
    "resume_record",
    "resume_version",
    "resume_variant",
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
    if _TABLE not in tables:
        op.create_table(
            _TABLE,
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=40), nullable=False, server_default=""),
            sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("archived", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_career_scenario_created_at", _TABLE, ["created_at"])
    for table in _SNAPSHOT_TABLES:
        if table in tables and _COLUMN not in _columns(table):
            op.add_column(table, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    tables = _tables()
    for table in _SNAPSHOT_TABLES:
        if table in tables and _COLUMN in _columns(table):
            with op.batch_alter_table(table) as batch:
                batch.drop_column(_COLUMN)
    if _TABLE in tables:
        op.drop_table(_TABLE)

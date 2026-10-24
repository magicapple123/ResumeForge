# SPDX-License-Identifier: Apache-2.0
"""0053：W12 持久来源 / 来源修订 / 目标块关联 / 事实锁 + R04 用量账本。

**只加表**（"旧备份仍可导入"的前提）：不改任何既有表的结构。新表在旧备份包里不存在，
导入侧的解包迁移会把候选库升到本版本、把这些表建出来；旧数据一行都不需要回填。

**表不存在时跳过**：迁移链也会跑在"只有部分业务表"的历史库上（例如停在 0040 的体验
示例），任何一步都不能让整条链失败。

**完整 downgrade**：按"关联 → 修订 → 实体 / 锁 / 账本"的依赖倒序删表。删掉这些表不会
丢失简历正文（来源关系是可重建的派生数据，不是用户正文）。

命名与来源选择的约束见 `models/provenance.py` 与 `models/llm_usage.py` 的模块 docstring：
来源不建跨业务表外键（`external_ref` 是文本引用），事实锁与来源关联分属两件事。

Revision ID: 0053_resume_provenance
Revises: 0052_resume_revision
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053_resume_provenance"
down_revision: str | Sequence[str] | None = "0052_resume_revision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 依赖倒序（downgrade 用同一个列表反过来删）。
_TABLES = (
    "resume_source",
    "resume_source_revision",
    "resume_block_source",
    "resume_fact_lock",
    "llm_usage_record",
)


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _existing_tables()
    if "resume_source" not in existing:
        op.create_table(
            "resume_source",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("kind", sa.String(length=16), nullable=False, server_default="manual"),
            sa.Column("external_ref", sa.String(length=64), nullable=True),
            sa.Column("title", sa.String(length=256), nullable=False, server_default=""),
            sa.Column(
                "current_fingerprint", sa.String(length=64), nullable=False, server_default=""
            ),
            sa.Column("metadata", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("kind", "external_ref", name="uq_resume_source_kind_ref"),
        )
        op.create_index("ix_resume_source_kind", "resume_source", ["kind"])

    if "resume_source_revision" not in existing:
        op.create_table(
            "resume_source_revision",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "source_id",
                sa.Integer(),
                sa.ForeignKey("resume_source.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("revision_no", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("fingerprint", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("summary", sa.String(length=300), nullable=False, server_default=""),
            sa.Column("captured_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("source_id", "revision_no", name="uq_resume_source_revision_no"),
        )
        op.create_index(
            "ix_resume_source_revision_source_id", "resume_source_revision", ["source_id"]
        )

    if "resume_block_source" not in existing:
        op.create_table(
            "resume_block_source",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "resume_id",
                sa.Integer(),
                sa.ForeignKey("resume_record.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "source_id",
                sa.Integer(),
                sa.ForeignKey("resume_source.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "source_revision_id",
                sa.Integer(),
                sa.ForeignKey("resume_source_revision.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("object_id", sa.String(length=32), nullable=True),
            sa.Column("point_id", sa.String(length=32), nullable=True),
            sa.Column("path", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("field", sa.String(length=64), nullable=False, server_default=""),
            sa.Column(
                "source_fingerprint", sa.String(length=64), nullable=False, server_default=""
            ),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_resume_block_source_resume_id", "resume_block_source", ["resume_id"])
        op.create_index("ix_resume_block_source_source_id", "resume_block_source", ["source_id"])

    if "resume_fact_lock" not in existing:
        op.create_table(
            "resume_fact_lock",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "resume_id",
                sa.Integer(),
                sa.ForeignKey("resume_record.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("object_id", sa.String(length=32), nullable=True),
            sa.Column("point_id", sa.String(length=32), nullable=True),
            sa.Column("path", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("relative_path", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("field", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("lock_kind", sa.String(length=32), nullable=False, server_default="name"),
            sa.Column("locked_value", sa.Text(), nullable=False, server_default=""),
            sa.Column("label", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_resume_fact_lock_resume_id", "resume_fact_lock", ["resume_id"])
        op.create_index("ix_resume_fact_lock_lock_kind", "resume_fact_lock", ["lock_kind"])

    if "llm_usage_record" not in existing:
        op.create_table(
            "llm_usage_record",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("task", sa.String(length=32), nullable=False, server_default="unknown"),
            sa.Column("model", sa.String(length=64), nullable=False, server_default=""),
            sa.Column(
                "resume_id",
                sa.Integer(),
                sa.ForeignKey("resume_record.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("prompt_tokens", sa.Integer(), nullable=True),
            sa.Column("completion_tokens", sa.Integer(), nullable=True),
            sa.Column("total_tokens", sa.Integer(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=True),
            sa.Column("finish_reason", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("retries", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("cost_estimate", sa.Float(), nullable=True),
            sa.Column("cost_currency", sa.String(length=8), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_llm_usage_record_task", "llm_usage_record", ["task"])
        op.create_index("ix_llm_usage_record_resume_id", "llm_usage_record", ["resume_id"])
        op.create_index("ix_llm_usage_record_created_at", "llm_usage_record", ["created_at"])


def downgrade() -> None:
    existing = _existing_tables()
    # 依赖倒序：先删引用别人的，再删被引用的。
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)

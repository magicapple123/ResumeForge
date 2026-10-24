# SPDX-License-Identifier: Apache-2.0
"""0058：W16 语言变体（扩展 resume_variant 两列）+ 数据集级术语表 resume_glossary_term。

**只加表/只加列**：
- resume_variant 加 language / variant_group_id 两列（nullable 语义，server_default），
  旧变体行读作"未标注语言"，导出/预览行为不变；
- 新表 resume_glossary_term 带 deleted_at（回收站第 18 类，服务注册表同步登记）。

术语表不存 resume_id：它是**数据集级共享**（同一数据集内所有简历译法一致）；数据集隔离由
独立 SQLite 库结构保证。表不存在/列已存在时跳过；完整 downgrade（先删新表，再删两列）。

Revision ID: 0058_resume_bilingual
Revises: 0057_review_annotations
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0058_resume_bilingual"
down_revision: str | Sequence[str] | None = "0057_review_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VARIANT_TABLE = "resume_variant"
_GLOSSARY_TABLE = "resume_glossary_term"
_NEW_COLUMNS = (
    ("language", sa.Column("language", sa.String(length=16), nullable=False, server_default="")),
    ("variant_group_id", sa.Column("variant_group_id", sa.Integer(), nullable=True)),
)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    existing = _tables()
    variant_columns = _columns(_VARIANT_TABLE)
    if variant_columns:
        for name, column in _NEW_COLUMNS:
            if name not in variant_columns:
                op.add_column(_VARIANT_TABLE, column)
    if _GLOSSARY_TABLE not in existing:
        op.create_table(
            _GLOSSARY_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("source_term", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("target_term", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("language_from", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("language_to", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("category", sa.String(length=16), nullable=False, server_default="term"),
            sa.Column("locked", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("note", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("source_term", "language_to", name="uq_glossary_term"),
        )
        op.create_index("ix_resume_glossary_term_language_to", _GLOSSARY_TABLE, ["language_to"])
        op.create_index("ix_resume_glossary_term_deleted_at", _GLOSSARY_TABLE, ["deleted_at"])


def downgrade() -> None:
    if _GLOSSARY_TABLE in _tables():
        op.drop_table(_GLOSSARY_TABLE)
    variant_columns = _columns(_VARIANT_TABLE)
    if variant_columns:
        for name, _column in reversed(_NEW_COLUMNS):
            if name in variant_columns:
                with op.batch_alter_table(_VARIANT_TABLE) as batch:
                    batch.drop_column(name)

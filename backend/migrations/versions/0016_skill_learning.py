# SPDX-License-Identifier: Apache-2.0
"""0016：#31D/E/F 技能学习——assistant_skill 四段内容/版本/验证状态 + 对话引用版本。

#31 的另外两档记忆里，**程序记忆**（assistant_skill）原本只有 name/description/prompt
三段，且"技能生成"这条链路完全不存在：没有四段内容（缺 when_to_use / steps / pitfalls）、
没有版本、没有"待验证"状态，也不知道一个对话启用技能时引用的是哪一版。

本迁移只加列（不建表、不删数据）：

assistant_skill：
- when_to_use / steps / pitfalls：四段内容的另外三段（Text，空串 = 手工导入的老技能没有）；
- version：技能版本，自动生成/更新时自增；老技能一律 1；
- generated：是否由对话自动生成（1 = 生成，需"待验证"流程；0 = 用户导入/手写）；
- validation_status：''（无需验证）/ pending（待验证）/ validated（已验证）；
- last_loaded_at：最近一次被加载进系统提示的时间（90 天未加载 → 提示归档，不自动删）。

assistant_conversation_skill：
- skill_version：启用时引用的技能版本快照。避免"父技能悄悄吃到子技能的新版本"
  （组合漂移）：注入与回看都以这一版为准，更新技能不回溯改历史引用。

升级/降级都要能跑：表或列不存在时跳过而不是报错。降级只删本迁移加的列，
不碰技能内容、启停状态与任何关联行。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_skill_learning"
down_revision: str | Sequence[str] | None = "0015_assistant_memory"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SKILL_TABLE = "assistant_skill"
_CONVERSATION_SKILL_TABLE = "assistant_conversation_skill"

_SKILL_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    ("when_to_use", sa.Column("when_to_use", sa.Text(), nullable=False, server_default="")),
    ("steps", sa.Column("steps", sa.Text(), nullable=False, server_default="")),
    ("pitfalls", sa.Column("pitfalls", sa.Text(), nullable=False, server_default="")),
    (
        "version",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    ),
    (
        "generated",
        sa.Column("generated", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    ),
    (
        "validation_status",
        sa.Column("validation_status", sa.String(length=16), nullable=False, server_default=""),
    ),
    ("last_loaded_at", sa.Column("last_loaded_at", sa.DateTime(), nullable=True)),
)

_CONVERSATION_SKILL_COLUMN = "skill_version"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """给技能表加四段内容/版本/验证列，给对话技能关联表加版本快照；已存在则跳过。"""
    tables = _table_names()
    if _SKILL_TABLE in tables:
        existing = _column_names(_SKILL_TABLE)
        for name, column in _SKILL_COLUMNS:
            if name not in existing:
                op.add_column(_SKILL_TABLE, column)
    if _CONVERSATION_SKILL_TABLE in tables:
        existing = _column_names(_CONVERSATION_SKILL_TABLE)
        if _CONVERSATION_SKILL_COLUMN not in existing:
            op.add_column(
                _CONVERSATION_SKILL_TABLE,
                sa.Column(_CONVERSATION_SKILL_COLUMN, sa.Integer(), nullable=True),
            )


def downgrade() -> None:
    """反序删本迁移加的列；表/列不存在则跳过。"""
    tables = _table_names()
    if _CONVERSATION_SKILL_TABLE in tables:
        existing = _column_names(_CONVERSATION_SKILL_TABLE)
        if _CONVERSATION_SKILL_COLUMN in existing:
            op.drop_column(_CONVERSATION_SKILL_TABLE, _CONVERSATION_SKILL_COLUMN)
    if _SKILL_TABLE in tables:
        existing = _column_names(_SKILL_TABLE)
        for name, _column in reversed(_SKILL_COLUMNS):
            if name in existing:
                op.drop_column(_SKILL_TABLE, name)

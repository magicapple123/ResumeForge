# SPDX-License-Identifier: Apache-2.0
"""0005：T14 技能改为按对话启用——新建 assistant_conversation_skill。

背景：技能原先由 assistant_skill.enabled 这个**全局布尔**控制注入，在一个对话里勾掉
技能会让所有对话一起失效，新对话还自动继承全部已启用技能。T14 改成"按对话启用"：

- 一行 = 某个对话启用了某个技能；UNIQUE(conversation_id, skill_id) 保证同一技能在
  同一对话里只有一行；
- conversation_id / skill_id 都 ON DELETE CASCADE：软删除会话时行保留（恢复后技能
  还在），彻底删会话或删技能时关联行自动清掉；
- 旧 assistant_skill.enabled 列**保留但不再生效**（不做破坏性迁移，也不回填历史值）；
  新对话一律没有关联行 = 技能全关。

DDL 只加一张表（含索引与唯一约束），不改动任何既有列与数据。downgrade 反序删索引
与表；表不存在时跳过而不是报错（迁移可能跑在只有部分业务表的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_conversation_skill"
down_revision: str | Sequence[str] | None = "0004_agent_task_reminder_occurrence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "assistant_conversation_skill"
_UNIQUE = "uq_assistant_conversation_skill_conversation_id_skill_id"
_CONVERSATION_INDEX = "ix_assistant_conversation_skill_conversation_id"
_SKILL_INDEX = "ix_assistant_conversation_skill_skill_id"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {index["name"] for index in inspector.get_indexes(_TABLE)}


def upgrade() -> None:
    """建关联表（含唯一约束与两个索引）；表已存在则跳过。"""
    if _TABLE in _table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("chat_conversation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id",
            sa.Integer(),
            sa.ForeignKey("assistant_skill.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("conversation_id", "skill_id", name=_UNIQUE),
    )
    op.create_index(_CONVERSATION_INDEX, _TABLE, ["conversation_id"], unique=False)
    op.create_index(_SKILL_INDEX, _TABLE, ["skill_id"], unique=False)


def downgrade() -> None:
    """反序删索引与表；表不存在则跳过。"""
    if _TABLE not in _table_names():
        return
    existing = _index_names()
    if _SKILL_INDEX in existing:
        op.drop_index(_SKILL_INDEX, table_name=_TABLE)
    if _CONVERSATION_INDEX in existing:
        op.drop_index(_CONVERSATION_INDEX, table_name=_TABLE)
    op.drop_table(_TABLE)

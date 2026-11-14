# SPDX-License-Identifier: Apache-2.0
"""0019：临时对话的 `memory_off` 标记（F34）。

Claude / ChatGPT / Copilot 的临时聊天是同一个语义：**这段对话不读也不写记忆**。
它必须落库而不是只存在前端——注入发生在服务端装配系统提示时、抽取发生在会话空闲后
的后台任务里，两边都看不到前端的临时状态。

三条约束：
- `server_default="0"`：存量会话一律按"正常记忆"处理，升级后行为不变；
- 表不存在时跳过（迁移会跑在"只有部分业务表"的库上），列已存在时也跳过；
- 降级真的删列（SQLite 走 batch 重建表），但**不动数据**：开关是会话级偏好，
  删列等于所有会话回到默认记忆行为，这是可接受的回落，不涉及用户内容。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_conversation_memory_off"
down_revision: str | Sequence[str] | None = "0018_assistant_memory_event"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "chat_conversation"
_COLUMN = "memory_off"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    """加 memory_off 布尔列；会话表缺失或列已存在则跳过。"""
    if _TABLE not in _table_names() or _COLUMN in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.add_column(sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    """删列（SQLite 通过 batch 重建表）；列不存在则跳过。"""
    if _TABLE not in _table_names() or _COLUMN not in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

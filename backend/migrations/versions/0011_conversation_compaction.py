# SPDX-License-Identifier: Apache-2.0
"""0011：上下文压缩状态——chat_conversation 加可空 JSON 列 compaction。

问题清单 #10：长对话会把窗口吃满，而"把旧轮次压成一张状态卡"必须落库——否则
每次刷新页面、每次重启应用，压缩结果都从头再来（成本 ≈ 一次全量输入）。

三条不变量：

1. **可空**：NULL = 没压缩过，是绝大多数会话的常态；不回填、不给服务端默认值。
2. **原文永不删除**：这一列只描述"发给模型的视图"，所以「还原」= 把它置回 NULL。
   删聊天记录是另一条链路（回收站），不要混在一起。
3. **只记增量锚点**：``covered_until_message_id`` 之后新增的消息不重算，下次压缩
   从它的下一条开始——这也是"不做摘要的摘要"能成立的前提。

downgrade 判存在后删列；表/列不存在时跳过（迁移会跑在只有部分业务表的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_conversation_compaction"
down_revision: str | Sequence[str] | None = "0010_external_resume"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "chat_conversation"
_COLUMN = "compaction"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """加压缩状态列；表/列已存在则跳过。"""
    if _TABLE not in _table_names():
        return
    if _COLUMN in _column_names(_TABLE):
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    """删压缩状态列；表/列不存在则跳过（原文从未被这一列删除，降级不丢聊天记录）。"""
    if _TABLE not in _table_names():
        return
    if _COLUMN not in _column_names(_TABLE):
        return
    op.drop_column(_TABLE, _COLUMN)

# SPDX-License-Identifier: Apache-2.0
"""0018：助手记忆的变更历史（F33）。

`assistant_memory` 只保存"现在是什么"，用户看不到"助手什么时候改了我的偏好"。
本迁移新建 `assistant_memory_event`：每条记忆的 create/update/supersede/suppress/
restore/delete 各记一行，只追加、不修改。

设计取舍：
- `before` / `after` 存**值**而不是整行 JSON：记忆只有 kind/key/value/status 有展示
  意义，整行 JSON 会把来源会话 id 之类的内部标识一起摊到界面上；
- 外键 `ondelete="CASCADE"`：记忆被物理清掉时历史不能留孤儿（正常删除是软删，不会
  触发级联；这条约束是为维护与测试路径准备的）；
- **不改 `assistant_memory` 表**：`suppressed` 只是 status 的一个新取值（列是
  String(16)，容量足够），零结构变更；"永不使用"因此不需要迁移。

升级/降级都要能跑：表不存在时跳过而不是报错（迁移会跑在"只有部分业务表"的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_assistant_memory_event"
down_revision: str | Sequence[str] | None = "0017_agent_task_params"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "assistant_memory_event"
_MEMORY_TABLE = "assistant_memory"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """建事件表 + memory_id 索引；已存在（含记忆表缺失）则跳过。"""
    tables = _table_names()
    if _TABLE in tables or _MEMORY_TABLE not in tables:
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "memory_id",
            sa.Integer(),
            sa.ForeignKey(f"{_MEMORY_TABLE}.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("before", sa.Text(), nullable=False, server_default=""),
        sa.Column("after", sa.Text(), nullable=False, server_default=""),
        sa.Column("at", sa.DateTime(), nullable=False),
    )
    op.create_index(f"ix_{_TABLE}_memory_id", _TABLE, ["memory_id"])


def downgrade() -> None:
    """删表（索引随表一起消失）；表不存在则跳过。"""
    if _TABLE not in _table_names():
        return
    op.drop_index(f"ix_{_TABLE}_memory_id", table_name=_TABLE)
    op.drop_table(_TABLE)

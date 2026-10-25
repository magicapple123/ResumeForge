# SPDX-License-Identifier: Apache-2.0
"""0065：清理使用快照里指向不存在父行的悬空逻辑引用（纯数据清理，无结构变更）。

**为什么需要**：profile_usage_snapshot 的 task_id / resume_id 只是逻辑引用（刻意不建
外键，快照要能脱离父行存活，R-33）。简历在回收站被彻底删除后，对应的快照行仍保留
resume_id；而 SQLite 的 INTEGER PRIMARY KEY 没有 AUTOINCREMENT，会复用被删掉的 rowid
——下一条新简历拿到同一个 id 后回写 resume_id 就撞 UNIQUE 约束，用户看到「服务器处理
请求时发生内部错误」（2026-10-26 真实库：悬空 resume_id=641..647，新简历复用 644）。

**只把悬空引用置 NULL，不删任何快照行**：快照的组名 / 参与清单 / 顺序 / 两枚 revision /
layout 是"当时那次使用"的历史（R-33/R-34），解绑只去掉已无法解析的逻辑引用。

**升级安全**：快照表、父表或**引用列**不存在时逐项跳过（迁移链也会跑在只有部分业务表
的历史库上；0064 对"已存在"的表逐表跳过、不补列，所以历史/测试库可能出现只有 id 列的
最小快照表）；语句天然幂等，重复执行没有副作用。本迁移**不改任何表结构**，所以旧备份
仍可导入。

**downgrade 是 no-op**：被清理的是"指向已删除简历/任务"的引用，无法也不应复原——
父行已不存在，复原只会重新制造 UNIQUE 冲突与悬空行。版本号退回 0064，数据保持清理后
的状态。

Revision ID: 0065_snapshot_dangling_refs
Revises: 0064_profile_groups
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065_snapshot_dangling_refs"
down_revision: str | Sequence[str] | None = "0064_profile_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SNAPSHOT_TABLE = "profile_usage_snapshot"
# (快照列, 父表)：逻辑引用 → 父行（父表主键都是 id）。父表不存在时跳过该列。
_REFERENCES: tuple[tuple[str, str], ...] = (
    ("resume_id", "resume_record"),
    ("task_id", "resume_generate_task"),
)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _snapshot_columns() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_SNAPSHOT_TABLE)}


def _detach_dangling_references(column: str, parent_table: str) -> int:
    """把指向不存在父行的引用置 NULL，返回解绑行数。"""
    result = op.get_bind().execute(
        sa.text(
            f"UPDATE {_SNAPSHOT_TABLE} SET {column} = NULL "
            f"WHERE {column} IS NOT NULL "
            f"AND {column} NOT IN (SELECT id FROM {parent_table})"
        )
    )
    return int(result.rowcount or 0)


def upgrade() -> None:
    tables = _tables()
    if _SNAPSHOT_TABLE not in tables:
        # 部分历史库还没有快照表（0064 之前）：没有可清理的行。
        return
    # 0064 对"已存在"的快照表逐表跳过、不补列，所以历史库/测试构造的最小表可能只有
    # id 列：缺列时跳过对应清理，而不是让整个升级链报 no such column。
    columns = _snapshot_columns()
    for column, parent_table in _REFERENCES:
        if column in columns and parent_table in tables:
            _detach_dangling_references(column, parent_table)


def downgrade() -> None:
    """纯数据清理不可逆：父行已删除，复原引用只会重新制造悬空行与 UNIQUE 冲突。"""

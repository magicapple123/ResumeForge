# SPDX-License-Identifier: Apache-2.0
"""0047：给 ``resume_record`` 加 ``updated_at`` —— 简历列表支持「最近修改」排序。

为什么需要它：``created_at`` 只能回答"什么时候生成的"。用户在一份旧简历上改了内容、
调了版式之后，它在列表里仍停在原来的位置，越改越靠后；「最近修改」是简历列表最自然
的默认顺序。

**只加列**（"旧备份仍可导入"的前提）：可空、不参与任何约束；升级时用 ``created_at``
回填，于是升级那一刻的顺序与升级前完全一致——不会因为一次迁移让用户的列表突然重排。
新写入由模型侧的 ``onupdate`` 维护。

可能跑在只有部分业务表的历史库上：表或列不存在时跳过而不是报错。

Revision ID: 0047_resume_updated_at
Revises: 0046_search_fts
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_resume_updated_at"
down_revision: str | Sequence[str] | None = "0046_search_fts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_record"
_COLUMN = "updated_at"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    if not columns or _COLUMN in columns:
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.DateTime(), nullable=True))
    # 与模型里的 `index=True` 对齐：列表默认按 updated_at 排序，没有索引就是全表扫。
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{_TABLE}_{_COLUMN} ON {_TABLE} ({_COLUMN})")
    # 旧行没有"最后修改"的概念：把创建时间当作它的起点，升级前后排序不变。
    # 极老的表可能连 created_at 都没有（历史库形态），这时留空即可——排序侧用
    # `coalesce(updated_at, created_at)` 兜底，迁移不该为了对齐一个可空列而失败。
    if "created_at" in columns:
        op.execute(f"UPDATE {_TABLE} SET {_COLUMN} = created_at WHERE {_COLUMN} IS NULL")


def downgrade() -> None:
    columns = _columns()
    if _COLUMN not in columns:
        return
    # 先删索引再删列：batch 重建表时会按当前 schema 重建索引，索引还指着要删的列
    # 就会在"列已经没了"之后执行 CREATE INDEX（降级顺序错了会报 "no such column"，而错误指向的是 CREATE INDEX，很容易误判成索引写错）。
    op.execute(f"DROP INDEX IF EXISTS ix_{_TABLE}_{_COLUMN}")
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

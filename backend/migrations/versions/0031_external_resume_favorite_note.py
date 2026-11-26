# SPDX-License-Identifier: Apache-2.0
"""0031：``external_resume.favorite`` / ``favorited_at`` / ``note`` —— 外部简历补齐收藏与备注。

背景（R10 续 · P0）：内部简历早就有收藏与备注，外部简历只有原件 + 正文，做不了"这份先留着"，
也没地方记"这份是给甲方版本"。三个列一次加齐，因为它们描述同一次"地位对齐"：
外部简历从此和内部简历一样能被收藏、能被备注。

五个取舍：

1. **``favorite`` 用 ``server_default=false``（而不是只有 python 默认值）**：
   ``ALTER TABLE ADD COLUMN ... NOT NULL`` 在有数据的表上必须给默认值，否则既有行没法填；
   顺带让非 ORM 写入（迁移回填、直接 SQL）也自动是"未收藏"。
2. **``favorited_at`` 可空**：``NULL`` = 从没收藏过（取消收藏时也清回 ``NULL``）。
   它和 ``favorite`` 不是冗余——一个回答"现在是不是收藏"，一个回答"什么时候收藏的"，
   收藏页按后者倒序排"最近收藏的在前"。
3. **``note`` 用 ``server_default=''``**：与内部简历 ``note`` 同一口径（空串 = 没写），
   不用 ``NULL``：读侧就少一处 ``(note or "")``。
4. **不给 ``favorite`` 建索引**：收藏页的候选集是"用户自己上传的几十份"，全表扫足够；
   建索引就得让模型 ``index=True`` 与迁移双向对齐（``test_model_migration_index_parity``），
   收益不抵这份维护成本。
5. **``updated_at`` 不动**：``external_resume.updated_at`` 带 ``onupdate=utcnow``，收藏一旦
   走 ORM 赋值就会把行顶到"最近更新"的头上（R2 的"行跳位"）。写入必须走
   ``services/favorites.py`` 的 Core ``update()`` 并显式写回 ``updated_at``——这是写侧的
   约定，迁移只负责把列备好。

升级/降级都要能跑，且**表或列不存在时跳过而不是报错**（迁移会跑在"只有部分业务表"的库上）。
降级把三列一起删（连同收藏与备注的数据），再升级能按原样加回来。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_external_resume_favorite_note"
down_revision: str | Sequence[str] | None = "0030_reminder_external_resume"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "external_resume"
_FAVORITE = "favorite"
_FAVORITED_AT = "favorited_at"
_NOTE = "note"
_NEW_COLUMNS = (_FAVORITE, _FAVORITED_AT, _NOTE)


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    """三列逐个补（各自判存在，部分列已存在时只补缺的那几列）。"""
    if _TABLE not in _table_names():
        return
    columns = _column_names()
    if _FAVORITE not in columns:
        op.add_column(
            _TABLE,
            sa.Column(_FAVORITE, sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if _FAVORITED_AT not in columns:
        op.add_column(_TABLE, sa.Column(_FAVORITED_AT, sa.DateTime(), nullable=True))
    if _NOTE not in columns:
        op.add_column(
            _TABLE,
            sa.Column(_NOTE, sa.Text(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    """删三列；一列都没有就直接返回。

    用 batch 一次重建（三个 ``drop_column`` 在同一个上下文里）而不是三次原生
    ``ALTER TABLE DROP COLUMN``：SQLite 的原生 DROP COLUMN 对"列上有默认值 / 被索引引用"
    的边界因版本而异，batch 的建新表 + 换名在所有版本上行为一致。
    """
    if _TABLE not in _table_names():
        return
    columns = _column_names()
    present = tuple(column for column in _NEW_COLUMNS if column in columns)
    if not present:
        return
    with op.batch_alter_table(_TABLE) as batch:
        for column in present:
            batch.drop_column(column)

# SPDX-License-Identifier: Apache-2.0
"""0013：收藏时间戳 —— job.favorited_at / resume_record.favorited_at（#28E）。

#28 的结构性缺陷之一：收藏只有 favorite 布尔列，没有收藏时间。收藏夹默认按
created_desc（岗位**入库**时间）排序，于是"三天前收藏了一条 2024 年入库的老岗位"
会沉到第三页之后——「我最近收了什么」这个最自然的诉求做不到。

三条不变量：

1. **可空**：NULL = 从未收藏（或已被取消）。收藏写、取消清空，不删行、不回填别的值。
2. **老数据回填 updated_at**：旧代码收藏时会 UPDATE 这一行（favorite 置真），
   updated_at 就是那次写的时间。它是**近似值**，不是精确收藏时间（之后改备注、
   改状态都会刷新它），所以额外记一个 favorited_at_estimated 标志：回填行置 1，
   新写入置 0，界面据此显示「时间不详」而不是把一个近似值当精确时间展示。
   若只回填不标记，「回填值」与「用户真的在那一刻收藏」在数据层不可区分，界面只能猜。
3. **降级只删本迁移加的两列**，不碰 favorite 本身与两表的其余内容。

升级/降级都要能跑：表或列不存在时跳过而不是报错（迁移会跑在只有部分业务表的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_favorite_timestamps"
down_revision: str | Sequence[str] | None = "0012_job_seen"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JOB_TABLE = "job"
_RESUME_TABLE = "resume_record"
_FAVORITED_AT = "favorited_at"
_ESTIMATED = "favorited_at_estimated"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _add_favorite_timestamp_columns(table: str) -> None:
    """给一张表加两列；列已存在时逐列跳过（幂等：create_all 建过的库也能升级）。"""
    if table not in _table_names():
        return
    columns = _column_names(table)
    if _FAVORITED_AT not in columns:
        # 时间戳可空：NULL 表示"没有收藏时间"（未收藏，或旧数据里无法得知）。
        op.add_column(table, sa.Column(_FAVORITED_AT, sa.DateTime(), nullable=True))
    if _ESTIMATED not in columns:
        # 非空 + 默认 0 是必须的：SQLite 给非空列加列时已有行要靠 server_default 取值，
        # 否则升级在第一条老数据上就失败。新写入显式置 0（不依赖默认值）。
        op.add_column(
            table,
            sa.Column(
                _ESTIMATED,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


def _backfill_favorite_timestamps(table: str) -> None:
    """把**已收藏**且还没有时间戳的行用 updated_at 回填，并标记为近似值。

    只动 favorite = 1 的行：未收藏行的 favorited_at 必须保持 NULL，
    否则"取消收藏后清空"会与"从未收藏"混淆。
    """
    if table not in _table_names():
        return
    columns = _column_names(table)
    if _FAVORITED_AT not in columns or _ESTIMATED not in columns:
        return
    op.execute(
        sa.text(
            f"UPDATE {table} SET {_FAVORITED_AT} = updated_at, {_ESTIMATED} = 1 "
            f"WHERE favorite = 1 AND {_FAVORITED_AT} IS NULL"
        )
    )


def _drop_favorite_timestamp_columns(table: str) -> None:
    """降级：只删本迁移加的两列；列不存在则跳过，不碰 favorite。"""
    if table not in _table_names():
        return
    columns = _column_names(table)
    if _ESTIMATED in columns:
        op.drop_column(table, _ESTIMATED)
    if _FAVORITED_AT in columns:
        op.drop_column(table, _FAVORITED_AT)


def upgrade() -> None:
    """加收藏时间戳两列并回填旧收藏行；表/列已存在则跳过。"""
    for table in (_JOB_TABLE, _RESUME_TABLE):
        _add_favorite_timestamp_columns(table)
        _backfill_favorite_timestamps(table)


def downgrade() -> None:
    """删两列（收藏布尔列与业务数据原样保留）；表/列不存在则跳过。"""
    for table in (_RESUME_TABLE, _JOB_TABLE):
        _drop_favorite_timestamp_columns(table)

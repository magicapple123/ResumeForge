# SPDX-License-Identifier: Apache-2.0
"""0051：给 ``resume_record`` 加 ``draft`` —— 让「前往简历制作台」不再立刻造出一份简历。

为什么需要它：那个入口此前会**立即** POST 一条记录再去开制作台。用户点进去看一眼、
什么都没保存就关掉，简历中心里却多了一份空白简历——它既不是他写的，也没有任何东西
能把它和真简历区分开。有了这一列，那份记录以"草稿"身份存在：制作台读得到（它按 id
取详情），但简历中心的列表、搜索、统计、自动投递的"本岗位最近一份"全都看它不见。
保存（内容 PATCH 或版式 PATCH）成功即置 FALSE，它才真正出现。

**只加列**（"旧备份仍可导入"的前提）：``NOT NULL`` + ``server_default="0"``。
SQLite 对带 DEFAULT 的加列会用默认值填充已有行，所以历史简历全部落到"不是草稿"，
与它们此前的可见性**逐字一致**——升级不会让任何一份已有简历从列表里消失。
DB 层不建 CHECK 约束（SQLite 加约束要重建表，违背"只加列"），取值只有两种，
没有需要收口的枚举。

不加索引：``draft`` 只和已有的软删条件一起出现在 WHERE 里，而"草稿"在真实库里
通常是 0 行或 1 行（用户要么保存、要么关掉），单独建索引没有收益。

可能跑在只有部分业务表的历史库上：表或列不存在时跳过而不是报错。

Revision ID: 0051_resume_draft
Revises: 0050_candidate_job_soft_delete
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0051_resume_draft"
down_revision: str | Sequence[str] | None = "0050_candidate_job_soft_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_record"
_COLUMN = "draft"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # 表不存在（残缺历史库）或列已存在（legacy 库先被 create_all + ensure_sqlite_columns
    # 补过列，再从 0001 stamp 走整条链）都直接跳过，不能让整条迁移链失败。
    if not columns or _COLUMN in columns:
        return
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    columns = _columns()
    if _COLUMN not in columns:
        return
    # 完整降级：还没保存过的草稿会**重新变成正常简历**（列没了就没有"草稿"这个状态），
    # 但库仍然可用——旧版本不认识这一列，留着反而会让"表结构与修订号不一致"。
    # 用户手动删掉那几条即可，比让整条迁移链卡住要好。
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

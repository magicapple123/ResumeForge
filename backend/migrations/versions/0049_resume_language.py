# SPDX-License-Identifier: Apache-2.0
"""0049：给 ``resume_record`` 加 ``language`` —— 纸面固定文案的语言变成数据。

为什么需要它：小节标题与字段前缀（"个人总结" / "教育经历" / "绩点/排名"…）今天以中文
字面量散落在四类导出链路里，用户无法让一份简历导成英文标题。语言是**这份文档**的属性，
所以落在记录上，而不是版式模板（版式是"排得多密、长什么样"，不该随版式切换改语言）
或全局设置（同一个人可能同时投中文岗和英文岗）。

**只加列**（"旧备份仍可导入"的前提）：``NOT NULL`` + ``server_default="zh-CN"``。
SQLite 对带 DEFAULT 的加列会用默认值填充已有行，所以旧简历全部落到 ``zh-CN``，
与它们此前的输出**逐字一致**——不猜内容语言。DB 层不建 CHECK 约束（SQLite 加约束要
重建表，违背"只加列"），取值范围由 schema 层的 ``Literal`` 收口，读取侧由
``resume_labels.normalize_language`` 兜底。

不加索引：语言不是查询条件（``font_scale`` / ``template`` 也没有索引）。

可能跑在只有部分业务表的历史库上：表或列不存在时跳过而不是报错。

Revision ID: 0049_resume_language
Revises: 0048_job_analysis_cache
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0049_resume_language"
down_revision: str | Sequence[str] | None = "0048_job_analysis_cache"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_record"
_COLUMN = "language"
_DEFAULT = "zh-CN"


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
        sa.Column(_COLUMN, sa.String(16), nullable=False, server_default=_DEFAULT),
    )


def downgrade() -> None:
    columns = _columns()
    if _COLUMN not in columns:
        return
    # 完整降级：语言值随之丢失，但库仍然可用（旧版本不认识这一列，留着反而会
    # 让"表结构与修订号不一致"，所以删除是唯一正确的降级动作）。
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

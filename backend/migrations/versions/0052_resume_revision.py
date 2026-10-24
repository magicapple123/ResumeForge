# SPDX-License-Identifier: Apache-2.0
"""0052：给 ``resume_record`` 加 ``revision`` —— 让「保存」能判断自己基于哪一版。

为什么需要它：两个窗口（或两个标签页）同时改一份简历时，后保存的那个会用自己手里的
旧正文**静默覆盖**别人刚写的东西。当前库结构里没有任何字段能回答"我手里这一版还是不是
最新的"，所以条件写无从下手。加一个只增不减的整数列之后，保存语句可以写成
``UPDATE ... WHERE id=? AND revision=?``：命中就推进一版，没命中就说明"这一版已经不存在"，
调用方据此回 409，让用户**看见**冲突，而不是被覆盖。

**只加列**（"旧备份仍可导入"的前提）：``NOT NULL`` + ``server_default="0"``。旧备份包的
``INSERT`` 里没有这一列，没有服务端默认值会整表导入失败（与 0051 同一条理由）。

**不回填**、不按 ``updated_at`` 造序号：旧行的"第几版"在数据里无从得知，把它们编成
1..N 等于凭空发明历史。0 是唯一诚实的值——它只表示"这一版之前的保存次数不可知"，
不是"没有内容"。``revision`` 也不是撤销层级：撤销走前端的历史栈，一次保存只推一版。

不加索引：``revision`` 只出现在已按主键定位的 UPDATE 的 WHERE 里，单独建索引没有收益。

可能跑在只有部分业务表的历史库上：表或列不存在时跳过而不是报错。

Revision ID: 0052_resume_revision
Revises: 0051_resume_draft
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0052_resume_revision"
down_revision: str | Sequence[str] | None = "0051_resume_draft"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_record"
_COLUMN = "revision"


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
        sa.Column(_COLUMN, sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    columns = _columns()
    if _COLUMN not in columns:
        return
    # 完整降级：版本号没了，"两个窗口同时改"的保护随之消失，但库仍然可用。
    # 内容本身不受影响——这一列只是保存计数，不是数据。
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

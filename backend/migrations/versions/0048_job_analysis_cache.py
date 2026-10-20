# SPDX-License-Identifier: Apache-2.0
"""0048：``job.analysis_cache`` —— 岗位解读结果落库（R2）。

为什么要它：岗位解读是一次真实的模型调用（10–60 秒、按 token 计费）。此前的实现
每次打开弹窗都重新生成——用户只是想再看一眼上次的结论，也要再等一分钟。

**只加列**（旧备份仍可导入），可空、带 ``'{}'`` 服务端默认值；历史行读出为"没有缓存"，
行为与升级前一致。缓存里存 ``fingerprint``（岗位内容的 sha256）、``generated_at`` 与
``result``；内容改过时读取方把它标成"可能过期"，但不自动丢弃。

Revision ID: 0048_job_analysis_cache
Revises: 0047_resume_updated_at
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048_job_analysis_cache"
down_revision: str | Sequence[str] | None = "0047_resume_updated_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "job"
_COLUMN = "analysis_cache"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    if not columns or _COLUMN in columns:
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _COLUMN not in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

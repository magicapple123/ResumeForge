# SPDX-License-Identifier: Apache-2.0
"""0054：给 resume_record 加 document_mode——普通简历 / 长 CV 的文档形态（W14 前置）。

为什么单独一个迁移：W14-BE 需要按形态区分页数上限与资源预算，而"这份记录是不是长 CV"
必须落库（不能只放在请求参数里，否则切换页面后导出会退回普通简历的 1-3 页约束）。
列值由 schema/导出链路解释，DB 层不建 CHECK 约束（与 language 同一取舍）。

**只加列**（"旧备份仍可导入"的前提）：NOT NULL + server_default="resume"。旧备份包的
INSERT 里没有这一列，没有服务端默认值会整表失败；旧行升级后一律读作 resume，
导出/预览结果逐字节不变（契约 §5）。

表不存在时跳过；完整 downgrade。

Revision ID: 0054_resume_document_mode
Revises: 0053_resume_provenance
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054_resume_document_mode"
down_revision: str | Sequence[str] | None = "0053_resume_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "resume_record"
_COLUMN = "document_mode"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # 残缺历史库（没有 resume_record）与"列已被 legacy 补列路径建出"都直接跳过。
    if not columns or _COLUMN in columns:
        return
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.String(length=16), nullable=False, server_default="resume"),
    )


def downgrade() -> None:
    columns = _columns()
    if _COLUMN not in columns:
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

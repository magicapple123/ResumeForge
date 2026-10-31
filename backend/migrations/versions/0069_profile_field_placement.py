# SPDX-License-Identifier: Apache-2.0
"""0069：自定义字段的"纸面默认位置"与"仅素材"属性（v2 文档模型）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

- ``default_placement``（VARCHAR(16)，可空）：该自定义字段在 v2 文档里的默认抽屉
  （title / meta / lead / trail / body / hidden）。NULL = "按 field_type 自动"——
  single_line / date_text 默认 trail、multi_line 默认 body（D6），所以不需要给历史行
  回填：转换器把 NULL 解释成"跟随类型默认"，语义与显式写入自动值一致且可区分。
- ``material_only``（BOOLEAN NOT NULL DEFAULT 0）：只进 AI / 网申素材、不上纸面
  （资料页与制作台显式标注"不上纸面"）。默认 0 保证历史行升级后行为逐字节不变。

**升级安全**：``profile_custom_field`` 表不存在时直接返回（迁移链也会跑在只有部分
业务表的历史库上）；加列前先检查是否已存在，重复执行不报错。

**downgrade 完整可逆**：SQLite 删列走 ``batch_alter_table``（重建表），两列依次移除后
表结构与升级前一致。

Revision ID: 0069_profile_field_placement
Revises: 0068_ai_tasks
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0069_profile_field_placement"
down_revision: str | Sequence[str] | None = "0068_ai_tasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "profile_custom_field"
# (列名, 建列语句)：可空/有默认值，历史行升级后立刻可读。
_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    (
        "default_placement",
        sa.Column("default_placement", sa.String(length=16), nullable=True),
    ),
    (
        "material_only",
        sa.Column(
            "material_only",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    ),
)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def upgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        # 0064 之前的历史库还没有自定义字段表：没有可补的列。
        return
    existing = _columns()
    for name, column in _COLUMNS:
        if name not in existing:
            op.add_column(_TABLE, column)


def downgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    existing = _columns()
    with op.batch_alter_table(_TABLE) as batch:
        for name, _column in reversed(_COLUMNS):
            if name in existing:
                batch.drop_column(name)

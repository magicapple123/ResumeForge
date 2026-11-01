# SPDX-License-Identifier: Apache-2.0
"""0070：投递记录的失败三列（#39 失败分类）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

- ``failure_step``（VARCHAR(32)，默认空串）：失败发生在哪一步（简历筛选 / 笔试 /
  面试 / 谈offer / 入职前毁约……自由文本，界面按出现频次聚合）。
- ``failure_target``（VARCHAR(128)，默认空串）：卡在哪一环的具体对象（如面试官、
  笔试科目、对方联系人），可空。
- ``failure_reason``（TEXT，默认空串）：用户自己总结的具体原因（一句话即可）；
  与 ``note``（流水记录）分开，三列共同支撑「每行有具体原因、可按分类筛选、
  组头同因聚合」的记录视图。

**升级安全**：``application_track`` 表不存在时直接返回；加列前检查已存在，重复执行
不报错。默认空串保证历史行升级后行为逐字节不变（界面把空串渲染为「未分类」）。

**downgrade 完整可逆**：SQLite 删列走 ``batch_alter_table``（重建表），三列依次移除
后表结构与升级前一致。

Revision ID: 0070_failure_taxonomy
Revises: 0069_profile_field_placement
Create Date: 2026-11-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0070_failure_taxonomy"
down_revision: str | Sequence[str] | None = "0069_profile_field_placement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "application_track"
_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    (
        "failure_step",
        sa.Column(
            "failure_step", sa.String(length=32), nullable=False, server_default=sa.text("''")
        ),
    ),
    (
        "failure_target",
        sa.Column(
            "failure_target", sa.String(length=128), nullable=False, server_default=sa.text("''")
        ),
    ),
    (
        "failure_reason",
        sa.Column("failure_reason", sa.Text(), nullable=False, server_default=sa.text("''")),
    ),
)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def upgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
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

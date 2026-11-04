# SPDX-License-Identifier: Apache-2.0
"""0075：自建板块的「参与岗位相关性筛选」开关（问题清单 需求 6）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

``profile_custom_section.filter_by_job``（BOOLEAN NOT NULL，server_default ``'0'``）——
需求 6 要求自建板块可以**选择**是否参与岗位关键词筛选，且"选了就必须真的参与"。开关是
**板块级**（不是条目级，也不进 ``profile_entry``）：同一板块的所有条目共用一个判据，
放在定义表上才只有一处真相。``profile_custom_section`` 本来就随方案（数据集库）走，
因此这一列天然"跟随方案"，不需要第二份 key→开关 的影子表。

**默认 false 是升级契约**：历史库里所有自建板块升级后仍是"无条件全量进简历"，与升级前的
行为逐字节一致；用户不主动打开就不会有任何生成结果变化。

**升级安全**：表不存在时直接返回（迁移链也会跑在只有部分业务表的历史库上）；加列前先
检查列是否已存在，重复执行不报错。

**downgrade 完整可逆**：SQLite 删列走 ``batch_alter_table``（重建表），列移除后表结构与
升级前一致。

Revision ID: 0075_profile_section_job_filter
Revises: 0074_usage_audit_fields
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0075_profile_section_job_filter"
down_revision: str | Sequence[str] | None = "0074_usage_audit_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "profile_custom_section"
_COLUMN = "filter_by_job"


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def upgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    if _COLUMN in _columns():
        return
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    if _COLUMN not in _columns():
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

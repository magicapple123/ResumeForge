# SPDX-License-Identifier: Apache-2.0
"""0071：面试材料导入 + 追问分相（#41）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

``interview_session`` 四列——一场面试的两份材料可以来自"从记录选"或"导入文件"：

- ``job_material_name``（VARCHAR(256)，默认空串）：导入的 JD 文件名（列表/详情显示用）。
- ``job_material_text``（TEXT，默认空串）：那份 JD 提取出的正文（PDF / TXT），进提示词。
- ``resume_material_name``（VARCHAR(256)，默认空串）：导入的简历截图文件名。
- ``resume_material_text``（TEXT，默认空串）：截图经视觉模型识别出的文本，进提示词。

``interview_message`` 一列：

- ``phase``（VARCHAR(16)，默认 ``'interview'``）：``interview`` = 正式问答（计入轮次），
  ``followup`` = 结束后的追问（**不计轮次**，不会让已结束的面试重新开始）。

**升级安全**：每张表不存在时直接跳过；加列前检查已存在，重复执行不报错。默认值保证
历史行升级后行为逐字节不变——老会话的两列材料为空 → 仍只读关联的岗位/简历记录；
老消息的 ``phase`` 为 ``interview`` → ``answered_rounds`` 的读数一个字都不变。

**downgrade 完整可逆**：SQLite 删列走 ``batch_alter_table``（重建表），五列依次移除后
表结构与升级前一致。

Revision ID: 0071_interview_materials
Revises: 0069_profile_field_placement
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0071_interview_materials"
down_revision: str | Sequence[str] | None = "0069_profile_field_placement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SESSION_TABLE = "interview_session"
_MESSAGE_TABLE = "interview_message"

# 每张表一批列：``(表名, ((列名, sa.Column), ...))``。
_COLUMNS: tuple[tuple[str, tuple[tuple[str, sa.Column], ...]], ...] = (
    (
        _SESSION_TABLE,
        (
            (
                "job_material_name",
                sa.Column(
                    "job_material_name",
                    sa.String(length=256),
                    nullable=False,
                    server_default=sa.text("''"),
                ),
            ),
            (
                "job_material_text",
                sa.Column(
                    "job_material_text", sa.Text(), nullable=False, server_default=sa.text("''")
                ),
            ),
            (
                "resume_material_name",
                sa.Column(
                    "resume_material_name",
                    sa.String(length=256),
                    nullable=False,
                    server_default=sa.text("''"),
                ),
            ),
            (
                "resume_material_text",
                sa.Column(
                    "resume_material_text", sa.Text(), nullable=False, server_default=sa.text("''")
                ),
            ),
        ),
    ),
    (
        _MESSAGE_TABLE,
        (
            (
                "phase",
                sa.Column(
                    "phase",
                    sa.String(length=16),
                    nullable=False,
                    server_default=sa.text("'interview'"),
                ),
            ),
        ),
    ),
)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns(table: str) -> set[str]:
    return {column["name"] for column in _inspector().get_columns(table)}


def upgrade() -> None:
    tables = set(_inspector().get_table_names())
    for table, columns in _COLUMNS:
        if table not in tables:
            continue
        existing = _columns(table)
        for name, column in columns:
            if name not in existing:
                op.add_column(table, column)


def downgrade() -> None:
    tables = set(_inspector().get_table_names())
    for table, columns in reversed(_COLUMNS):
        if table not in tables:
            continue
        existing = _columns(table)
        with op.batch_alter_table(table) as batch:
            for name, _column in reversed(columns):
                if name in existing:
                    batch.drop_column(name)

# SPDX-License-Identifier: Apache-2.0
"""0074：#35 数据边界四字段落进用量账本（input_scope / masked / language / budget）。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

``llm_usage_record`` 四列——审计要求每次 AI 调用都能回答"喂了什么范围、是否脱敏、
给谁看、多少预算"，此前这四项只进了 ``llm.call`` 日志与 ContextVar，接口与表里都查不到，
事后无法逐条自证：

- ``input_scope``（VARCHAR(64)，默认空串）：本次调用喂进去的数据范围声明，取值见
  ``services.llm.usage_tasks.scope_for_path``（``resume+profile+job`` / ``job`` / ``none``…）。
- ``masked``（BOOLEAN，**可空**）：是否已脱敏。**NULL = 未声明**，与 False（明确未脱敏）
  是两件事——把"没记录"折成 False 会让审计读成"这次确实没脱敏"。
- ``language``（VARCHAR(16)，默认空串）：目标（输出）语言，BCP 47 短码。
- ``budget``（INTEGER，可空）：本次请求的 token 预算声明；它不是硬截断（硬约束是
  provider 的 max_tokens），NULL 表示这一版没声明。

**升级安全**：表不存在时直接返回；加列前逐列检查已存在，重复执行不报错。默认空串/可空
保证历史行升级后行为逐字节不变——老账本读出来是"未声明"，而不是被伪造成某个具体值。

**downgrade 完整可逆**：SQLite 删列走 ``batch_alter_table``（重建表），四列倒序移除后
表结构与升级前一致。

Revision ID: 0074_usage_audit_fields
Revises: 0073_apply_item_failure_taxonomy
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0074_usage_audit_fields"
down_revision: str | Sequence[str] | None = "0073_apply_item_failure_taxonomy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "llm_usage_record"

# 顺序即加列顺序；downgrade 倒序移除（先删后加的最后加的那一列）。
_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    (
        "input_scope",
        sa.Column(
            "input_scope", sa.String(length=64), nullable=False, server_default=sa.text("''")
        ),
    ),
    # 可空是语义的一部分：NULL = 未声明脱敏策略，False = 明确未脱敏。
    ("masked", sa.Column("masked", sa.Boolean(), nullable=True)),
    (
        "language",
        sa.Column("language", sa.String(length=16), nullable=False, server_default=sa.text("''")),
    ),
    ("budget", sa.Column("budget", sa.Integer(), nullable=True)),
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

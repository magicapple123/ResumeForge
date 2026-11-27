# SPDX-License-Identifier: Apache-2.0
"""0033：``apply_queue_item.external_resume_id`` —— 队列条目要记住"用哪一份外部简历投"。

背景（R10 续 · P1）：0032 只给**投递历史**（``apply_task_item``）加了这一列，队列条目
（``apply_queue_item``）仍然只能存 ``resume_id``。可队列行的编辑入口是
``PATCH /api/apply/queue/{item_id}``——用户在队列里选定一份外部简历，保存后刷新，
选择必须还在；没有这一列就只能在提交那一刻临时指定，队列条目记不住。

四条取舍与 0032 逐字同口径：

1. **``nullable=True`` + 无 server_default**：没指定就是 ``NULL``。
2. **``ondelete="SET NULL"``**：外部简历被彻底删除时置空，队列条目本身仍可读。
3. **建索引**：索引名必须与模型 ``index=True`` 推导出的名字逐字一致
   （``ix_apply_queue_item_external_resume_id``，由 ``test_model_migration_index_parity``
   双向守卫）。
4. **XOR 不落库**：``resume_id`` 与 ``external_resume_id`` 同时有值属调用方错误，在
   schema/API 层返回 422。SQLite 上加 CHECK 要重建整张表，为一条业务约定付这份代价不值
   （与 0032 同判断）。

``batch_alter_table``：SQLite 的 ``ALTER TABLE`` 不能加外键，需要"建新表 → 拷数据 → 换名"；
batch 模式会一并重建既有索引与 CASCADE 外键，降级不再丢。

升级/降级都要能跑，且**表或列不存在时跳过而不是报错**（迁移会跑在"只有部分业务表"的库上）。
``external_resume`` 表不存在时只加列与索引、不建外键。

``app_schema_epoch`` 保持 2：增量加列不涉及世代判定。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033_apply_queue_item_external_resume"
down_revision: str | Sequence[str] | None = "0032_apply_item_external_resume"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "apply_queue_item"
_COLUMN = "external_resume_id"
_TARGET_TABLE = "external_resume"
_INDEX = "ix_apply_queue_item_external_resume_id"
_FOREIGN_KEY = "fk_apply_queue_item_external_resume_id"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def _index_names() -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(_TABLE)}


def upgrade() -> None:
    """加 ``external_resume_id`` 列 + 索引（+ 目标表存在时加外键）；已存在则跳过。"""
    tables = _table_names()
    if _TABLE not in tables:
        return
    if _COLUMN in _column_names():
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.add_column(sa.Column(_COLUMN, sa.Integer(), nullable=True))
        batch.create_index(_INDEX, [_COLUMN], unique=False)
        if _TARGET_TABLE in tables:
            batch.create_foreign_key(
                _FOREIGN_KEY,
                _TARGET_TABLE,
                [_COLUMN],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    """删列（连同它的索引与外键）；列不存在则跳过。

    索引在 batch 之外先删：batch 重建表时 SQLite 的反射对"要删的列上的索引"处理因版本
    而异，显式删掉一次最稳。
    """
    if _TABLE not in _table_names() or _COLUMN not in _column_names():
        return
    if _INDEX in _index_names():
        op.drop_index(_INDEX, table_name=_TABLE)
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

# SPDX-License-Identifier: Apache-2.0
"""0032：``apply_task_item.external_resume_id`` —— 投递台可用外部简历原件投递。

背景（R10 续 · P1）：投递记录原先只能记 ``resume_id``（内部结构化简历），可用户在别处生成
的那版 PDF 正是投出去的那份。要让"这一版投给了谁"说得清，条目得能指向 ``external_resume``；
附件直接从它的 ``file_id`` 取（``user_file`` 已经是内容寻址的共享登记，不需要再拷一份字节）。

四条取舍：

1. **``nullable=True`` + 无 server_default**：没指定就是 ``NULL``（与 ``resume_id`` 同口径）。
2. **``ondelete="SET NULL"``**：外部简历被彻底删除时这条历史记录的关联置空，但记录本身与
   ``resume_title`` 快照都留下（与 0025 的 ``application_track`` 逐字同语义）。
3. **建索引**：统计口径要按 ``(resume_id, external_resume_id)`` 一起算"某版简历投了多少次"；
   索引名必须与模型 ``index=True`` 推导出的名字逐字一致
   （``test_model_migration_index_parity`` 双向守卫）。
4. **与 ``resume_id`` 的 XOR 在 API 层收窄（同时传 = 422），不在库上做 CHECK**：
   SQLite 上加 CHECK 要重建整张表，而 ``apply_task_item`` 是投递历史里最宽的一张，
   为一条业务约定付这份代价不值。

``queue_item_id`` 的先例说明审计列可以不带外键，但这里**带**：它需要"简历删了就置空"的
级联语义，而 ``queue_item_id`` 要的是"队列条目移出后历史仍可读"——两个诉求相反。

``apply_task_item`` 上跑 ``batch_alter_table``：SQLite 的 ``ALTER TABLE`` 不能加外键，需要
"建新表 → 拷数据 → 换名"；batch 模式会一并重建既有索引与 CASCADE 外键，降级不再丢。

升级/降级都要能跑，且**表或列不存在时跳过而不是报错**（迁移会跑在"只有部分业务表"的库上）。
``external_resume`` 表不存在时只加列与索引、不建外键：那种库本来就没有可指向的目标表，
硬建外键会让迁移直接失败。

``app_schema_epoch`` 保持 2：增量加列不涉及世代判定。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_apply_item_external_resume"
down_revision: str | Sequence[str] | None = "0031_external_resume_favorite_note"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "apply_task_item"
_COLUMN = "external_resume_id"
_TARGET_TABLE = "external_resume"
_INDEX = "ix_apply_task_item_external_resume_id"
_FOREIGN_KEY = "fk_apply_task_item_external_resume_id"


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
    而异，显式删掉一次最稳。删列会丢掉"这条投递用的是哪份外部简历"——降级的固有代价
    （与 0025 / 0030 同），``resume_title`` 快照与记录本身都不删。
    """
    if _TABLE not in _table_names() or _COLUMN not in _column_names():
        return
    if _INDEX in _index_names():
        op.drop_index(_INDEX, table_name=_TABLE)
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

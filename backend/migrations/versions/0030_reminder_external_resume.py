# SPDX-License-Identifier: Apache-2.0
"""0030：``reminder.external_resume_id`` —— 提醒可关联外部简历（R14）。

背景：``Reminder.resume_id`` 只指向 ``resume_record``（内部结构化简历），用户在别处生成的
PDF / docx 只存在 ``external_resume`` 里。要让"跟进这一版外部简历"的提醒说得清，就得有
一条真关联；沿用 ``application_track`` 0025 的先例（同语义、同列型、同索引名形状）。

四条取舍：

1. **``nullable=True`` + 无 server_default**：没关联就是 ``NULL``（与 ``resume_id`` /
   ``job_id`` 同一口径）。它是"指向哪一份"，不是"没填"的文本——用空串表达会在 SQLite 里
   和 0 混淆；
2. **``ondelete="SET NULL"``**：外部简历被彻底删除时关联自动置空，提醒本身留下
   （软删不触发外键，那时关联照旧可读）；
3. **建索引**：列表 / 详情之外的"哪些提醒挂着这份外部简历"要按它回查；列宽只有一个整数，
   写放大可以忽略。索引名必须与模型 ``index=True`` 推导出的名字逐字一致
   （``test_model_migration_index_parity`` 双向守卫）；
4. **SQLite 走 ``batch_alter_table``**：SQLite 的 ``ALTER TABLE`` 不能加外键，需要
   "建新表 → 拷数据 → 换名"。batch 模式会一并重建既有索引与外键
   （``ix_reminder_remind_at`` / ``ix_reminder_status`` 与三条 SET NULL 外键），降级不再丢。

与 ``resume_id`` **互斥**（同时传两个 = 422）由 API / schema 层收窄，不在库上做 CHECK：
SQLite 上加 CHECK 要重建整张表，而这里只是"一条提醒只指一份简历"的业务约定。

升级/降级都要能跑，且**表或列不存在时跳过而不是报错**（迁移会跑在"只有部分业务表"的库上）。
``external_resume`` 表不存在时只加列与索引、不建外键：那种库本来就没有可指向的目标表，
硬建外键会让迁移直接失败。

``app_schema_epoch`` 保持 2：增量加列不涉及世代判定。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030_reminder_external_resume"
down_revision: str | Sequence[str] | None = "0029_external_resume_revision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "reminder"
_COLUMN = "external_resume_id"
_TARGET_TABLE = "external_resume"
_INDEX = "ix_reminder_external_resume_id"
_FOREIGN_KEY = "fk_reminder_external_resume_id"


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
    而异，显式删掉一次最稳；``DROP INDEX`` 在 SQLite 上是原生支持的 DDL。
    删列会丢掉用户建立的关联——这是降级的固有代价（与 0025 同），提醒本身不删。
    """
    if _TABLE not in _table_names() or _COLUMN not in _column_names():
        return
    if _INDEX in _index_names():
        op.drop_index(_INDEX, table_name=_TABLE)
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

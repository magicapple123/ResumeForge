# SPDX-License-Identifier: Apache-2.0
"""0020：补齐 29 个外键前导索引 + 1 个模型漂移索引（D7）。

D7 的判据是"外键列不是任何索引/唯一约束的第一列"：SQLite 不会自动为外键建索引，
PRAGMA foreign_keys=ON 下父行硬删（回收站清空 / purge）要逐个子表全表扫才能找到
要 SET NULL / CASCADE 的行。索引必须与模型层成对落地：16 个模型文件的对应列已加
index=True，本迁移补真库的 DDL——两边不一致会让 alembic 建的库与 create_all 建的
库分叉（tests/test_model_migration_index_parity.py 守着这条）。

另补一处**反向漂移**：assistant_conversation_skill.created_at 在模型里早就是
index=True（按 created_at 排序取会话技能是真实用法），但 0005 只建了另外两个索引，
模型元数据说谎。这里补迁移与模型对齐，而不是删模型的 index=True。

约定：
- 索引名统一 ix_<table>_<column>，与 SQLAlchemy 对 index=True 的自动命名一致
  （降级后重建/对比不会因为名字对不上而漂移）；
- 表不存在时跳过：迁移会跑在"只有部分业务表"的库上；索引已存在时也跳过（幂等）；
- 降级逐条删除本迁移建过的索引；缺表、缺索引同样跳过而不是报错。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_fk_indexes"
down_revision: str | Sequence[str] | None = "0019_conversation_memory_off"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 29 个"外键列没有前导索引"的 (表, 列)，逐列已按真实迁移库复核（D7 清单）。
_FK_COLUMNS: tuple[tuple[str, str], ...] = (
    ("apply_queue_item", "resume_id"),
    ("apply_task_item", "resume_id"),
    ("application_track", "resume_id"),
    ("award", "profile_id"),
    ("campus_experience", "profile_id"),
    ("drill_session", "job_id"),
    ("education", "profile_id"),
    ("experience", "profile_id"),
    ("interview_review_record", "resume_id"),
    ("knowledge_entry", "job_id"),
    ("project", "profile_id"),
    ("question_bank_record", "resume_id"),
    ("referral", "track_id"),
    ("reminder", "resume_id"),
    ("reminder", "track_id"),
    ("resume_block_source", "source_revision_id"),
    ("resume_delivery_record", "track_id"),
    ("resume_generate_task", "resume_id"),
    ("resume_phrase", "source_claim_id"),
    ("resume_phrase", "source_resume_id"),
    ("resume_record", "parent_revision_id"),
    ("resume_review_annotation", "document_version_id"),
    ("resume_variant", "base_version_id"),
    ("resume_variant", "job_id"),
    ("resume_variant", "last_synced_version_id"),
    ("resume_version", "job_id"),
    ("resume_version", "parent_version_id"),
    ("share_package", "job_id"),
    ("skill", "profile_id"),
)

# 模型声明 index=True、但 0005 没建的那一条（漂移项）。
_DRIFT_COLUMNS: tuple[tuple[str, str], ...] = (("assistant_conversation_skill", "created_at"),)

_INDEXED_COLUMNS: tuple[tuple[str, str], ...] = _FK_COLUMNS + _DRIFT_COLUMNS


def _index_name(table: str, column: str) -> str:
    """与 SQLAlchemy 对 Column(index=True) 的默认命名保持逐字一致。"""
    return f"ix_{table}_{column}"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    """逐列建索引；表不存在或索引已存在则跳过。"""
    tables = _table_names()
    for table, column in _INDEXED_COLUMNS:
        if table not in tables:
            continue
        name = _index_name(table, column)
        if name in _index_names(table):
            continue
        op.create_index(name, table, [column])


def downgrade() -> None:
    """严格反序删除本迁移建的索引；缺表/缺索引跳过。"""
    tables = _table_names()
    for table, column in reversed(_INDEXED_COLUMNS):
        if table not in tables:
            continue
        name = _index_name(table, column)
        if name not in _index_names(table):
            continue
        op.drop_index(name, table_name=table)

# SPDX-License-Identifier: Apache-2.0
"""0029：外部简历可在线改字（#5）——``external_resume_revision`` 表 + ``original_file_id``。

两件事同批，因为它们描述同一次语义变更：**编辑不再覆盖原件**。

1. ``external_resume.original_file_id``：首次上传那份文件的登记。
   老数据在升级时回填成 ``file_id``（升级前每个 ``file_id`` 就是原件，回填后
   "回到原件"对所有既有行立刻可用，不会出现"老简历没有原件"的半截状态）。
2. ``external_resume_revision``：一行 = 一个版本快照（指向哪个 ``user_file``、
   正文多长、有没有文字、来源 upload/edit/restore）。``source`` 用 ``String(16)``
   而不是枚举：与项目里其它 ``*_STATUSES`` 一样由服务层收窄，避免 SQLite 上
   改枚举要重建表。

**与 ``external_resume`` 的关系是 CASCADE**：简历被彻底删除（清空回收站）时历史快照
一起删——快照离开简历没有意义。``file_id`` 两列都**没有 ondelete**：``user_file`` 是
内容寻址的共享登记，物理文件永不随简历删除而消失（见 ``models/external_resume.py``）。

升级与降级都幂等：表 / 列已存在则跳过；``external_resume`` 表不存在（只有部分业务表的库）
直接返回，不建悬挂外键。降级删表 + 删列后，再升级能按原样建回来。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_external_resume_revision"
down_revision: str | Sequence[str] | None = "0028_reminder_occurrence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RESUME = "external_resume"
_TABLE = "external_resume_revision"
_ORIGINAL_COLUMN = "original_file_id"
_RESUME_INDEX = f"ix_{_TABLE}_resume_id"
_FILE_INDEX = f"ix_{_TABLE}_file_id"
_ORIGINAL_INDEX = f"ix_{_RESUME}_{_ORIGINAL_COLUMN}"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_original_file_id() -> None:
    """加列 + 回填 + 建索引（列已存在时只补索引，回填不重复跑）。"""
    columns = _column_names(_RESUME)
    if _ORIGINAL_COLUMN not in columns:
        op.add_column(_RESUME, sa.Column(_ORIGINAL_COLUMN, sa.Integer(), nullable=True))
        # 回填：升级前 file_id 就是原件，所以"原件"对既有行恒等于当时的 file_id。
        op.execute(
            sa.text(
                f"UPDATE {_RESUME} SET {_ORIGINAL_COLUMN} = file_id "
                f"WHERE {_ORIGINAL_COLUMN} IS NULL"
            )
        )
    if _ORIGINAL_INDEX not in _index_names(_RESUME):
        op.create_index(_ORIGINAL_INDEX, _RESUME, [_ORIGINAL_COLUMN])


def _create_revision_table() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "resume_id",
            sa.Integer(),
            sa.ForeignKey(f"{_RESUME}.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            sa.Integer(),
            sa.ForeignKey("user_file.id"),
            nullable=False,
        ),
        sa.Column("text_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_text", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="upload"),
    )
    op.create_index(_RESUME_INDEX, _TABLE, ["resume_id"])
    op.create_index(_FILE_INDEX, _TABLE, ["file_id"])


def _backfill_revisions() -> None:
    """给既有外部简历补一条 ``source=upload`` 的历史版本。

    升级前每个 ``file_id`` 就是原件，所以补出来的第一版与"上传即一版"的新语义逐字等价：
    历史列表一打开就是完整的，不需要读侧再为"升级前的老行"写一条补录逻辑。
    已存在版本的行跳过（幂等）。
    """
    op.execute(
        sa.text(
            f"INSERT INTO {_TABLE} (resume_id, file_id, text_chars, has_text, created_at, source) "
            f"SELECT id, file_id, COALESCE(text_chars, 0), "
            f"CASE WHEN text IS NOT NULL AND TRIM(text) <> '' THEN 1 ELSE 0 END, "
            f"COALESCE(created_at, CURRENT_TIMESTAMP), 'upload' "
            f"FROM {_RESUME} "
            f"WHERE id NOT IN (SELECT resume_id FROM {_TABLE})"
        )
    )


def upgrade() -> None:
    """建历史版本表 + 给外部简历补 ``original_file_id``（已存在则跳过）。"""
    tables = _table_names()
    if _RESUME not in tables:
        # 只有部分业务表的库：不建悬挂外键，直接返回。
        return
    _add_original_file_id()
    if _TABLE not in tables:
        _create_revision_table()
    _backfill_revisions()


def downgrade() -> None:
    """删历史版本表 + 删 ``original_file_id``（结构回退即丢失版本链，这是回退的代价）。"""
    tables = _table_names()
    if _TABLE in tables:
        existing = _index_names(_TABLE)
        for index_name in (_FILE_INDEX, _RESUME_INDEX):
            if index_name in existing:
                op.drop_index(index_name, table_name=_TABLE)
        op.drop_table(_TABLE)
    if _RESUME in tables and _ORIGINAL_COLUMN in _column_names(_RESUME):
        if _ORIGINAL_INDEX in _index_names(_RESUME):
            op.drop_index(_ORIGINAL_INDEX, table_name=_RESUME)
        with op.batch_alter_table(_RESUME) as batch:
            batch.drop_column(_ORIGINAL_COLUMN)

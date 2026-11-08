# SPDX-License-Identifier: Apache-2.0
"""0008：求职偏好档——新建 job_preference。

期二的数据层（T10）。一行 = 一次确认写入的完整取值（"杭州、上海；别写赋能"落成
城市 + 禁用词两行，不是逐词多行）——这样"一键撤销"撤的是一次确认，而不是一个词。

两个关键设计都落在这张表的约束里：

-  **版本状态与删除分开**：state 三档（active / superseded / undone）；deleted_at
   只表示"用户删了它"，进回收站/从回收站恢复的判据不变。若让 deleted_at 兼作
   非当前版本，每改一次偏好就往回收站扔一条，回收站（全库最不能出错的一层）会立刻
   失真。
-  **活动行唯一用 partial unique index**：只约束 state='active' AND
   deleted_at IS NULL 的行，所以"旧版本 superseded"与"回收站里的行"都能与活动行
   并存，而同 dataset_key + kind 的活动行永远只有一条。恢复撞上活动行时由
   services/trash.py 的 RestoreConflict 翻译成 409，不让 IntegrityError 变成 500。

kind 的 12 类闭集目录与逐 kind 值校验器**在代码里**（services/job_preference_catalog），
不落库也不进本迁移；本表只存协议值。downgrade 反序删索引与表，表不存在时跳过。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_job_preference"
down_revision: str | Sequence[str] | None = "0007_delivery_receipt"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "job_preference"
_PREF_ID_UNIQUE = "uq_job_preference_pref_id"
_DATASET_INDEX = "ix_job_preference_dataset_key"
_ACTIVE_KIND_INDEX = "ux_job_preference_active_kind"
_KIND_STATE_INDEX = "ix_job_preference_kind_state"
_VALUE_KIND_CHECK = "ck_job_preference_value_kind"
_SOURCE_CHECK = "ck_job_preference_source"
_STATE_CHECK = "ck_job_preference_state"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    """建偏好表（含三个 CHECK、唯一约束与三个索引）；表已存在则跳过。"""
    if _TABLE in _table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("pref_id", sa.String(length=32), nullable=False),
        sa.Column("dataset_key", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=48), nullable=False),
        sa.Column("value_kind", sa.String(length=8), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("value_digest", sa.String(length=64), nullable=False),
        sa.Column("value_schema", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("source_proposal_id", sa.String(length=32), nullable=True),
        sa.Column("source_message_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="active"),
        # 只表示"用户删了它"，不兼作版本状态（见模块注释）。
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("pref_id", name=_PREF_ID_UNIQUE),
        sa.CheckConstraint("value_kind IN ('list','scalar')", name=_VALUE_KIND_CHECK),
        sa.CheckConstraint(
            "source IN ('user_stated','user_edited','imported')",
            name=_SOURCE_CHECK,
        ),
        sa.CheckConstraint(
            "state IN ('active','superseded','undone')",
            name=_STATE_CHECK,
        ),
    )
    op.create_index(_DATASET_INDEX, _TABLE, ["dataset_key"], unique=False)
    op.create_index(
        _ACTIVE_KIND_INDEX,
        _TABLE,
        ["dataset_key", "kind"],
        unique=True,
        sqlite_where=sa.text("state = 'active' AND deleted_at IS NULL"),
    )
    op.create_index(_KIND_STATE_INDEX, _TABLE, ["dataset_key", "kind", "state"], unique=False)


def downgrade() -> None:
    """严格反序：先删三个索引，再删表；表不存在则跳过。"""
    if _TABLE not in _table_names():
        return
    existing = _index_names(_TABLE)
    if _KIND_STATE_INDEX in existing:
        op.drop_index(_KIND_STATE_INDEX, table_name=_TABLE)
    if _ACTIVE_KIND_INDEX in existing:
        op.drop_index(_ACTIVE_KIND_INDEX, table_name=_TABLE)
    if _DATASET_INDEX in existing:
        op.drop_index(_DATASET_INDEX, table_name=_TABLE)
    op.drop_table(_TABLE)

# SPDX-License-Identifier: Apache-2.0
"""0066：模拟面试关联简历 + 记录有效面试时长。

**只加列，不加表、不删任何东西**（旧备份仍可导入）：

- ``resume_id`` / ``resume_title``：真实面试里面试官只拿得到"候选人提交的那份简历"与
  "他招聘的那个岗位的 JD"，所以面试需要关联到具体的一份简历（快照保存标题，简历被删后
  历史记录仍能说清当时面的是哪份）。列可空：0066 之前的会话没有关联简历，强制非空会
  让历史库升级失败。
- ``duration_seconds``：累计"有效面试时长"（秒）。界面在候选人点「准备好了」之后才开始
  计时、中途离开会暂停，所以它是会话自己累计的值而不是 ``created_at`` 差值。

**升级安全**：``interview_session`` 表不存在时直接返回（迁移链也会跑在只有部分业务表的
历史库上）。加列与建索引都先检查是否已存在，重复执行不会报错。

**downgrade 完整可逆**：SQLite 删列走 ``batch_alter_table``（重建表），索引先单独删掉
再删列；三列依次移除后表结构与升级前一致。

Revision ID: 0066_interview_link_resume_duration
Revises: 0065_snapshot_dangling_refs
Create Date: 2026-10-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0066_interview_link_resume_duration"
down_revision: str | Sequence[str] | None = "0065_snapshot_dangling_refs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "interview_session"
_RESUME_INDEX = "ix_interview_session_resume_id"
# (列名, 建列语句)：三列都允许为空/有默认值，历史行升级后立刻可读。
_COLUMNS: tuple[tuple[str, sa.Column], ...] = (
    (
        "resume_id",
        sa.Column("resume_id", sa.Integer(), nullable=True),
    ),
    (
        "resume_title",
        sa.Column("resume_title", sa.String(length=256), nullable=True, server_default=""),
    ),
    (
        "duration_seconds",
        sa.Column("duration_seconds", sa.Integer(), nullable=True, server_default="0"),
    ),
)


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(_TABLE)}


def upgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        # 部分历史库还没有面试表（0066 之前）：没有可补的列。
        return
    existing = _columns()
    for name, column in _COLUMNS:
        if name not in existing:
            op.add_column(_TABLE, column)
    # 外键与索引只在缺的时候补：SQLite 的 ALTER TABLE 不支持 ADD CONSTRAINT，
    # 所以外键只在建表（新库 create_all）时出现，历史库靠 ORM 层的逻辑约束兜底。
    indexes = {index["name"] for index in _inspector().get_indexes(_TABLE)}
    if _RESUME_INDEX not in indexes:
        op.create_index(_RESUME_INDEX, _TABLE, ["resume_id"], unique=False)


def downgrade() -> None:
    if _TABLE not in set(_inspector().get_table_names()):
        return
    existing = _columns()
    # 索引必须先删：batch 模式重建表时，遗留索引会指向即将消失的列。
    indexes = {index["name"] for index in _inspector().get_indexes(_TABLE)}
    if _RESUME_INDEX in indexes:
        op.drop_index(_RESUME_INDEX, table_name=_TABLE)
    with op.batch_alter_table(_TABLE) as batch:
        for name, _column in reversed(_COLUMNS):
            if name in existing:
                batch.drop_column(name)

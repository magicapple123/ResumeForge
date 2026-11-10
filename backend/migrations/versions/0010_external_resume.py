# SPDX-License-Identifier: Apache-2.0
"""0010：外部简历只读快照——新建 `external_resume`。

问题清单 `21 的数据层：用户在别处生成的简历（PDF / docx / txt / md）可以在简历中心
留档、预览原件、做**文本级**检查，并复用于模拟面试。它**不是** `resume_record`：

- 结构化文档模型 v2 要求条目 / 字段 / 纸面位置 / 版式，PDF 与 docx 没有这些语义，
  硬还原必然错位，而用户会期待"能编辑"；
- `resume_record.content` 有近 90 处读取路径，往里面塞非文档内容等于给每条路径
  各加一道守卫。

所以独立成表，且只存一张轻量快照：文件登记在既有 `user_file`（sha256 去重、
`user_files/` 已是备份资产类别），正文在上传时本地提取后落 `text` / `text_chars`。

三条不变量（服务层与界面都依赖它们）：

1. `deleted_at` 只表达"用户删了它"（进回收站）；删除与彻底删除都**不删物理文件**
   ——同一份内容可能被资料照片 / 聊天附件等其它入口引用；
2. `file_id` / `job_id` 都是逻辑引用：`job_id` 在岗位被彻底删除时 `SET NULL`
   （`ondelete="SET NULL"`，与其余引用岗位的表同一口径）；
3. 扫描件 PDF 不在这里调用视觉模型：`text` 允许为空串，由接口返回警告。

downgrade 反序删索引与表；表不存在时跳过（迁移会跑在只有部分业务表的候选库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_external_resume"
down_revision: str | Sequence[str] | None = "0009_claim_entry_ids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "external_resume"
_FILE_INDEX = "ix_external_resume_file_id"
_JOB_INDEX = "ix_external_resume_job_id"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    """建外部简历表（两个索引 + 两个外键）；表已存在则跳过。"""
    if _TABLE in _table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        # 物理文件登记：副本行不随外部简历删除而消失，所以不带 ondelete。
        sa.Column("file_id", sa.Integer(), sa.ForeignKey("user_file.id"), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("text_chars", sa.Integer(), nullable=False, server_default="0"),
        # 可选关联岗位：岗位彻底删除时置空（与其余引用岗位的表同一口径）。
        sa.Column(
            "job_id",
            sa.Integer(),
            sa.ForeignKey("job.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(_FILE_INDEX, _TABLE, ["file_id"], unique=False)
    op.create_index(_JOB_INDEX, _TABLE, ["job_id"], unique=False)


def downgrade() -> None:
    """反序删索引与表；不存在则跳过。"""
    if _TABLE not in _table_names():
        return
    indexes = _index_names(_TABLE)
    if _JOB_INDEX in indexes:
        op.drop_index(_JOB_INDEX, table_name=_TABLE)
    if _FILE_INDEX in indexes:
        op.drop_index(_FILE_INDEX, table_name=_TABLE)
    op.drop_table(_TABLE)

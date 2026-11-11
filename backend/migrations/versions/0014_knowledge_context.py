# SPDX-License-Identifier: Apache-2.0
"""0014：知识库从「笔记列表」升级为「可被全站引用的底座」——五列一次加完（#29C/#29D/#29E）。

问题 #29 的现状：knowledge_entry 只有 title/category/tags/content/source 与时间戳——
没有「我为什么存这条」，没有可关联的公司/岗位，没有摘要与要点。于是它只能是
"一个带分类的笔记列表"，无法被面试页、岗位详情和 RAG 检索当作证据源使用。

本迁移一次加五列，**不加多对多表**（单用户场景两个可空列足够，多对多会把最简单的
查询变复杂）：

1. reason（<=120 字）：「我为什么存这条」——调研结论里这句话比正文更值钱；
2. company（可空、带索引）：按公司筛选、面试页「这家公司面经 N 条」；
3. job_id（可空外键，ON DELETE SET NULL）：岗位彻底删除后条目仍可读，
   与其余引用岗位的表同一口径（快照字段留在条目自身）；
4. summary（<=300 字）：卡片列表直接显示摘要，RAG 命中优先返回摘要省 token；
5. key_points（JSON 数组）：蒸馏后的要点，同样服务列表与检索。

三条不变量：
- 五列对旧行都有服务端默认值（空串 / 空数组），升级不改变任何已有条目的显示；
- job_id 可空且不做级联：知识是用户的，不跟着一条岗位记录被删；
- 降级只删这五列（含 company 索引），不碰正文与其余列；列/索引不存在时跳过。

分类改为「建议而非约束」（#29G）不需要迁移：category 本来就是 String，空串即未分类。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_knowledge_context"
down_revision: str | Sequence[str] | None = "0013_favorite_timestamps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "knowledge_entry"
_JOB_TABLE = "job"
_REASON = "reason"
_COMPANY = "company"
_JOB_ID = "job_id"
_SUMMARY = "summary"
_KEY_POINTS = "key_points"
_COMPANY_INDEX = "ix_knowledge_entry_company"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _index_names(table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_column_if_missing(
    table: str, column: sa.Column, *, inline_references: bool = False
) -> None:
    """加一列；列已存在则跳过（幂等：create_all 建过的库 / 重跑迁移都不会炸）。

    SQLite 的 ALTER TABLE 不支持事后加约束，带外键的列只能把 REFERENCES 写在
    ADD COLUMN 语句里（SQLite 允许该写法，前提是列可空且默认 NULL）——这正是
    Alembic 1.20 的 inline_references 开关；不开它 Alembic 会先加列、再单独
    add_constraint，在 SQLite 上直接抛 NotImplementedError。
    """
    if table not in _table_names():
        return
    if column.name in _column_names(table):
        return
    if inline_references:
        op.add_column(table, column, inline_references=True)
    else:
        op.add_column(table, column)


def _create_company_index_if_missing() -> None:
    """company 筛选的索引；索引已存在则跳过。"""
    if _TABLE not in _table_names() or _COMPANY not in _column_names(_TABLE):
        return
    if _COMPANY_INDEX in _index_names(_TABLE):
        return
    op.create_index(_COMPANY_INDEX, _TABLE, [_COMPANY])


def upgrade() -> None:
    """加五列（reason/company/job_id/summary/key_points）与 company 索引；已存在则跳过。"""
    if _TABLE not in _table_names():
        return
    # 服务端默认值让老行有一个确定的初始形态：空串表示"没写"，空数组表示"没有要点"。
    _add_column_if_missing(
        _TABLE, sa.Column(_REASON, sa.String(length=120), nullable=False, server_default="")
    )
    _add_column_if_missing(
        _TABLE, sa.Column(_COMPANY, sa.String(length=128), nullable=False, server_default="")
    )
    _add_column_if_missing(
        _TABLE,
        sa.Column(
            _JOB_ID,
            sa.Integer(),
            # SET NULL 而不是 CASCADE：岗位删了，用户写的知识不该跟着消失。
            sa.ForeignKey("job.id", ondelete="SET NULL"),
            nullable=True,
        ),
        inline_references=True,
    )
    _add_column_if_missing(
        _TABLE, sa.Column(_SUMMARY, sa.String(length=300), nullable=False, server_default="")
    )
    _add_column_if_missing(
        _TABLE,
        sa.Column(_KEY_POINTS, sa.JSON(), nullable=False, server_default="[]"),
    )
    _create_company_index_if_missing()


def downgrade() -> None:
    """删 company 索引与五列；表/列/索引不存在则跳过（正文与其余列原样保留）。"""
    if _TABLE not in _table_names():
        return
    if _COMPANY_INDEX in _index_names(_TABLE):
        op.drop_index(_COMPANY_INDEX, table_name=_TABLE)
    for column in (_KEY_POINTS, _SUMMARY, _JOB_ID, _COMPANY, _REASON):
        if column in _column_names(_TABLE):
            op.drop_column(_TABLE, column)

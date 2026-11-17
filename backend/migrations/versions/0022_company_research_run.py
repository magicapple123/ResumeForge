# SPDX-License-Identifier: Apache-2.0
"""0022：公司调研历史 ``company_research_run``（T07）。

知识库对同一家公司是**原地覆盖**（``company + source`` 去重），语义不变；本迁移只新增
一张"按运行追加"的历史表，让用户能回看每次调研的简报、来源与卡片。

结构上的三条取舍：

1. **快照而非引用**：``brief_markdown`` / ``sources`` / ``cards`` 各存一份，知识库条目
   被改被删都不影响历史——历史要回答的是"当时看到了什么"；
2. **两个外键都是 ``SET NULL``**：知识条目、岗位被彻底删除后历史仍可读，不能因为一条
   知识条目删了就丢整段历史（``knowledge_entry_id`` 只是"这次写了哪条"的指路牌）；
3. **复合索引 ``(company, created_at)`` + ``(job_id, created_at)``**：历史列表的两个入口
   正好是"按公司"与"按岗位"，两者都按时间倒序翻页；``created_at`` 另有单列索引给
   "清空全部"与体积统计。

升级/降级都要能跑：表不存在时跳过而不是报错（迁移会跑在"只有部分业务表"的库上）。
列定义与 ``models/company_research.py`` 逐字一致（含 ``server_default`` 与索引名）——
``tests/test_model_migration_index_parity.py`` 会双向比对。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_company_research_run"
down_revision: str | Sequence[str] | None = "0021_conversation_persona"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "company_research_run"
_KNOWLEDGE_TABLE = "knowledge_entry"
_JOB_TABLE = "job"

_INDEX_COMPANY = f"ix_{_TABLE}_company_created_at"
_INDEX_JOB = f"ix_{_TABLE}_job_id_created_at"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """建历史表 + 四个索引；表已存在则跳过。

    两张被引用的业务表（``knowledge_entry`` / ``job``）缺失时不建表：SQLite 允许悬空外键，
    但那样建出来的库在后续升级里会成为"有历史表却没有知识库"的怪状态。真实库两者都在。
    """
    tables = _table_names()
    if _TABLE in tables or _KNOWLEDGE_TABLE not in tables or _JOB_TABLE not in tables:
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("company_raw", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("role", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("jd_excerpt", sa.Text(), nullable=False, server_default=""),
        sa.Column("jd_hash", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("deep", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("brief_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("sources", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("cards", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("search_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "knowledge_entry_id",
            sa.Integer(),
            sa.ForeignKey(f"{_KNOWLEDGE_TABLE}.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "job_id",
            sa.Integer(),
            sa.ForeignKey(f"{_JOB_TABLE}.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(f"ix_{_TABLE}_company", _TABLE, ["company"])
    op.create_index(f"ix_{_TABLE}_created_at", _TABLE, ["created_at"])
    op.create_index(_INDEX_COMPANY, _TABLE, ["company", "created_at"])
    op.create_index(_INDEX_JOB, _TABLE, ["job_id", "created_at"])


def downgrade() -> None:
    """删表（索引随表一起消失）；表不存在则跳过。"""
    if _TABLE not in _table_names():
        return
    # 索引随 DROP TABLE 消失，但显式删能保证"只有索引没表"的半成品库也能降级。
    for index_name in (
        _INDEX_JOB,
        _INDEX_COMPANY,
        f"ix_{_TABLE}_created_at",
        f"ix_{_TABLE}_company",
    ):
        existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(_TABLE)}
        if index_name in existing:
            op.drop_index(index_name, table_name=_TABLE)
    op.drop_table(_TABLE)

# SPDX-License-Identifier: Apache-2.0
"""0012：岗位采样流水——新建 job_seen，并给 job 加 ghost_ignored。

问题清单 #15（15A 僵尸岗雷达 / 15B JD 变更监控）共用这一张表。改动前的采集器把"已知
岗位"直接 ``continue`` 掉（``services/apply/collector.py``），**重采不留痕**：一条岗位
被采到过几次、薪资改没改、HR 多久没上线、JD 有没有变，全都没有落点；``Job`` 也只有
``created_at`` 一个时间戳，既没有"最近一次见到"，也没有"见过几次"。

三条不变量（写在约束里，不写在注释里）：

1. **一次采集一条**：这是**流水表**，不是快照表。同一岗位被采 N 次就有 N 行——15A 的
   "复采次数 / 薪资是否变过 / HR 是否始终不活跃"与 15B 的"JD 前后对比"都要求序列，
   合并成"最近一次"等于把证据删掉。``job_id`` **可空**：列表页新冒出来的岗位还没导入
   岗位广场，也必须留一条（"采过但没导入"同样有生命周期）。
2. **岗位彻底删除后采样行不消失**：``job_id`` 用 ``ON DELETE SET NULL``，标题 / 公司 /
   链接与当时的价格、HR 活跃度都留在行上。历史是用户的东西，不该跟着一条记录被删。
3. **``description_text`` 只服务 before→after**：只存前 2000 字，够界面展示"改了什么"，
   不试图在历史表里再存一份完整 JD（那会让这张表按采集次数成倍膨胀）。

``job.ghost_ignored`` 是 15A 的"我认了"开关：置真后 14A 体检不再报这条岗位的僵尸提示，
但采集侧照常记采样——用户点"忽略"是关掉提示，不是要求我们停止记录历史。

升级/降级都要能跑：表不存在时跳过建表、列不存在时跳过加列；降级只删本迁移建的东西
（两个索引 + 一张表 + 一列），不碰 ``job`` 的其余内容，也不删任何采样之外的数据。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_job_seen"
down_revision: str | Sequence[str] | None = "0011_conversation_compaction"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "job_seen"
_JOB_TABLE = "job"
_JOB_COLUMN = "ghost_ignored"
_JOB_SEEN_AT_INDEX = "ix_job_seen_job_id_seen_at"
_SOURCE_INDEX = "ix_job_seen_source_url_company"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """建采样表 + 给 job 加忽略开关；表/列已存在则跳过。"""
    if _TABLE not in _table_names():
        op.create_table(
            _TABLE,
            sa.Column("id", sa.Integer(), primary_key=True),
            # SET NULL 而不是 CASCADE：岗位删了，采样行仍是"这条岗位曾经存在"的唯一凭据。
            sa.Column(
                "job_id",
                sa.Integer(),
                sa.ForeignKey("job.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source_url", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("title", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("company", sa.String(length=128), nullable=False, server_default=""),
            # 采集任务 id（apply_task.id）。刻意**不做外键**：删批次不该被这条流水挡住，
            # 而且历史采样要能在批次被清理之后仍然说清"哪一轮见到的"。
            sa.Column("run_id", sa.Integer(), nullable=True),
            sa.Column("seen_at", sa.DateTime(), nullable=False),
            sa.Column("salary_text", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("hr_active", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("hr_active_time", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("description_hash", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("description_text", sa.Text(), nullable=False, server_default=""),
        )
        # 两条组合索引就是两种取数方式：按岗位取整条序列（15A/15B），按"链接 + 公司"
        # 反查那些还没入库的采样（未来"这条岗位我见过多少次"）。单列索引会多占一份空间，
        # 而这两个组合索引都以单列前缀打头，单列查询照样走得上。
        op.create_index(_JOB_SEEN_AT_INDEX, _TABLE, ["job_id", "seen_at"])
        op.create_index(_SOURCE_INDEX, _TABLE, ["source_url", "company"])
    if _JOB_TABLE in _table_names() and _JOB_COLUMN not in _column_names(_JOB_TABLE):
        # server_default 是必须的：SQLite 给非空列加列时，已有行要靠它取值。
        op.add_column(
            _JOB_TABLE,
            sa.Column(
                _JOB_COLUMN,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


def downgrade() -> None:
    """删采样表与忽略开关；表/列不存在则跳过（不碰 job 的其余列）。"""
    if _TABLE in _table_names():
        # 索引随表一起消失，但仍显式删一遍：将来若有人把索引改成独立对象，
        # 这里不会留下一个指向已删表的孤儿索引。
        for index_name in (_SOURCE_INDEX, _JOB_SEEN_AT_INDEX):
            op.drop_index(index_name, table_name=_TABLE)
        op.drop_table(_TABLE)
    if _JOB_TABLE in _table_names() and _JOB_COLUMN in _column_names(_JOB_TABLE):
        op.drop_column(_JOB_TABLE, _JOB_COLUMN)

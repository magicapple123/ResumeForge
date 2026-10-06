"""网申专用资料字段；并顺手删掉官网采集留下的三张空表。

## 为什么加这些列

公司自建的网申系统（腾讯校招那类）把个人信息拆得很细：国家/地区、证件类型与号码、
手机区号、微信号、完整出生日期、政治面貌、籍贯、家庭信息、期望薪资。这些在既有
``user_profile`` 里一个都没有，导致填表时一半的必填项无处取数。

学历也被拆成三个独立下拉（层次 / 学习形式 / 学位类型），所以 ``education`` 补两列——
``degree`` 原本只覆盖"本科/硕士/博士"这一维。

**只加列、不改既有列**：旧备份迁到当前 head 时会自动补上这些列（`server_default` 保证
存量行有值），不会因为"缺少列"或表集合变化被拒收。

## 为什么同时删三张表

``official_site`` / ``official_collect_run`` / ``official_discovery_search`` 是「官网采集」与
「按岗位找公司」两个已移除功能的遗留。功能删掉时**故意留了表和模型**，理由是删表要发迁移、
而迁移不可逆——为空表单独付这个代价不划算，所以约定"下次本来就要加迁移时一并做"。
这次就是那个"下一次"（清单见 ``AGENTS.md``，本迁移落地后那一节已删除）。

**删表不影响旧备份导入**：导入流程是先把备份里的库升到当前 head
（``data_backup._upgrade_candidate``），**之后**才校验表集合，所以备份里的这三张表会被
本迁移 drop 掉，表集合自然与代码一致。（这一点曾经被误判成"删表会让旧备份拒收"，是错的。）

Revision ID: 0025_web_form_fields
Revises: 0024_official_discovery_history
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_web_form_fields"
down_revision: str | Sequence[str] | None = "0024_official_discovery_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 新增列：(表名, 列名, 类型, server_default)。顺序即定义顺序，方便与模型对照。
NEW_COLUMNS: tuple[tuple[str, str, sa.types.TypeEngine, str], ...] = (
    ("user_profile", "wechat", sa.String(length=64), ""),
    ("user_profile", "birth_date", sa.String(length=16), ""),
    ("user_profile", "id_type", sa.String(length=32), ""),
    ("user_profile", "id_number", sa.String(length=64), ""),
    ("user_profile", "country_region", sa.String(length=64), ""),
    ("user_profile", "native_place", sa.String(length=64), ""),
    ("user_profile", "political_status", sa.String(length=32), ""),
    # 默认 +86：既有资料全部是国内号码，补列时存量行拿到这个值比拿到空串更有用。
    ("user_profile", "phone_country_code", sa.String(length=8), "+86"),
    ("user_profile", "family_info", sa.Text(), ""),
    ("user_profile", "expected_salary", sa.String(length=64), ""),
    ("education", "study_mode", sa.String(length=32), ""),
    ("education", "degree_type", sa.String(length=32), ""),
)


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    # ===== 一、网申字段 =====
    # 逐列判存在再添加：迁移链会跑在"只有部分业务表/列"的历史库上（例如从很早的备份升上来，
    # 或某个中间版本被手工改过），直接 add_column 会因重复列报错。
    for table, column, column_type, server_default in NEW_COLUMNS:
        if table not in tables:
            continue
        if column in _columns_of(bind, table):
            continue
        op.add_column(
            table,
            sa.Column(column, column_type, nullable=False, server_default=server_default),
        )

    # ===== 二、删掉已移除功能的遗留表 =====
    #
    # 顺序要紧：official_collect_run 有指向 official_site 的外键，必须**先删引用方**，
    # 否则在有数据的库上会因外键约束失败。（official_discovery_search 无外键，先删它只是
    # 为了让"没有依赖关系"这件事一眼可见。）
    for table in ("official_discovery_search", "official_collect_run", "official_site"):
        if table in tables:
            op.drop_table(table)


def downgrade() -> None:
    """退回上一版：建回三张表，并去掉本次新增的列。

    三张表的定义**逐字**来自 ``0022_official_site_collect`` 与
    ``0024_official_discovery_history``——列顺序、``server_default``、索引名、外键的
    ``ondelete`` 都必须一致，否则"降级"只是看起来成功了。
    """
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    # ===== 一、建回三张表（被依赖方先建）=====
    if "official_site" not in tables:
        op.create_table(
            "official_site",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("company", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("homepage_url", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("careers_url", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("source_kind", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("endpoint", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("params", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("confidence", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("probe_evidence", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("recipe", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("recipe_version", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("robots_allowed", sa.Boolean(), nullable=True),
            sa.Column("robots_detail", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("crawl_delay_seconds", sa.Float(), nullable=True),
            sa.Column("min_interval_seconds", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("max_per_hour", sa.Integer(), nullable=False, server_default="120"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("last_probed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_official_site_created_at", "official_site", ["created_at"])

    if "official_collect_run" not in tables:
        op.create_table(
            "official_collect_run",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("site_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
            sa.Column("pages", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("collected", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("stored", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("detail_missing", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_hint", sa.Integer(), nullable=True),
            sa.Column("blocks", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("verdict", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("evidence", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("headline", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("missing", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("reconcile_detail", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("llm_calls", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("llm_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("finished_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["site_id"], ["official_site.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_official_collect_run_site_id", "official_collect_run", ["site_id"])
        op.create_index("ix_official_collect_run_status", "official_collect_run", ["status"])
        op.create_index(
            "ix_official_collect_run_started_at", "official_collect_run", ["started_at"]
        )

    if "official_discovery_search" not in tables:
        op.create_table(
            "official_discovery_search",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("keywords", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("city", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("queries", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("candidates", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("detail", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_official_discovery_search_created_at", "official_discovery_search", ["created_at"]
        )

    # ===== 二、去掉本次新增的列（逆序，与 upgrade 对称）=====
    tables = set(sa.inspect(bind).get_table_names())
    for table, column, _column_type, _server_default in reversed(NEW_COLUMNS):
        if table not in tables:
            continue
        if column not in _columns_of(bind, table):
            continue
        op.drop_column(table, column)

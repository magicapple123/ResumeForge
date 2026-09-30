"""大模型配置记录加「思考模式」三列——开关、强度档位、参数形态。

## 为什么在这张表上

思考设置跟着**命名配置记录**走（每条记录 = 一套端点 + 端点专属的参数），因为它跟
``api_style`` 一样是"这个服务商怎么说话"的一部分：换一条记录就该换一套思考写法。
当前生效的那份配置存在 ``app_setting.llm_config`` 里，那是 JSON，**不需要迁移**。

## 存量行为什么是关

``server_default`` 取 ``0``/``''``/``'auto'``：存量记录一律"不开启思考"，
与加这个功能之前发出去的请求体逐字节一致——默认值不能悄悄改变老用户的行为。

**只加列**：旧备份迁到 head 时自动补齐，不会因为缺列或表集合变化被拒收。

Revision ID: 0035_llm_thinking
Revises: 0034_job_match_batches
Create Date: 2026-10-01
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035_llm_thinking"
down_revision: str | Sequence[str] | None = "0034_job_match_batches"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "llm_config_record"

# 与 app/models/setting.py 的列定义一一对应（名字对不上会被 test_database 的
# "迁移后的列集合 == ORM 列集合"断言抓住）。
COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str], ...] = (
    ("thinking_enabled", sa.Boolean(), "0"),
    ("thinking_effort", sa.String(length=32), ""),
    ("thinking_style", sa.String(length=32), "auto"),
)


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    """判存在再加——迁移链也会跑在"只有部分业务表/列"的历史库上。"""
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    existing = _columns_of(bind, TABLE)
    for name, column_type, default in COLUMNS:
        if name in existing:
            continue
        op.add_column(
            TABLE,
            sa.Column(name, column_type, nullable=False, server_default=default),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if TABLE not in set(sa.inspect(bind).get_table_names()):
        return
    existing = _columns_of(bind, TABLE)
    for name, _type, _default in COLUMNS:
        if name in existing:
            op.drop_column(TABLE, name)

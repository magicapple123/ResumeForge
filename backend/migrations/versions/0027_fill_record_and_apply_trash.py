"""网申填充记录表；并给投递记录加 ``deleted_at``（两者都可进退回收站）。

## 为什么有这张表

网申填表此前"填完即忘"：表单快照只在进程内存里活 900 秒，关掉就没了。用户填完一张长表，
事后想确认"我当时到底填了什么、有几个没成"时无处可查——而那张表往往是要紧的（证件号、
手机号、亲属信息）。本表每次填充落一条：填了哪些框、认成什么字段、最终写了什么值、
成功还是失败、为什么，外加填完后页面的可读快照。

## 为什么同时给投递记录加列

投递记录本来只追加、不能删。用户要求"投递记录也能删"（单条删 + 整批删），且**删了就不计入
统计与每日上限**。加一列 ``deleted_at`` 即可走既有的回收站机制，可恢复、可彻底删除。

**只加列 + 建新表**：旧备份迁到 head 时自动补齐（``server_default`` 保证存量行有值），
不会因为"缺列"或表集合变化被拒收。

Revision ID: 0027_fill_record_and_apply_trash
Revises: 0026_form_extra_fields
Create Date: 2026-09-27
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_fill_record_and_apply_trash"
down_revision: str | Sequence[str] | None = "0026_form_extra_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "web_form_fill_record"

# 新表定义：(列名, 类型, server_default)。顺序即定义顺序，方便与模型对照。
# **非空列一律给 server_default**：否则旧备份升级时存量行拿不到值。
NEW_TABLE_COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str], ...] = (
    ("url", sa.String(length=1024), ""),
    ("page_title", sa.String(length=256), ""),
    ("items", sa.JSON(), "'[]'"),
    ("filled", sa.Integer(), "0"),
    ("unverified", sa.Integer(), "0"),
    ("failed", sa.Integer(), "0"),
    ("page_snapshot", sa.JSON(), "'[]'"),
    ("source", sa.String(length=16), "batch"),
    ("created_at", sa.DateTime(), ""),
    ("updated_at", sa.DateTime(), ""),
)

# 加列的表：(表名, 列名, 类型)。
NEW_COLUMNS: tuple[tuple[str, str, sa.types.TypeEngine], ...] = (
    ("apply_task_item", "deleted_at", sa.DateTime()),
)


def _columns_of(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


INDEX_NAME = f"ix_{TABLE}_created_at"


def _indexes_of(bind, table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    """建表 + 加列，两处都先判存在——迁移链会跑在"只有部分表/列"的历史库上。"""
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if TABLE not in tables:
        columns = [sa.Column("id", sa.Integer(), nullable=False)]
        for name, column_type, server_default in NEW_TABLE_COLUMNS:
            columns.append(
                sa.Column(
                    name,
                    column_type,
                    nullable=False,
                    server_default=sa.text(server_default) if name in ("items", "page_snapshot") else server_default,
                )
            )
        # 可空列单独加：``deleted_at`` 的 NULL 语义就是"没删"，不能给默认值。
        columns.append(sa.Column("deleted_at", sa.DateTime(), nullable=True))
        columns.append(sa.PrimaryKeyConstraint("id"))
        op.create_table(TABLE, *columns)
        op.create_index(INDEX_NAME, TABLE, ["created_at"])

    for table, column, column_type in NEW_COLUMNS:
        if table not in tables:
            continue
        if column in _columns_of(bind, table):
            continue
        # 可空、无默认：NULL 表示"这条没被删"，存量行天然拿到 NULL。
        op.add_column(table, sa.Column(column, column_type, nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    for table, column, _column_type in reversed(NEW_COLUMNS):
        if table not in tables:
            continue
        if column not in _columns_of(bind, table):
            continue
        op.drop_column(table, column)

    if TABLE in tables:
        # 索引未必在：老库可能只有表没有索引，``DROP INDEX`` 对不存在的索引会直接报错。
        if INDEX_NAME in _indexes_of(bind, TABLE):
            op.drop_index(INDEX_NAME, table_name=TABLE)
        op.drop_table(TABLE)

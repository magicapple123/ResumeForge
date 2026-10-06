"""「网申资料」表：用户专门为网申表单填的补充资料，与简历资料分开存。

## 为什么有这张表

校招网申表单问的东西**比简历多得多**：四六级具体分数（很多系统按分数自动筛，只填"已通过"
过不了）、专业排名与总人数、学号、培养方式、档案所在地与报到证抬头、紧急联系人与父母工作
单位、入党时间、身高视力、可到岗时间、是否服从调剂……这些在简历上**从不出现**，所以没有
地方录，只能每次填表时现找。

用户的要求是"这一项要跟简历资料分开，用于补充简历资料里没有的内容，专门供网申填表模块
读取，**生成简历模块默认不读这里的信息**"。所以它建**独立的表**而不是往
``user_profile`` 加列——加列的话简历生成会自动带上它们（它读整份资料），"别读"就只能在
生成侧逐列排除，那是"漏一列就静默破防"的形状。

## 表形状

键值对（``field_key`` + ``value``），字段清单由 ``services/webform/fields.py`` 定义。
**这样加字段不需要迁移**——用户要"越多越好"，固定列下每加一个字段发一次迁移不划算。

**没有 ``deleted_at``**：它是配置性资料，不进退回收站（不要了就把值清空，空值不落库）。
所以本迁移**不登记 ``trash.TRASH_SPECS``**，与 ``test_trash.py`` 的一一对应守卫不冲突。

Revision ID: 0028_web_form_profile
Revises: 0027_fill_record_and_apply_trash
Create Date: 2026-09-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_web_form_profile"
down_revision: str | Sequence[str] | None = "0027_fill_record_and_apply_trash"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "web_form_profile_entry"
INDEX_NAME = f"ix_{TABLE}_field_key"

# 新表定义：(列名, 类型, server_default)（只列带默认值的非空列）。
# **非空列一律给 server_default**：否则旧备份升级时存量行拿不到值。
NEW_TABLE_COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str], ...] = (
    ("field_key", sa.String(length=64), ""),
    ("value", sa.Text(), ""),
    ("created_at", sa.DateTime(), ""),
    ("updated_at", sa.DateTime(), ""),
)


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _indexes_of(bind, table: str) -> set[str]:
    return {index["name"] for index in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    """建表 + 建索引，两处都先判存在——迁移链会跑在"只有部分表"的历史库上。"""
    bind = op.get_bind()
    if _table_exists(bind, TABLE):
        return

    columns = [sa.Column("id", sa.Integer(), nullable=False)]
    for name, column_type, server_default in NEW_TABLE_COLUMNS:
        columns.append(
            sa.Column(name, column_type, nullable=False, server_default=server_default)
        )
    columns.append(sa.PrimaryKeyConstraint("id"))
    op.create_table(TABLE, *columns)
    op.create_index(INDEX_NAME, TABLE, ["field_key"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        return
    # 索引未必在：老库可能只有表没有索引，``DROP INDEX`` 对不存在的索引会直接报错。
    if INDEX_NAME in _indexes_of(bind, TABLE):
        op.drop_index(INDEX_NAME, table_name=TABLE)
    op.drop_table(TABLE)

"""0045：可信交付账本（PR-09）——给 ``resume_delivery_record`` 加四列。

只加列、不加表：业务表集合前后不变，旧备份没有这四列时按 NULL 读取（UI/详情
如实标注"不可还原"，不编造历史数据）。

- ``source_content_sha256``：导出前（脱敏后）源内容的 sha256，与 ``artifact_sha256``
  分开回答"存的是哪份内容"与"产出的文件是哪份"；
- ``artifact_sha256``：导出产物字节的 sha256（仅 export 路径有值）；
- ``request_params``：实际生效的导出请求参数（page_limit/watermark/redact/margin/
  include_photo 等，从实际执行的导出调用取，不是默认值）——凭它 + ``render_context``
  可以重放导出；
- ``idempotency_key``：幂等键，代表"哪一次真实投递动作"（如 ``apply_task_item:{id}``）。
  普通索引而非唯一约束：重放去重在服务层做，约束化会让历史脏数据/并发竞态直接炸迁移。

Revision ID: 0045_delivery_ledger
Revises: 0044_search_fts5
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0045_delivery_ledger"
down_revision: str | Sequence[str] | None = "0044_search_fts5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "resume_delivery_record"
INDEX = "ix_resume_delivery_record_idempotency_key"

# (列名, 列定义)。全部可空：旧行/旧备份缺列语义 = "不可还原"，不编造默认值。
_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("source_content_sha256", sa.String(length=64)),
    ("artifact_sha256", sa.String(length=64)),
    ("request_params", sa.JSON()),
    ("idempotency_key", sa.String(length=128)),
)


def _table_exists(bind, table: str) -> bool:
    return table in set(sa.inspect(bind).get_table_names())


def _column_exists(bind, table: str, column: str) -> bool:
    if not _table_exists(bind, table):
        # 反射对不存在的表抛 NoSuchTableError；帮助函数对缺失表如实返回 False。
        return False
    return column in {item["name"] for item in sa.inspect(bind).get_columns(table)}


def _index_exists(bind, index: str) -> bool:
    return index in {item["name"] for item in sa.inspect(bind).get_indexes(TABLE)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        # 表都不在（历史残缺库）：跳过而非报错——迁移链也会跑在部分表上。
        return
    for name, column_type in _COLUMNS:
        if not _column_exists(bind, TABLE, name):
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True))
    if not _index_exists(bind, INDEX):
        # 普通索引（非唯一）：重放去重由服务层按键查询实现，见模块 docstring。
        op.create_index(INDEX, TABLE, ["idempotency_key"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE):
        return
    if _index_exists(bind, INDEX):
        op.drop_index(INDEX, table_name=TABLE)
    for name, _column_type in reversed(_COLUMNS):
        if _column_exists(bind, TABLE, name):
            op.drop_column(TABLE, name)

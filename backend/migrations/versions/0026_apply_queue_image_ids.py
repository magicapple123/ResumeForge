# SPDX-License-Identifier: Apache-2.0
"""0026：投递台「招呼语附带图片」——队列上的图片引用 + 执行记录上的发图审计。

背景（台账第 10 条）：BOSS 聊天页有原生「发送图片」入口，而投递链路一直只发文本。
落点选 B：**文本确认送达之后**再补发一条图片消息——失败可隔离，重试不会重复发招呼语。

两条设计取舍，改动前请先读：

1. **只存引用，不存 data URL**。``apply_queue_item.image_ids`` 是 ``user_file.id`` 的
   JSON 数组：一张截图 base64 就是 MB 级，存进队列会让列表接口（每页 500 行）直接爆掉。
   ``server_default`` 用 ``'[]'`` 而不是 NULL：老行读出来就是"没有配图"，不需要在业务层
   到处写 ``or []``。
2. **发图结果单独成列**（``image_status`` / ``image_target`` / ``image_detail`` /
   ``image_file_ids`` / ``image_finished_at`` / ``queue_item_id``），**不复用
   ``failure_*``**：图片失败不是投递失败（文本已送达）。混进 failure_* 会让一条
   ``status=success`` 的记录出现在"按失败筛选"里，而用户真正想知道的是"图没送到"。

升级/降级都要能跑，且**表/列不存在时跳过**：迁移会跑在只有部分业务表的库上（测试库与
老库都见过这种形态），静默跳过比在这里炸掉整条升级链要好。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_apply_queue_image_ids"
down_revision: str | Sequence[str] | None = "0025_track_external_resume"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_QUEUE_TABLE = "apply_queue_item"
_ITEM_TABLE = "apply_task_item"

# （列名, 列定义）——两张表一次列清，upgrade / downgrade 各走一遍，避免漏掉某一列。
_QUEUE_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (("image_ids", sa.JSON()),)
_ITEM_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("image_ids", sa.JSON()),
    ("queue_item_id", sa.Integer()),
    ("image_status", sa.String(length=16)),
    ("image_target", sa.String(length=32)),
    ("image_detail", sa.Text()),
    ("image_file_ids", sa.JSON()),
    ("image_finished_at", sa.DateTime()),
)

# 每列的 server_default：JSON 列表用 ``'[]'``，字符串用 ``''``，可空的保持无默认。
_SEGMENT_DEFAULTS: dict[str, str | None] = {
    "image_ids": "[]",
    "image_file_ids": "[]",
    "image_status": "",
    "image_target": "",
    "image_detail": "",
}


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _add_columns(
    table: str, columns: Sequence[tuple[str, sa.types.TypeEngine]], existing: set[str]
) -> None:
    for name, type_ in columns:
        if name in existing:
            continue
        default = _SEGMENT_DEFAULTS.get(name)
        if default is not None:
            op.add_column(
                table,
                sa.Column(name, type_, nullable=False, server_default=default),
            )
        else:
            op.add_column(table, sa.Column(name, type_, nullable=True))


def upgrade() -> None:
    """加配图引用列与发图审计列（已存在则跳过）。"""
    tables = _table_names()
    if _QUEUE_TABLE in tables:
        _add_columns(_QUEUE_TABLE, _QUEUE_COLUMNS, _column_names(_QUEUE_TABLE))
    if _ITEM_TABLE in tables:
        _add_columns(_ITEM_TABLE, _ITEM_COLUMNS, _column_names(_ITEM_TABLE))


def downgrade() -> None:
    """删掉本迁移加的列（列不存在则跳过）。

    用 ``batch_alter_table``：SQLite 的 ``DROP COLUMN`` 在老版本上要走"建新表 → 拷数据 →
    换名"，batch 模式在两种实现上都能跑。**降级会丢用户选过的配图**（列都删了），这是结构
    回退的固有代价；用户的图片文件本身在 ``user_file`` 里，不受影响。
    """
    tables = _table_names()
    if _ITEM_TABLE in tables:
        existing = _column_names(_ITEM_TABLE)
        with op.batch_alter_table(_ITEM_TABLE) as batch:
            for name, _ in reversed(_ITEM_COLUMNS):
                if name in existing:
                    batch.drop_column(name)
    if _QUEUE_TABLE in tables:
        existing = _column_names(_QUEUE_TABLE)
        with op.batch_alter_table(_QUEUE_TABLE) as batch:
            for name, _ in reversed(_QUEUE_COLUMNS):
                if name in existing:
                    batch.drop_column(name)

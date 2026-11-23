# SPDX-License-Identifier: Apache-2.0
"""0023：``application_track.link`` —— 求职进度自带「关联链接」。

背景：原「申请状态回读」（去门户页猜进度）整条移除，改为让用户在记录上填一个链接，
列表行右侧出现一个图标可直接跳过去。这一列就是那个链接。

三条取舍：

1. **``String(2048)`` + ``nullable=False`` + ``server_default=""``**：链接是选填，
   "没填"用空串表达（与 ``note`` / ``evidence`` 等既有文本列同一口径），
   所以历史行不需要回填 NULL → 空串的二次迁移；
2. **不建索引**：它只随行读取、从不参与筛选或排序，建索引纯属写放大；
3. **无外键、无表重建**：SQLite 的 ``ADD COLUMN`` 能直接加带默认值的非空列。

升级/降级都要能跑：表不存在时跳过而不是报错（迁移会跑在"只有部分业务表"的库上）。
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_add_application_track_link"
down_revision: str | Sequence[str] | None = "0022_company_research_run"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "application_track"
_COLUMN = "link"


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _column_names() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(_TABLE)}


def upgrade() -> None:
    """加 ``link`` 列（已存在则跳过）。"""
    if _TABLE not in _table_names() or _COLUMN in _column_names():
        return
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.String(length=2048), nullable=False, server_default=""),
    )


def downgrade() -> None:
    """删 ``link`` 列（列不存在则跳过）。

    用 ``batch_alter_table``：SQLite 不支持 ``DROP COLUMN`` 的老路径要走"建新表 → 拷数据
    → 换名"，这样在两种实现上都能跑。删列会丢掉用户填过的链接——这是降级的固有代价，
    与 ``remove_tracker_probe_settings`` 的"凭据不可恢复"不同：那是数据清理，这是结构回退。
    """
    if _TABLE not in _table_names() or _COLUMN not in _column_names():
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column(_COLUMN)

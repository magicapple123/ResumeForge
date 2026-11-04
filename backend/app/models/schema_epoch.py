# SPDX-License-Identifier: Apache-2.0
"""应用 schema epoch 表：2.0 起数据目录的「代」标记。

2.0 不再按 alembic revision 判定「这个库是谁的」：revision 会被后续迁移推着向前走，
而「能不能原地升级」只取决于库是不是同一次 2.0 结构。约定单行表
``app_schema_epoch``（epoch 正整数）：启动闸门读它区分 FRESH / UPGRADE /
ARCHIVE_AND_RESET / REFUSE_*。它同时给了「1.x 库」一个确定判据——有业务表、
没有这张表，就是 pre-2.0 库。

2.0 基线迁移在末尾播种一行 ``epoch=2``；``CHECK (epoch >= 1)`` 挡住手改出的
0/负数，避免把脏值误判成「未来版本」。
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class AppSchemaEpoch(Base):
    """单行表：当前数据目录的 schema 代（2.0 = 2）。"""

    __tablename__ = "app_schema_epoch"
    __table_args__ = (CheckConstraint("epoch >= 1", name="ck_app_schema_epoch_positive"),)

    epoch: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 服务端默认而不是只写 Python default：基线迁移的播种 SQL 是 ``INSERT INTO
    # app_schema_epoch (epoch) VALUES (2)``，裸 SQL 不经过 ORM，必须有库侧默认值。
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, server_default=func.now()
    )


__all__ = ["AppSchemaEpoch"]

# SPDX-License-Identifier: Apache-2.0
"""补充事实的字段偏好（profile_fact_field_pref）：按事实类型保存"哪些默认字段隐藏 +
有哪些自定义字段"。

**为什么"字段定义"独立成表、而不是塞进 each fact payload**：定义是按**类型**的
（论文怎么显示、证照怎么显示），事实 payload 里存的是**值快照**（key+label+value）。
这样定义改坏/删掉也不丢用户已经录入的值；同一条定义可以作用于同一类型的所有事实。

**为什么没有 deleted_at / 不进回收站**：它只是一份行为偏好（隐藏了什么、加了哪些
自定义字段），删除或恢复都不会丢用户数据——真正的事实值仍在 payload 里。"恢复默认"
等价于清空 hidden_fields + custom_fields，不存在"需要从回收站找回一条定义"的场景。
缺失行 = 全部默认字段可见、无自定义字段。

revision 供 PUT/reset 的条件写：两个窗口同时改同一种类型的字段设置时，后提交的一方
拿 409 去比较，而不是静默覆盖另一方刚做的修改。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ProfileFactFieldPref(Base):
    __tablename__ = "profile_fact_field_pref"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 一种事实类型一行；单用户单数据集，kind 唯一就够（不需要额外组合键）。
    kind: Mapped[str] = mapped_column(String(24), unique=True)
    # 被隐藏的**默认字段 key**：底层值仍留在 payload，只是界面/AI/导出/网申不用。
    hidden_fields: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    # 字段定义：[{key, label}]；key 形如 cf_<12 位小写 hex>，由服务端在新增时生成。
    custom_fields: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


__all__ = ["ProfileFactFieldPref"]

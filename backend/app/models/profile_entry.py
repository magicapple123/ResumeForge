# SPDX-License-Identifier: Apache-2.0
"""资料条目与值（profile_entry，迁移 0064）。

**为什么定义与值分离、值放一张 JSON 列**（需求 R-15/R-16、§6 铁律 3）：大字段定义（内置
在代码、自建在 profile_custom_section）与小字段定义（内置在代码、自建在
profile_custom_field）都不保存用户内容；内容只在本表。删大字段/小字段定义只改可见性，
不删本表行——这是"删除定义不丢值"的结构保证，同名重建是新定义，不自动关联旧条目。

**values 里缺键 = 未提交**：保存是"合并"而不是"整体替换"（F1 契约 §4 保存语义 2）。
隐藏字段、尚未展开的默认收起字段、已删除自定义字段的旧值，都靠"未提交的键保留旧值"
保住；只有显式空字符串才是清空。字段定义删除后值仍在 values 里，界面按
`field_snapshot` 里保存时的历史标签/类型显示。

**单例分区的结构保证**（需求 R-02 / §6 铁律 10）：basic_info / summary 只能一条，
`sort_order` 恒为 0。表内 CHECK 挡住"第二条 sort_order 非 0"的插入；活动行部分唯一索引
再挡住"两条都是 sort_order=0"的插入。应用层"第二次写入更新同一条"与"多条分区 200 条上限"
是同一语义的服务层门，不是替代关系。

**为什么唯一性带 deleted_at 条件**：软删必须允许"删掉的那条不占排序位"，回收站里的行与
活动行可以同 (section_key, sort_order)；恢复时若位置已被占，由 services/trash.py 的
`RestoreConflict` 翻译成 409。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, DateTime, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ProfileEntry(Base):
    """一个条目（一条教育/项目/工作经历……）+ 它全部小字段的值。"""

    __tablename__ = "profile_entry"
    __table_args__ = (
        # 单例分区（基本信息 / 个人总结）只能有一条，且排序位恒为 0。
        CheckConstraint(
            "section_key NOT IN ('basic_info', 'summary') OR sort_order = 0",
            name="ck_profile_entry_singleton_sort_order",
        ),
        # 活动条目在每个分区内排序位唯一（临时正序号区由服务层在排序时使用）。
        Index(
            "ux_profile_entry_active_section_sort",
            "section_key",
            "sort_order",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
        Index("ix_profile_entry_section_key", "section_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定 id：uuid4().hex[:24]；排序/编辑都不改变它。
    entry_id: Mapped[str] = mapped_column(String(32), unique=True)
    # 内置分区 key 或自建分区 key（"custom:<section_id>"）；一个条目只属于一个分区。
    section_key: Mapped[str] = mapped_column(String(48))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # {field_id: string}。缺键 = 未提交（保存时保留旧值），显式 "" = 清空。
    values: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    # 保存时的字段定义历史快照：[{field_id, label, field_type}]，供字段删除后按历史标签显示。
    field_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


__all__ = ["ProfileEntry"]

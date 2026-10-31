# SPDX-License-Identifier: Apache-2.0
"""资料大字段定义层的自建部分：自建大字段 / 自建小字段 / 字段偏好（迁移 0064）。

内置 13 个大字段与 106 个默认小字段是**代码里的定义**（definition_catalog），不落库；
本文件三张表只存用户自己创建的部分与用户的显示偏好，条目与值在 profile_entry。

**为什么自建分区有 section_id 与 key 两列**（契约 §2.1）：section_id 是外部稳定 id
（`uuid.uuid4().hex[:24]`，与 `ProfileFact.fact_id` 同规则），key 是分区键
`"custom:" + section_id`，与内置分区的 key 处在同一命名空间；两列都唯一，避免同一个
自建分区被登记出两个 key。对外只认这两个稳定 id，不认自增主键。

**为什么活动行唯一性用 partial unique index 而不是普通 UNIQUE**（契约 §2.1/§2.2）：
软删除要求"删掉的名字可以再用"，而普通 UNIQUE 会把回收站里的同名行也算作占用。
`WHERE deleted_at IS NULL` 只约束活动行，正好表达"活动集合内唯一"。恢复时若活动行
重名，由 services/trash.py 的 `RestoreConflict` 提前翻译成 409，而不是让数据库抛
IntegrityError 变成用户看不懂的 500。

**为什么字段偏好没有 deleted_at**：hidden / collapsed_override 只是显示偏好，删掉等价于
"回到全部可见 + 跟随代码默认"，不丢任何用户内容；放进回收站只会制造"偏好也能恢复"的
伪语义，还会与"凡有 deleted_at 必须登记 TRASH_SPECS"的一一对应守卫互相拉扯。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class ProfileCustomSection(Base):
    """用户自建的大字段（形态固定为多条；内置 13 条不写本表）。"""

    __tablename__ = "profile_custom_section"
    __table_args__ = (
        # 活动集合内名称唯一（name_key 已按 normalize_name_key 归一化）；软删行不占名。
        Index(
            "ux_profile_custom_section_active_name",
            "name_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
        # 自建分区排在 13 个内置之后，按本列升序；它只是创建序号，不是组内顺序。
        Index("ix_profile_custom_section_sort_order", "sort_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定 id：uuid4().hex[:24]；排序/改名都不改变它。
    section_id: Mapped[str] = mapped_column(String(32), unique=True)
    # 分区键：固定 "custom:" + section_id，与内置分区 key 同一命名空间（值由服务层生成）。
    key: Mapped[str] = mapped_column(String(48), unique=True)
    name: Mapped[str] = mapped_column(String(40))
    # normalize_name_key(name)：唯一性只看归一化键，展示仍用原 name。
    name_key: Mapped[str] = mapped_column(String(40))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 承载区字段：自建分区可指定一个自建文本字段承载"标签：值"（R-42 自建大字段行）；
    # 为空 = 不上纸面承载区，只作为生成素材。指向的是 field_id（逻辑引用，不建外键）。
    primary_field_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 条件写的版本号：改名/调整顺序后 +1，写入方带 expected_revision 防多窗口覆盖。
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


class ProfileCustomField(Base):
    """自建大字段下的自定义小字段定义（默认小字段不写本表）。"""

    __tablename__ = "profile_custom_field"
    __table_args__ = (
        # 同一分区内活动标签唯一；不同分区可以各有一个"导师姓名"。
        Index(
            "ux_profile_custom_field_active_label",
            "section_key",
            "label_key",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
        ),
        Index("ix_profile_custom_field_section_key", "section_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 外部稳定 id：uuid4().hex[:24]；删定义后重建同名会得到新 id（旧值不自动关联）。
    field_id: Mapped[str] = mapped_column(String(32), unique=True)
    # 只存自建分区 key（"custom:<section_id>"）；内置分区的默认字段是代码定义，不落库。
    section_key: Mapped[str] = mapped_column(String(48))
    label: Mapped[str] = mapped_column(String(40))
    # normalize_name_key(label)：同分区活动标签唯一性只看归一化键。
    label_key: Mapped[str] = mapped_column(String(40))
    # single_line / multi_line / date_text 之一；取值校验在 value_validation，
    # 不在数据库加 CHECK——服务层需要给出"发生了什么 + 怎么办"的中文提示。
    field_type: Mapped[str] = mapped_column(String(16))
    # 纸面默认位置（v2 文档模型 D6，0069）：title / meta / lead / trail / body / hidden。
    # NULL = 按 field_type 自动（single_line/date_text → trail，multi_line → body），
    # 转换器据此决定自定义字段首次落进哪个抽屉；用户可在资料页改。
    default_placement: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 仅素材（0069）：只进 AI / 网申素材、不上纸面。false 是历史行与"默认字段"的行为。
    material_only: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    # 同分区自建字段之间的展示顺序（渲染在默认字段之后）。
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


class ProfileFieldPreference(Base):
    """字段偏好：用户隐藏（hidden）与"展开过"记忆（collapsed_override）。

    两个状态**必须独立**（需求 R-67 / §6 铁律 11）：hidden=True 表示不参与模型与导出；
    collapsed_override=NULL 表示跟随代码默认收起状态，False/True 才覆盖它。
    所以 hidden 与 collapsed_override 是两列，把两者合成一个布尔即返工。
    """

    __tablename__ = "profile_field_preference"
    __table_args__ = (
        # 一个字段一行偏好；field_id 已全局唯一（<section>.<key> / uuid），section_key 用于
        # 校验归属与按分区取数，联合唯一保证"同一字段不会被登记两次"。
        UniqueConstraint(
            "section_key", "field_id", name="uq_profile_field_preference_section_field"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    section_key: Mapped[str] = mapped_column(String(48))
    field_id: Mapped[str] = mapped_column(String(32))
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # NULL = 跟随代码默认（默认收起与否由定义决定）；True/False = 用户手动展开过/收起过。
    collapsed_override: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


__all__ = ["ProfileCustomField", "ProfileCustomSection", "ProfileFieldPreference"]

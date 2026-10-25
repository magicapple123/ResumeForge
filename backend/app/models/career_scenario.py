# SPDX-License-Identifier: Apache-2.0
"""职业场景（career_scenario）：用户保存的"本窗口建议"配置。

**与什么分开**（计划 §5.1，硬约束）：

- 与排版对象的 ``ROLES``（姓名/正文/元信息等）无关——那套是渲染分区，这里的是
  职业阶段/目标/偏好；命名一律 ``career_scenario``，不复用 ``role``；
- 与面试 persona 无关（那是会话角色）；与工作区预设、数据集也无关；
- **不是账号权限、不是岗位过滤器、不是提示词扮演角色**。

切换场景只改本窗口引导，不写任何业务数据；只有用户在生成配置里显式"用于本次生成"
时才由服务端解析成不可变快照。因此本表没有 deleted_at（归档代替删除），删除场景
不会追溯修改任何历史快照。每数据集独立（各数据集自己的 SQLite 库）。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow


class CareerScenario(Base):
    __tablename__ = "career_scenario"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 用户可见名称；首版归档代替删除，重命名保留同一 id。
    name: Mapped[str] = mapped_column(String(40), default="", server_default="")
    # config 的结构版本；与 catalog_version（内置规则版本）、revision（用户编辑版本）
    # 三者分开，不混用（计划 §7.2）。
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # 受限场景配置（严格 schema 在校验层，不是任意 JSON 编辑器）：
    # career_stage / employment_status / purpose / target_industries / target_function /
    # cooperation_form / content_language / work_region / preferred_sections /
    # expression_preferences / include_employment_status。
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}")
    # 归档代替删除：归档不影响在途任务、旧简历与历史快照；重新启用保留原 id。
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=True
    )


__all__ = ["CareerScenario"]

# SPDX-License-Identifier: Apache-2.0
"""AI 读取个人资料的**唯一入口**：当前方案组 + 隐藏字段剔除。

用户口径（2026-10-28）：凡是"读我的资料"的 AI 功能——助手上下文、岗位匹配（单岗与
横向对比）、简历建议、审阅预检——都必须与「我的资料」页里**当前选中的组**一致，并且
不得看到被设为隐藏的字段。组一旦切换，后续任务自动跟随；已经生成的结果各自冻结了
当时的快照，不受影响。

为什么收成一个模块（而不是各调用方各写一遍 ``load_consumed_profile(scope)``）：
`load_all_consumed_profile` 与 `project_legacy_profile` 仍然存在且各自有正当用途
（网申重叠值裁决、编辑视图回显），随手取用其中一个就会重新引入"某个功能读了组外资料"
或"隐藏字段进了模型"的偏差，而这类偏差在界面上完全看不出来。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ...schemas.profile import ProfileOut
from ...schemas.profile_projection import ConsumedProfile
from .group_scope import resolve_current_group_scope
from .profile_reader import load_consumed_profile
from .profile_service import project_legacy_profile_from_consumed


def load_ai_consumed_profile(db: Session) -> ConsumedProfile:
    """当前组的消费快照（sections 键集合 = 该组参与清单，hidden 已剔除）。"""
    return load_consumed_profile(db, resolve_current_group_scope(db))


def load_ai_profile(db: Session) -> ProfileOut:
    """当前组消费快照投影出的旧形状资料（只给 AI 提示词与只读证据用）。"""
    return project_legacy_profile_from_consumed(load_ai_consumed_profile(db))


__all__ = ["load_ai_consumed_profile", "load_ai_profile"]

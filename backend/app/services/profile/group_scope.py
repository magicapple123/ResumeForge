# SPDX-License-Identifier: Apache-2.0
"""资料读取边界：当前组 → 参与大字段集合的唯一解析（F2 契约 §2.1）。

**为什么必须是唯一入口**（需求 R-28/R-29、§7）：生成、新建/填充、网申三条链路都必须
看到同一份"当前组参与清单 + 全局顺序"。各自读一次组、各自判一遍有效 key，迟早有一条
链路把软删分区或失效关系算进去，而这类偏差在界面上看不出来（只会表现为"模型没看到
某段经历"）。这里只做一件事：把 state → 当前组 → 有效参与 key（按全局顺序、
basic_info 首位）冻结成不可变 scope，之后所有消费者只消费 scope。

**绝不接受调用方指定另一个组**（R-24）：当前组是数据集级唯一状态，scope 只从
profile_workspace_state 读；请求体里的 group_id 一律不参与解析（"传了也不生效"比
"报错但如果传对就生效"更安全——后者会变成绕过当前组的第二个入口）。

**三链外用 all_sections_scope**：助手/岗位匹配/审阅等不按组限制（R-64 是明确的非目标），
但它们同样只应消费同一份 ConsumedProfile 形状，所以这里给出"全部活动分区"的 scope，
而不是让每个消费者自己拼一个假组。它不是真实组（group_id 为空、group_name 是说明性
文案），不得写入 profile_usage_snapshot 当作组身份。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from . import group_store, workspace_bootstrap
from .errors import Conflict

ALL_SECTIONS_GROUP_NAME = "全部大字段"


@dataclass(frozen=True)
class ProfileScope:
    """一次读取边界；值已在库内解析完成，可脱离 Session 传给后台任务使用。"""

    group_id: str
    group_name: str
    is_default: bool
    participating_keys: tuple[str, ...]
    section_order: tuple[str, ...]
    workspace_revision: int


def _section_order(state: object) -> tuple[str, ...]:
    """全局唯一顺序（ensure_workspace 已把失效/缺失项修好，这里只做形状归一）。"""
    return tuple(str(key) for key in (getattr(state, "section_order", None) or []))


def resolve_current_group_scope(db: Session) -> ProfileScope:
    """当前组的读取边界（唯一读取口）；ensure_workspace 的幂等修复是唯一写库例外。"""
    state = workspace_bootstrap.ensure_workspace(db)
    group = workspace_bootstrap.active_group(db, state.current_group_id)
    if group is None:
        # ensure_workspace 会把失效的当前组切回默认组，走到这里说明数据被外部改坏；
        # 宁可让页面拿错误并刷新，也不要返回一个"空参与清单"冒充合法状态。
        raise Conflict("当前组不可用：请刷新页面后重试；若仍失败，请重新选择当前组")
    participating = tuple(group_store.group_participating_keys(db, group))
    return ProfileScope(
        group_id=group.group_id,
        group_name=group.name,
        is_default=bool(group.is_default),
        participating_keys=participating,
        section_order=_section_order(state),
        workspace_revision=int(state.revision or 1),
    )


def all_sections_scope(db: Session) -> ProfileScope:
    """全部活动分区（不按组）：三链外读取用的冻结边界（R-64 非目标，不代表某个组）。"""
    state = workspace_bootstrap.ensure_workspace(db)
    order = _section_order(state)
    return ProfileScope(
        group_id="",
        group_name=ALL_SECTIONS_GROUP_NAME,
        is_default=False,
        participating_keys=order,
        section_order=order,
        workspace_revision=int(state.revision or 1),
    )


__all__ = [
    "ALL_SECTIONS_GROUP_NAME",
    "ProfileScope",
    "all_sections_scope",
    "resolve_current_group_scope",
]

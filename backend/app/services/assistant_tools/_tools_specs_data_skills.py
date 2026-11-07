# SPDX-License-Identifier: Apache-2.0
"""助手技能（skills）工具声明：列出 / 读取 / 新建 / 修改技能与知识文件。

T28 收尾批：list/get/create 三对迁入 action 契约层（``actions/domains/skills.py``）；
``update_skill`` 是 T27 试点（``actions/pilots.py``）。本文件只按原声明顺序把
``as_tool(...)`` 的结果拼回注册表；参数/权限/preview/service_entry 的唯一真源在 ActionSpec。
"""

from __future__ import annotations

from ..actions.domains.skills import skill_actions
from ..actions.pilots import pilot_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

_ACTIONS = skill_actions()

SKILL_TOOLS: tuple[Tool, ...] = (
    as_tool(_ACTIONS["list_skills"]),
    as_tool(_ACTIONS["get_skill"]),
    as_tool(_ACTIONS["create_skill"]),
    # T27 试点：契约层 single source —— 参数/权限/描述/预览/service_entry 都由 ActionSpec 生成。
    as_tool(pilot_actions()["update_skill"]),
)

__all__ = ["SKILL_TOOLS"]


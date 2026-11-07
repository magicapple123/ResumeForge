# SPDX-License-Identifier: Apache-2.0
"""资料箱（materials）工具声明：列出 / 读取 / 新建 / 修改一条资料。

T28 Batch B 起改为 action 契约层生成（as_tool(ActionSpec)）：参数/权限/描述/preview/
service_entry 的唯一真源在 app/services/actions/domains/materials.py，本模块只保留工具
在 _TOOLS 里的顺序位置（DATA_TOOLS 的拼接顺序是提示词契约，不得重排）。
"""

from __future__ import annotations

from ..actions.domains.materials import material_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

MATERIAL_TOOLS: tuple[Tool, ...] = (
    as_tool(material_actions()["list_materials"]),
    as_tool(material_actions()["get_material"]),
    as_tool(material_actions()["create_material"]),
    as_tool(material_actions()["update_material"]),
)

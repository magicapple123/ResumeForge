# SPDX-License-Identifier: Apache-2.0
"""事实台账（claims）工具声明：列出 / 读取 / 新建 / 修改一条台账条目。

T28 Batch B 起，读取/新建/修改三条改由 action 契约层生成（as_tool(ActionSpec)）；
list_claims 是 T27 试点，仍从 pilots.py 取。唯一真源都在 app/services/actions/ 下，
本模块只保留工具在 _TOOLS 里的顺序位置（DATA_TOOLS 的拼接顺序是提示词契约）。
"""

from __future__ import annotations

from ..actions.domains.claims import claim_actions
from ..actions.pilots import pilot_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

CLAIM_TOOLS: tuple[Tool, ...] = (
    # T27 试点：契约层 single source —— 参数/权限/描述/service_entry 都由 ActionSpec 生成。
    as_tool(pilot_actions()["list_claims"]),
    as_tool(claim_actions()["get_claim"]),
    as_tool(claim_actions()["create_claim"]),
    as_tool(claim_actions()["update_claim"]),
)

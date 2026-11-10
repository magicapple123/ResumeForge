# SPDX-License-Identifier: Apache-2.0
"""联网搜索工具声明（``_TOOLS`` 最后 1 条）。"""
from __future__ import annotations

from ._types import _WEB_SEARCH_DESC_SUMMARIES, Tool, ToolPermission
from .search_tools import _tool_web_search

SEARCH_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="web_search",
        description=_WEB_SEARCH_DESC_SUMMARIES,
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词，尽量包含公司名、岗位名或技术方向",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "description": (
                        "可选：本次希望返回几条结果；不能超过设置页的「每次最多返回的结果条数」。"
                        "不填按上限处理。"
                    ),
                },
            },
            "required": ["query"],
        },
        handler=_tool_web_search,
        service_entry="search.aggregate_search",
        permission=ToolPermission.READ_ONLY,
        requires_web_search=True,
    ),
)

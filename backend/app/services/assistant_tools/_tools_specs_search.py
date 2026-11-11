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
                # P4-08：模型可以按问题类型自己选深度——问"某公司官网地址"用 snippet 更快，
                # 问"这个岗位具体做什么"要 standard/deep 才读得到正文。
                "depth": {
                    "type": "string",
                    "enum": ["snippet", "standard", "deep"],
                    "description": (
                        "可选：搜索深度。snippet 只看摘要（最快）；standard 打开前 2 条结果"
                        "读正文（默认）；deep 打开前 5 条并多取几段（最详细，也最慢）。"
                        "不填按设置页的默认档位。"
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

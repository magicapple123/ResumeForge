"""联网搜索工具声明（``_TOOLS`` 最后 1 条）。"""
from __future__ import annotations

from .search_tools import _tool_web_search
from ._types import Tool, _WEB_SEARCH_DESC_SUMMARIES

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
                }
            },
            "required": ["query"],
        },
        handler=_tool_web_search,
        requires_web_search=True,
    ),
)

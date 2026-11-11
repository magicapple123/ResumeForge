# SPDX-License-Identifier: Apache-2.0
"""知识库混合检索工具声明（#29A）：单独成文件，避免改共享聚合入口。

约定（handoff §3.1）：新工具只建自己的 _tools_specs_<domain>.py；
_tools_specs_data.py 由主 agent 统一加 import + spread 两行，本文件不直接改它。
需要主 agent 合并的 diff：

    from ._tools_specs_data import ...  # 现有
    + from ._tools_specs_knowledge import KNOWLEDGE_SEARCH_TOOLS
    DATA_TOOLS = (..., + *KNOWLEDGE_SEARCH_TOOLS)
"""

from __future__ import annotations

from ._types import Tool, ToolPermission
from .knowledge_tools import (
    DEFAULT_KNOWLEDGE_SEARCH_LIMIT,
    _tool_search_knowledge,
)

KNOWLEDGE_SEARCH_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="search_knowledge",
        description=(
            "在知识库（面经总结/简历技巧/求职策略等成文笔记）里做混合检索，返回命中的"
            "条目 id、标题、摘要与相关度分数。用户问「我笔记里有没有讲过…」"
            "「之前存的面经里怎么说的」「有没有关于 XX 的经验」时先用它定位；"
            "拿到 id 后再用 get_knowledge 读正文（不要把整个知识库塞进上下文）。"
            "浏览全部条目用 list_knowledge，本工具只负责相关度检索。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索内容：关键词或一句自然语言问题",
                },
                "limit": {
                    "type": "integer",
                    "description": f"可选，最多返回多少条，默认 {DEFAULT_KNOWLEDGE_SEARCH_LIMIT}",
                },
                "company": {
                    "type": "string",
                    "description": "可选，只在这家公司关联的条目里检索",
                },
            },
            "required": ["query"],
        },
        handler=_tool_search_knowledge,
        permission=ToolPermission.READ_ONLY,
        service_entry="knowledge_rag.hybrid_search",
    ),
)

__all__ = ["KNOWLEDGE_SEARCH_TOOLS"]

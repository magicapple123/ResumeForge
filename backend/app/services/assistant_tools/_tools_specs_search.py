# SPDX-License-Identifier: Apache-2.0
"""联网搜索与公司调研工具声明（``_TOOLS`` 末尾两条）。"""
from __future__ import annotations

from ._types import _WEB_SEARCH_DESC_SUMMARIES, Tool, ToolPermission
from .research_tools import _tool_research_company
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
    # I-23：把"调研这家公司"变成助手能做的一件事。只读（不改库、不外发），但会消耗
    # 搜索额度——描述里写清楚，模型才会在真的需要公司背景时才调用。
    Tool(
        name="research_company",
        description=(
            "调研一家公司的背景（主营、近期动态、口碑），返回带来源链接的摘要。"
            "会消耗搜索额度（深度档最多约 20 次工具调用，费用明显更高），"
            "只在用户问「这家公司怎么样 / 值不值得投」这类需要外部信息的问题时使用；"
            "用户只是让你改简历或查本地数据时不要调用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "company": {"type": "string", "description": "公司名，尽量用全名"},
                "role": {"type": "string", "description": "可选：目标岗位名，让结论更贴岗位"},
                "jd": {"type": "string", "description": "可选：招聘描述原文，用于解读岗位"},
                "deep": {
                    "type": "boolean",
                    "description": "可选：深度调研（多轮搜索，费用更高）。默认 false。",
                },
            },
            "required": ["company"],
        },
        handler=_tool_research_company,
        service_entry="job.company_research.run_company_research_with",
        permission=ToolPermission.READ_ONLY,
        requires_web_search=True,
    ),
)

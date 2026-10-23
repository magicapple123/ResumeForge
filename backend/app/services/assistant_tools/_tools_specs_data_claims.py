# SPDX-License-Identifier: Apache-2.0
"""事实台账（claims）工具声明：列出 / 读取 / 新建 / 修改一条台账条目。

从 ``_tools_specs_data.py`` 按工具域纯搬出（声明体逐字未改）。核实状态只能由
用户自己改，所以 create/update 的描述里写死了这条边界。
"""

from __future__ import annotations

from . import previews
from ._types import Tool
from .data_tools import (
    _tool_create_claim,
    _tool_get_claim,
    _tool_list_claims,
    _tool_update_claim,
)

CLAIM_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_claims",
        description=(
            "列出事实台账里的条目（用户逐条核对过的、可以写进简历的事实，含核实状态与"
            "承担程度）。用户提到「台账」「那条经历有没有核对过」「哪些还没确认」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，标题/主体/事实/表述里的关键词"},
                "category": {
                    "type": "string",
                    "description": "可选，分类：教育经历、实习/工作、项目经历、校园经历、专业技能、荣誉奖项、其他",
                },
                "status": {
                    "type": "string",
                    "enum": ["已确认", "待确认", "已过期", "不采用"],
                    "description": "可选，按核实状态筛选",
                },
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_claims,
    ),
    Tool(
        name="get_claim",
        description=(
            "按 id 读取一条台账条目的完整内容：原始事实、简历表述、个人边界、证据来源、"
            "面试细节（决策/难点/验证/结果）与待改进项。准备面试追问或核对表述时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {"claim_id": {"type": "integer", "description": "台账条目 id"}},
            "required": ["claim_id"],
        },
        handler=_tool_get_claim,
    ),
    Tool(
        name="create_claim",
        description=(
            "把一条经历整理成台账条目记下来。只在用户明确要求记录时调用。"
            "新条目一律是「待确认」——是否确认由用户自己判断，你不能替他确认。"
            "原始事实要照实写、不加包装；信息不全时写【待补：缺什么】而不是猜测。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "便于检索的标题"},
                "category": {
                    "type": "string",
                    "description": "分类：教育经历、实习/工作、项目经历、校园经历、专业技能、荣誉奖项、其他",
                },
                "subject": {
                    "type": "string",
                    "description": "这条主张关于谁：公司/项目/学校/技能名",
                },
                "source_fact": {"type": "string", "description": "原始事实，忠实复述，不包装"},
                "candidate_wording": {
                    "type": "string",
                    "description": "准备写进简历的版本，不得比原始事实更强",
                },
                "responsibility_level": {
                    "type": "string",
                    "enum": ["参与", "负责模块", "主导方案或交付", "项目负责人"],
                    "description": "本人在其中的承担程度，判断不了就用「参与」",
                },
                "boundary": {"type": "string", "description": "团队做了什么、本人做了什么的分界"},
                "risk_notes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "面试可能被追问但还站不住的地方",
                },
            },
            "required": ["source_fact"],
        },
        handler=_tool_create_claim,
        preview=previews.preview_create_claim,
        writes=True,
    ),
    Tool(
        name="update_claim",
        description=(
            "修改一条已有的台账条目（只传要改的字段）。**核实状态改不了**——"
            "已确认、待确认这类判断必须由用户自己下。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "claim_id": {"type": "integer", "description": "台账条目 id"},
                "title": {"type": "string"},
                "subject": {"type": "string"},
                "source_fact": {"type": "string"},
                "candidate_wording": {"type": "string"},
                "responsibility_level": {
                    "type": "string",
                    "enum": ["参与", "负责模块", "主导方案或交付", "项目负责人"],
                },
                "boundary": {"type": "string"},
                "risk_notes": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["claim_id"],
        },
        handler=_tool_update_claim,
        preview=previews.preview_update_claim,
        writes=True,
    ),
)

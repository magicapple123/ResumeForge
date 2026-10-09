"""放宽模式工具声明（``_TOOLS`` 中 4 条，全部 ``requires_relaxed=True``）。

这些工具会读到敏感信息——网申填表的真实填写值、用户的历史对话——所以只在
用户于设置里显式开启「助手放宽模式」后才下发给模型（门控见 ``tool_definitions``，
设置见 ``settings_service.get_assistant_relaxed_mode``）。它们全部只读；网申**资料**
表（profile_entry / profile_record / url_history）任何模式下都没有工具，
由 ``test_assistant_coverage.test_the_learning_path_stays_off_every_assistant_tool`` 守卫。
"""
from __future__ import annotations

from ._types import Tool
from .data_tools import (
    _tool_get_chat_conversation,
    _tool_get_web_form_fill,
    _tool_list_chat_conversations,
    _tool_list_web_form_fills,
)

RELAXED_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_web_form_fills",
        description=(
            "列出网申填表的填充记录（页面、成功/未核对/失败数、方式与时间），"
            "可按关键词搜页面标题或网址。**放宽模式工具**：记录里含用户填进网页的真实值，"
            "仅当用户在设置里开启助手放宽模式后你才有这个工具。只读；删除与发起填充"
            "在网申填表页操作。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，按页面标题或网址模糊匹配"},
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_web_form_fills,
        requires_relaxed=True,
    ),
    Tool(
        name="get_web_form_fill",
        description=(
            "读取一次网申填充的完整明细：每个框认成了什么字段、真实填写了什么值、"
            "成功还是失败。**放宽模式工具**：内容含身份证号、手机号等敏感值，仅当用户"
            "开启助手放宽模式后才可用；除非用户明确询问当时填了什么，否则不要主动复述其中的敏感值。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "fill_id": {"type": "integer", "description": "填充记录 id，来自 list_web_form_fills"},
            },
            "required": ["fill_id"],
        },
        handler=_tool_get_web_form_fill,
        requires_relaxed=True,
    ),
    Tool(
        name="list_chat_conversations",
        description=(
            "列出助手的历史对话（标题、入口、更新时间），可按关键词搜标题。"
            "**放宽模式工具**：对话是用户与模型的私密记录，仅当用户开启助手放宽模式后"
            "你才有这个工具，用于回看「我们之前聊过什么」。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，按标题模糊匹配"},
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_chat_conversations,
        requires_relaxed=True,
    ),
    Tool(
        name="get_chat_conversation",
        description=(
            "读取一场历史对话的完整消息（按时间正序）。**放宽模式工具**：仅当用户开启"
            "助手放宽模式后才可用；用户问「我们之前聊到的 XX」时用它现场查证，"
            "不要凭记忆复述旧对话。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "conversation_id": {"type": "integer", "description": "对话 id，来自 list_chat_conversations"},
            },
            "required": ["conversation_id"],
        },
        handler=_tool_get_chat_conversation,
        requires_relaxed=True,
    ),
)

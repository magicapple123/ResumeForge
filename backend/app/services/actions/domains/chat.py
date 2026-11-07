# SPDX-License-Identifier: Apache-2.0
"""chat 域 action 契约（T28 收尾）：历史对话（放宽模式只读）。

迁移对（行为零漂移：run / run_tool 都直接委托既有实现）：

- list_chat_conversations ↔ GET /api/assistant/conversations
  （handler app.api.assistant.list_conversations）
- get_chat_conversation  ↔ GET /api/assistant/conversations/{conversation_id}
  （handler app.api.assistant.read_conversation）

两侧都是 **requires_relaxed=True**：对话是用户与模型的私密记录，只有用户显式开启
「助手放宽模式」后才下发给模型（门控在 tool_definitions，声明必须原样保留）。

路由 handler 的 surface / message_limit 是**路由专属参数**（工具声明里没有），用
tool_fields 从工具 schema 与工具入参里剪掉；工具侧参数与旧声明一致，旧工具默认
limit=20 用 tool_defaults 保留（路由默认 100 由 input_model 的字段默认值承担）。
旧 GET 路由一直忽略未知 query，故两侧都开 ignore_unknown_arguments。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ....schemas.assistant import (
    ChatConversationBrief,
    ChatConversationDetail,
    ConversationSurface,
)
from ..legacy import route_runner, tool_runner
from ..registry import define_action
from ..spec import ActionSpec, HttpRoute, permission_enum

# 旧工具 handler 的默认条数（assistant_tools/_shared.DEFAULT_LIST_LIMIT=20）。
_DEFAULT_TOOL_LIMIT = 20
# 路由 handler 的默认条数（api/assistant.py 的 Query(default=100)），与工具默认值不同，
# 必须各自保留：路由不应用 tool_defaults。
_ROUTE_LIST_LIMIT = 100


class ListChatConversationsInput(BaseModel):
    """list_chat_conversations 两侧共用入参：路由分页，工具 limit 截断。"""

    model_config = ConfigDict(extra="forbid")

    limit: int = Field(
        default=_ROUTE_LIST_LIMIT,
        ge=1,
        le=500,
        description="可选，最多返回多少条（工具默认 20，路由默认 100）",
    )
    keyword: str = Field(default="", max_length=200, description="可选，按标题模糊匹配")
    surface: ConversationSurface = Field(
        default="page", description="入口筛选：page=求职助手，floating=投投悬浮球（仅路由参数）"
    )


class GetChatConversationInput(BaseModel):
    """get_chat_conversation 两侧共用入参：conversation_id 来自路由路径 / 工具参数。"""

    model_config = ConfigDict(extra="forbid")

    conversation_id: int = Field(description="对话 id，来自 list_chat_conversations")
    surface: ConversationSurface = Field(
        default="page", description="入口筛选：page=求职助手，floating=投投悬浮球（仅路由参数）"
    )
    message_limit: int = Field(
        default=0, ge=0, le=500, description="只取最新 N 条；0 = 全量（仅路由参数）"
    )


_ACTIONS: dict[str, ActionSpec] | None = None


def chat_actions() -> dict[str, ActionSpec]:
    """构建（并注册）chat 域 action，返回 name -> ActionSpec（幂等、可重入）。"""
    global _ACTIONS
    if _ACTIONS is not None:
        from ..registry import get_action

        for spec in _ACTIONS.values():
            if get_action(spec.name) is None:
                define_action(spec)
        return _ACTIONS
    Permission = permission_enum()
    if _ACTIONS is not None:  # 内层重入已完成构建（工具声明模块在 assistant_tools 初始化期调用）
        return _ACTIONS
    list_chat_conversations = define_action(
        ActionSpec(
            name="list_chat_conversations",
            description=(
                "列出助手的历史对话（标题、入口、更新时间），可按关键词搜标题。"
                "**放宽模式工具**：对话是用户与模型的私密记录，仅当用户开启助手放宽模式后"
                "你才有这个工具，用于回看「我们之前聊过什么」。"
            ),
            input_model=ListChatConversationsInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.assistant", "list_conversations"),
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.chat_history",
                "_tool_list_chat_conversations",
            ),
            requires_relaxed=True,
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            tool_fields=("keyword", "limit"),
            tool_defaults=(("limit", _DEFAULT_TOOL_LIMIT),),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET",
                "/api/assistant/conversations",
                list[ChatConversationBrief],
                tags=("assistant",),
            ),
        )
    )
    get_chat_conversation = define_action(
        ActionSpec(
            name="get_chat_conversation",
            description=(
                "读取一场历史对话的完整消息（按时间正序）。**放宽模式工具**：仅当用户开启"
                "助手放宽模式后才可用；用户问「我们之前聊到的 XX」时用它现场查证，"
                "不要凭记忆复述旧对话。"
            ),
            input_model=GetChatConversationInput,
            permission=Permission.READ_ONLY,
            run=route_runner("app.api.assistant", "read_conversation"),
            run_tool=tool_runner(
                "app.services.assistant_tools.data_tools.chat_history",
                "_tool_get_chat_conversation",
            ),
            requires_relaxed=True,
            service_entry=None,
            service_reason="内联 ORM 查询/组装，无 services 收口（T27 收口候选）",
            tool_fields=("conversation_id",),
            ignore_unknown_arguments=True,
            http=HttpRoute(
                "GET",
                "/api/assistant/conversations/{conversation_id}",
                ChatConversationDetail,
                tags=("assistant",),
            ),
        )
    )
    _ACTIONS = {
        list_chat_conversations.name: list_chat_conversations,
        get_chat_conversation.name: get_chat_conversation,
    }
    return _ACTIONS


def actions() -> dict[str, ActionSpec]:
    return chat_actions()


__all__ = ["GetChatConversationInput", "ListChatConversationsInput", "actions", "chat_actions"]

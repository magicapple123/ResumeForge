# SPDX-License-Identifier: Apache-2.0
"""放宽模式工具声明（未迁移的静态声明，全部 requires_relaxed=True）。

这些工具会读到敏感信息——网申填表的真实填写值、用户的历史对话——所以只在
用户于设置里显式开启「助手放宽模式」后才下发给模型（门控见 tool_definitions，
设置见 settings_service.get_assistant_relaxed_mode）。它们全部只读；网申**资料**
表（profile_entry / profile_record / url_history）任何模式下都没有工具，
由 test_assistant_coverage.test_the_learning_path_stays_off_every_assistant_tool 守卫。

T28 收尾迁移：list_web_form_fills / list_chat_conversations / get_chat_conversation
改由 action 契约层生成（as_tool(ActionSpec)，单一真源在 actions/domains/ 下），本模块只保留
它们的位置；get_web_form_fill 暂时保留静态声明——它的路由路径参数叫 record_id、工具参数叫
fill_id，同一 input_model 无法同时表达两侧入参（见 domains/webform.py 的跳过说明）。
"""
from __future__ import annotations

from ..actions.domains.chat import chat_actions
from ..actions.domains.webform import webform_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

RELAXED_TOOLS: tuple[Tool, ...] = (
    as_tool(webform_actions()["list_web_form_fills"]),
    as_tool(webform_actions()["get_web_form_fill"]),
    as_tool(chat_actions()["list_chat_conversations"]),
    as_tool(chat_actions()["get_chat_conversation"]),
)

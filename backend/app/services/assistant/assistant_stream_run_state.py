# SPDX-License-Identifier: Apache-2.0
"""助手流式运行的共享状态：StreamRun 数据类、思考内容截断与相关上限常量。

纯搬迁自 ``assistant_stream_run.py``：状态定义与轮循环/收尾编排分开，
状态结构稳定，编排逻辑独立演进（轮循环与 4 个收尾分支留在原模块）。"""

from __future__ import annotations

from contextvars import Token
from dataclasses import dataclass, field
from typing import Any

from ...schemas.assistant import AssistantMessageCreate
from ..assistant_run_trace import RunTraceRecorder
from ..llm.base import BaseLLMProvider
from .assistant_sources import SourceNumberer
from .assistant_stream_budget import AssistantStreamBudget

# 思考内容写进助手消息 context 的上限（字符数）。**为什么必须限长**：
#   1) 思考内容常常比正文长一个量级，而 context 是随每条历史消息一起被批量加载的
#      JSON；不设限会让单条消息无限膨胀，历史列表的内存与带宽都会失控。
#   2) 该上限只作用于历史展示；DeepSeek 当次工具续轮的协议字段保留完整原文。
# 超限时**如实截断并打标记**（context 里 reasoning_truncated=True），不静默丢弃。
MAX_REASONING_CONTEXT_CHARS = 20_000


def _truncate_reasoning(text: str) -> tuple[str, bool]:
    """把思考内容裁到存储上限，返回 (文本, 是否被截断)。"""
    if len(text) <= MAX_REASONING_CONTEXT_CHARS:
        return text, False
    return text[:MAX_REASONING_CONTEXT_CHARS], True


@dataclass
class StreamRun:
    """一次助手回答的全部可变状态（原主函数局部变量的搬家，无新增语义）。"""

    # 调用参数：流开始时确定，之后只读。
    factory: Any
    payload: AssistantMessageCreate
    attachments: list[dict[str, Any]]
    provider: BaseLLMProvider
    history: list[dict[str, Any]]
    user_message_id: int
    assistant_message_id: int
    generated_title: str
    system_prompt: str
    quoted: dict[str, Any] | None
    conversation_id: int | None

    # 横切状态：正文/思考与工具记录累积、来源编号、预算与运行轨迹。
    parts: list[str] = field(default_factory=list)
    tool_records: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    model_context: list[str] = field(default_factory=list)
    assistant_context: dict[str, Any] = field(default_factory=dict)
    reasoning_parts: list[str] = field(default_factory=list)
    numberer: SourceNumberer = field(default_factory=SourceNumberer)
    budget: AssistantStreamBudget = field(init=False)
    trace: RunTraceRecorder = field(init=False)
    override_token: Token[bool | None] = field(init=False)

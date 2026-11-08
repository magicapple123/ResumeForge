# SPDX-License-Identifier: Apache-2.0
"""兼容壳：助手消息持久化与 SSE 帧编码已下沉到 ``services/assistant/``。

两个落点：

- ``assistant_persistence``：上下文写回、收尾落库、浏览器断开兜底、历史快照；
- ``assistant_sse``：SSE 帧编码。

本模块只做再导出。既有取用点（测试按 ``app.api.assistant_persistence`` 取
``MAX_HISTORY_*`` / ``history_snapshot`` / ``finish_assistant_message``）行为不变。
"""

from __future__ import annotations

from ..services.assistant.assistant_persistence import (
    MAX_HISTORY_CHARS as MAX_HISTORY_CHARS,
)
from ..services.assistant.assistant_persistence import (
    MAX_HISTORY_MESSAGES as MAX_HISTORY_MESSAGES,
)
from ..services.assistant.assistant_persistence import (
    cancel_pending_assistant_message as cancel_pending_assistant_message,
)
from ..services.assistant.assistant_persistence import (
    finish_assistant_message as finish_assistant_message,
)
from ..services.assistant.assistant_persistence import (
    history_snapshot as history_snapshot,
)
from ..services.assistant.assistant_persistence import (
    update_message_context as update_message_context,
)
from ..services.assistant.assistant_sse import format_sse as format_sse

__all__ = [
    "MAX_HISTORY_CHARS",
    "MAX_HISTORY_MESSAGES",
    "cancel_pending_assistant_message",
    "finish_assistant_message",
    "format_sse",
    "history_snapshot",
    "update_message_context",
]

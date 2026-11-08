# SPDX-License-Identifier: Apache-2.0
"""兼容壳：SSE 编排实现已下沉到 ``services/assistant/``。

本模块只做**再导出**，不再包含任何编排逻辑——轮次循环、工具循环与事件下发都在
``app/services/assistant/assistant_stream_events.py``。保留这一层的原因：

- ``api/assistant.py``、测试与工具脚本一直按 ``app.api.assistant_stream`` 取符号
  （``stream_message_events`` / ``MAX_TOOL_ROUNDS`` / ``history_snapshot`` 等）；
- 依赖方向收敛为单向 ``api → services``：本文件不 import 任何 ``app.api.*`` 兄弟模块，
  因此 ``tests/test_import_direction.py`` 里原先为它登记的 4 条跨模块豁免都已删除。
"""

from __future__ import annotations

from ..services.assistant.assistant_persistence import (
    cancel_pending_assistant_message as cancel_pending_assistant_message,
)
from ..services.assistant.assistant_persistence import (
    finish_assistant_message as finish_assistant_message,
)
from ..services.assistant.assistant_persistence import format_sse as format_sse
from ..services.assistant.assistant_persistence import history_snapshot as history_snapshot
from ..services.assistant.assistant_persistence import (
    update_message_context as update_message_context,
)
from ..services.assistant.assistant_stream_events import (
    MAX_REASONING_CONTEXT_CHARS as MAX_REASONING_CONTEXT_CHARS,
)
from ..services.assistant.assistant_stream_events import MAX_TOOL_ROUNDS as MAX_TOOL_ROUNDS
from ..services.assistant.assistant_stream_events import MAX_WEB_SEARCHES as MAX_WEB_SEARCHES
from ..services.assistant.assistant_stream_events import (
    stream_message_events as stream_message_events,
)

__all__ = [
    "MAX_REASONING_CONTEXT_CHARS",
    "MAX_TOOL_ROUNDS",
    "MAX_WEB_SEARCHES",
    "cancel_pending_assistant_message",
    "finish_assistant_message",
    "format_sse",
    "history_snapshot",
    "stream_message_events",
    "update_message_context",
]

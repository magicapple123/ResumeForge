# SPDX-License-Identifier: Apache-2.0
"""兼容壳：单次工具调用执行已下沉到 ``services/assistant/assistant_tool_exec.py``。

只做再导出，不再包含实现。既有取用点（``tests/test_assistant_authorization.py`` 与
``tests/test_assistant_document_tools.py`` 在函数内 ``from app.api.assistant_tool_exec
import run_tool_call``）行为不变。

**注意（测试注入点）**：假工具执行器的 monkeypatch 落点必须跟着实现走——
``run_tool_call`` 在 ``app.services.assistant.assistant_tool_exec`` 里按模块全局名查找
``execute_tool_async``，因此 patch 目标是那个模块。本壳**刻意不再导出**
``execute_tool_async``：如果哪处旧 patch 仍指向本模块，会立刻 ``AttributeError``（响亮
失败），而不是静默失效后跑到别处变红。
"""

from __future__ import annotations

from ..services.assistant.assistant_tool_exec import (
    begin_run_trace as begin_run_trace,
)
from ..services.assistant.assistant_tool_exec import close_run_trace as close_run_trace
from ..services.assistant.assistant_tool_exec import is_web_search as is_web_search
from ..services.assistant.assistant_tool_exec import (
    record_run_trace_step as record_run_trace_step,
)
from ..services.assistant.assistant_tool_exec import run_tool_call as run_tool_call
from ..services.assistant.assistant_tool_exec import (
    run_trace_payload as run_trace_payload,
)

__all__ = [
    "begin_run_trace",
    "close_run_trace",
    "is_web_search",
    "record_run_trace_step",
    "run_tool_call",
    "run_trace_payload",
]

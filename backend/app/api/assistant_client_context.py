# SPDX-License-Identifier: Apache-2.0
"""兼容壳：「当前界面上下文」渲染已下沉到 ``services/assistant/assistant_client_context.py``。

只做再导出，不再包含实现。既有取用点（``api/assistant.py`` 组装系统提示、
``tests/test_assistant_client_context.py`` 直接单测本块）行为不变。
"""

from __future__ import annotations

from ..services.assistant.assistant_client_context import (
    MAX_TITLE_CHARS as MAX_TITLE_CHARS,
)
from ..services.assistant.assistant_client_context import (
    NO_SELECTION_LINE as NO_SELECTION_LINE,
)
from ..services.assistant.assistant_client_context import (
    SELECTION_MODELS as SELECTION_MODELS,
)
from ..services.assistant.assistant_client_context import (
    TYPE_LABELS as TYPE_LABELS,
)
from ..services.assistant.assistant_client_context import (
    build_client_context_block as build_client_context_block,
)

__all__ = [
    "MAX_TITLE_CHARS",
    "NO_SELECTION_LINE",
    "SELECTION_MODELS",
    "TYPE_LABELS",
    "build_client_context_block",
]

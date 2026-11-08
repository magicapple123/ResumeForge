# SPDX-License-Identifier: Apache-2.0
"""兼容壳：本地上下文组装已下沉到 ``services/assistant/assistant_context.py``。

只做再导出，不再包含实现。既有取用点（``api/assistant.py`` 取 ``load_local_context``、
``assistant_tools`` 延迟导入 ``profile_context``、测试取 ``MAX_*`` 上限）行为不变。
"""

from __future__ import annotations

from ..services.assistant.assistant_context import (
    MAX_JOB_CONTEXT_CHARS as MAX_JOB_CONTEXT_CHARS,
)
from ..services.assistant.assistant_context import (
    MAX_LOCAL_CONTEXT_CHARS as MAX_LOCAL_CONTEXT_CHARS,
)
from ..services.assistant.assistant_context import (
    MAX_PROFILE_CONTEXT_CHARS as MAX_PROFILE_CONTEXT_CHARS,
)
from ..services.assistant.assistant_context import (
    MAX_RESUME_CONTEXT_CHARS as MAX_RESUME_CONTEXT_CHARS,
)
from ..services.assistant.assistant_context import (
    load_local_context as load_local_context,
)
from ..services.assistant.assistant_context import profile_context as profile_context
from ..services.assistant.assistant_context import resume_context as resume_context
from ..services.assistant.assistant_context import trim as trim

__all__ = [
    "MAX_JOB_CONTEXT_CHARS",
    "MAX_LOCAL_CONTEXT_CHARS",
    "MAX_PROFILE_CONTEXT_CHARS",
    "MAX_RESUME_CONTEXT_CHARS",
    "load_local_context",
    "profile_context",
    "resume_context",
    "trim",
]

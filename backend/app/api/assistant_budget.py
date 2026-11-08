# SPDX-License-Identifier: Apache-2.0
"""兼容壳：整链预算与用量遥测已下沉到 ``services/assistant/assistant_stream_budget.py``。

只做再导出，不再包含实现。既有取用点（流编排）与测试按本路径取
``AssistantStreamBudget`` 的行为保持不变。
"""

from __future__ import annotations

from ..services.assistant.assistant_stream_budget import (
    AssistantStreamBudget as AssistantStreamBudget,
)

__all__ = ["AssistantStreamBudget"]

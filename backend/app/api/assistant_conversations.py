# SPDX-License-Identifier: Apache-2.0
"""兼容壳：助手会话的读写已下沉到 ``services/assistant/assistant_conversations.py``。

只做再导出，不再包含实现（这个模块本来就没有路由，只是一组"会话读写 + 视图组装"）。
既有取用点（``api/assistant.py`` 的会话 CRUD、``api/assistant_breadth.py`` /
``compaction_api`` / ``conversation_skills`` / ``regenerate_api`` 的 ``conversation_or_404``）
行为不变；新代码请直接从服务层导入，别再往这里加东西。
"""

from __future__ import annotations

from ..services.assistant.assistant_conversations import (
    DEFAULT_TITLE as DEFAULT_TITLE,
)
from ..services.assistant.assistant_conversations import (
    SUPERSEDED_STATUS as SUPERSEDED_STATUS,
)
from ..services.assistant.assistant_conversations import (
    WELCOME_TITLE as WELCOME_TITLE,
)
from ..services.assistant.assistant_conversations import (
    conversation_or_404 as conversation_or_404,
)
from ..services.assistant.assistant_conversations import (
    create_conversation as create_conversation,
)
from ..services.assistant.assistant_conversations import (
    delete_conversation as delete_conversation,
)
from ..services.assistant.assistant_conversations import (
    delete_messages as delete_messages,
)
from ..services.assistant.assistant_conversations import (
    fork_conversation as fork_conversation,
)
from ..services.assistant.assistant_conversations import (
    list_conversations as list_conversations,
)
from ..services.assistant.assistant_conversations import (
    read_conversation as read_conversation,
)
from ..services.assistant.assistant_conversations import (
    read_earlier_messages as read_earlier_messages,
)
from ..services.assistant.assistant_conversations import (
    update_conversation as update_conversation,
)
from ..services.assistant.assistant_conversations import (
    welcome_message as welcome_message,
)

__all__ = [
    "DEFAULT_TITLE",
    "SUPERSEDED_STATUS",
    "WELCOME_TITLE",
    "conversation_or_404",
    "create_conversation",
    "delete_conversation",
    "delete_messages",
    "fork_conversation",
    "list_conversations",
    "read_conversation",
    "read_earlier_messages",
    "update_conversation",
    "welcome_message",
]

# SPDX-License-Identifier: Apache-2.0
"""投递队列工具声明（#15F 对话式投递军师）：查看队列 / 调优先级 / 开始投递。

三个工具全部由 action 契约层生成（``actions/domains/apply_queue.py``）：参数 / 权限 /
预览 / service_entry 的唯一真源在那边，本文件只按固定顺序把 ``as_tool(...)`` 的结果拼回
注册表。

**``apply_start`` 是全项目唯一 ``EXTERNAL_SIDE_EFFECT`` 工具**（用户已拍板破例）：
它会真的向招聘平台提交投递、不可撤销，因此同时登记在
``policy.ALWAYS_PROPOSAL_TOOLS``（即使 write_full 也只生成提案，见
``tests/test_assistant_apply_tools.py`` 与 ``tests/test_assistant_tool_permissions.py``）。
"""

from __future__ import annotations

from ..actions.domains.apply_queue import apply_queue_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

# 一次构建（幂等、可重入），再按固定顺序取工具——顺序是提示词契约，不得重排。
_ACTIONS = apply_queue_actions()

APPLY_QUEUE_TOOLS: tuple[Tool, ...] = (
    as_tool(_ACTIONS["queue_list"]),
    as_tool(_ACTIONS["queue_update_priority"]),
    as_tool(_ACTIONS["apply_start"]),
)

__all__ = ["APPLY_QUEUE_TOOLS"]

# SPDX-License-Identifier: Apache-2.0
"""action 契约层（T27）：一份 ``ActionSpec`` 同时生成 HTTP 路由与 Agent 工具。

分层与唯一的对外入口：

- ``spec``：ActionSpec / Permission / ActionOutcome / ActionError / HttpRoute / 错误映射；
- ``registry``：显式注册与枚举（导入无副作用，不注册任何动作）；
- ``tool_adapter``：``as_tool()`` / ``to_tool_schema()``，生成既有 ``Tool(...)``；
- ``route_adapter``：``as_route()``，只生成 router；注册位置仍由
  ``application_routers.ROUTERS`` 显式决定。

**当前的阶段**：79 个工具里 **64 个已由 action 契约层生成**（HTTP 路由与 Agent 工具同源），
剩余 **15 个**仍是静态 ``Tool(...)`` 声明，逐条登记在 ``tests/fixtures/actions_legacy_allowlist.json``
（reason + review_after 双向校验）；新增动作一律走 ``define_action``，不要再写静态声明。
"""

from typing import Any

from .registry import (
    action_names,
    define_action,
    get_action,
    list_actions,
    reset_registry,
    route_actions,
)
from .route_adapter import add_action_route, as_route
from .spec import (
    ERROR_CODES,
    ERROR_SEMANTICS,
    ActionError,
    ActionOutcome,
    ActionSpec,
    ErrorCode,
    ErrorSemantics,
    HttpRoute,
    error_semantics,
    validate_input,
)
from .tool_adapter import as_tool, to_tool_schema


def __getattr__(name: str) -> Any:
    """PEP 562 惰性导出 Permission：避免 import 期拉起 assistant_tools 包（防止 import 环）。"""
    if name == "Permission":
        from .spec import Permission

        return Permission
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ERROR_CODES",
    "ERROR_SEMANTICS",
    "ActionError",
    "ActionOutcome",
    "ActionSpec",
    "ErrorCode",
    "ErrorSemantics",
    "HttpRoute",
    "Permission",
    "action_names",
    "add_action_route",
    "as_route",
    "as_tool",
    "define_action",
    "error_semantics",
    "get_action",
    "list_actions",
    "reset_registry",
    "route_actions",
    "to_tool_schema",
    "validate_input",
]

# SPDX-License-Identifier: Apache-2.0
"""T28 的「旧实现委托」工具：把既有 FastAPI handler / 助手工具 handler 包成 ActionSpec.run。

迁移存量「路由 + 工具」对时，最大的风险不是写错代码，而是**重写一遍业务逻辑**导致两侧
行为漂移。本模块让 run 直接调用既有 handler（路由函数/工具函数），只做参数适配与结果转换：

- route_runner(module, func)：同步路由 handler 仍然是普通 Python 函数；按签名把
  ActionSpec 的 payload 拆成 path/query/body 参数调用它，data 直接作为路由响应体。
  领域错误照旧抛 HTTPException（路由错误形状保持），失败路径不经过契约层改写。
- tool_runner(module, func)：调用既有工具 handler（db, arguments dict），把 ToolResult
  转成 ActionOutcome（summary/text/link/changed 原样保留）。
- preview_runner(module, func)：调用既有 previews.preview_*。

边界：只支持同步 handler；带 Request/BackgroundTasks/UploadFile/File(...) 等特殊依赖、
或返回 Response/StreamingResponse 的路由不适用（这些对保留静态声明并登记 allowlist）。
"""

from __future__ import annotations

import importlib
import inspect
import typing
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from .spec import ActionError, ActionOutcome

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from ..assistant_tools.authorization import WritePreview

_DB_PARAM_NAMES = frozenset({"db", "session", "database"})


def load_callable(module_path: str, name: str) -> Any:
    """按点路径加载函数；找不到时给出可诊断的错误（迁移表写错时要立刻发现）。"""
    module = importlib.import_module(module_path)
    target = getattr(module, name, None)
    if target is None:
        raise ActionError("internal", f"迁移配置错误：{module_path}.{name} 不存在")
    return target


def _is_model(annotation: Any) -> bool:
    return isinstance(annotation, type) and issubclass(annotation, BaseModel)


def _is_session(annotation: Any) -> bool:
    text = str(annotation)
    return "Session" in text


def call_route_handler(handler: Any, db: Session, payload: BaseModel) -> Any:
    """按 handler 签名把 payload 展开成参数调用（body 模型参数会重新构造成对应模型）。"""
    signature = inspect.signature(handler)
    try:
        hints = typing.get_type_hints(handler)
    except Exception:  # noqa: BLE001 - 解析失败时退回原始注解
        hints = {}
    kwargs: dict[str, Any] = {}
    values = payload.model_dump(exclude_unset=True, mode="json")
    for name, parameter in signature.parameters.items():
        annotation = hints.get(name, parameter.annotation)
        if name in _DB_PARAM_NAMES or _is_session(annotation):
            kwargs[name] = db
            continue
        if _is_model(annotation):
            subset = {key: value for key, value in values.items() if key in annotation.model_fields}
            kwargs[name] = annotation.model_validate(subset)
            continue
        if name in type(payload).model_fields:
            kwargs[name] = getattr(payload, name)
            continue
        if parameter.default is not inspect.Parameter.empty:
            continue
        raise ActionError(
            "internal",
            f"迁移配置错误：无法为 {handler.__module__}.{handler.__name__} 提供参数 {name}",
        )
    return handler(**kwargs)


def route_runner(module_path: str, handler_name: str) -> Any:
    """生成 ActionSpec.run：直接调用既有路由 handler，data=其返回值。"""

    def run(db: Session, payload: BaseModel) -> ActionOutcome:
        handler = load_callable(module_path, handler_name)
        return ActionOutcome(data=call_route_handler(handler, db, payload))

    run.__doc__ = f"委托既有路由 handler {module_path}.{handler_name}"
    return run


def tool_runner(
    module_path: str,
    handler_name: str,
    *,
    # 形参同为 Any：理由见 spec.RunFunc（Callable 形参逆变，具体模型类型反而不被接受）。
    argument_map: Callable[[Any], dict[str, Any]] | None = None,
) -> Any:
    """生成 ActionSpec.run_tool：直接调用既有工具 handler，保留其 text/summary。

    argument_map：工具侧参数名与 input_model 字段名不一致时（例如路由路径参数 base_id
    对应旧工具参数 from_version），在这里把模型还原成旧 handler 期望的 dict。
    """

    def run(db: Session, payload: BaseModel) -> ActionOutcome:
        handler = load_callable(module_path, handler_name)
        if argument_map is not None:
            arguments = argument_map(payload)
        else:
            arguments = payload.model_dump(exclude_unset=True, mode="json")
        result = handler(db, arguments)
        return ActionOutcome(
            summary=getattr(result, "summary", ""),
            text=getattr(result, "text", ""),
            link=getattr(result, "link", ""),
            changed=bool(getattr(result, "changed", False)),
        )

    run.__doc__ = f"委托既有工具 handler {module_path}.{handler_name}"
    return run


def preview_runner(module_path: str, handler_name: str) -> Any:
    """生成 ActionSpec.preview：调用既有 previews.preview_*。"""

    def preview(db: Session, payload: BaseModel) -> WritePreview:
        handler = load_callable(module_path, handler_name)
        return handler(db, payload.model_dump(exclude_unset=True, mode="json"))

    preview.__doc__ = f"委托既有预览实现 {module_path}.{handler_name}"
    return preview


__all__ = [
    "call_route_handler",
    "load_callable",
    "preview_runner",
    "route_runner",
    "tool_runner",
]

# SPDX-License-Identifier: Apache-2.0
"""action 注册表（T27）：内存表 + 唯一性校验；**导入本模块不注册任何动作**。

**为什么显式注册而不是扫描目录**：注册顺序与 ``application_routers.ROUTERS`` 的路由顺序
一样是行为契约（见该文件行内注释），必须可整体审阅。动作在各自定义模块里显式
``define_action(...)``，本模块只保证"同名 / 同 method+path 不允许注册两次"（契约不双写）。
"""

from __future__ import annotations

from .spec import ActionSpec

_ACTIONS: dict[str, ActionSpec] = {}
_HTTP_ROUTES: dict[tuple[str, str], str] = {}


def define_action(spec: ActionSpec) -> ActionSpec:
    """注册一个动作并返回它；重名或同 HTTP method+path 直接拒绝（契约不允许双写）。"""
    if not isinstance(spec, ActionSpec):
        raise TypeError(f"define_action 只接受 ActionSpec：{type(spec)!r}")
    if spec.name in _ACTIONS:
        raise ValueError(f"action 重复注册：{spec.name}")
    if spec.http is not None:
        key = (spec.http.method, spec.http.path)
        owner = _HTTP_ROUTES.get(key)
        if owner is not None:
            raise ValueError(f"HTTP 路由重复注册：{key[0]} {key[1]}（已被 action {owner} 占用）")
    _ACTIONS[spec.name] = spec
    if spec.http is not None:
        _HTTP_ROUTES[(spec.http.method, spec.http.path)] = spec.name
    return spec


def get_action(name: str) -> ActionSpec | None:
    """按 name 取动作；未注册返回 None（调用方自己决定 404 语义）。"""
    return _ACTIONS.get(name)


def list_actions() -> tuple[ActionSpec, ...]:
    return tuple(_ACTIONS.values())


def action_names() -> tuple[str, ...]:
    return tuple(_ACTIONS)


def route_actions() -> tuple[ActionSpec, ...]:
    """带 HTTP 入口的动作。注册位置仍由 ``ROUTERS`` 显式决定，这里只提供枚举。"""
    return tuple(spec for spec in _ACTIONS.values() if spec.http is not None)


def reset_registry() -> None:
    """清空注册表。仅测试与"应用装配重建"使用：生产路径在启动时一次性注册。"""
    _ACTIONS.clear()
    _HTTP_ROUTES.clear()


__all__ = [
    "action_names",
    "define_action",
    "get_action",
    "list_actions",
    "reset_registry",
    "route_actions",
]

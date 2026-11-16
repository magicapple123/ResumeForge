# SPDX-License-Identifier: Apache-2.0
"""action 目录（T28 / RF-10）：聚合各域 ActionSpec，并把"构建"与"注册"彻底分开。

四个入口，职责各一句话：

- ``build_all_actions()``：**纯构建**。不读也不写注册表，可重复调用、无副作用、内容
  恒定；只读遍历（契约快照、工具清单对账、测试）用它。
- ``ensure_registered()``：**唯一的注册入口**。语义是"把当前所有动作注册进 registry，
  已经注册的跳过"，因此天然幂等；``reset_registry()`` 之后再调用一次即可把注册表完整
  恢复。注册顺序固定为 ``pilot_actions()`` 在前、其后按 domains 包模块名排序。
- ``all_actions()``：**兼容外壳**，新代码不要再用。等于 ``ensure_registered()`` 之后
  返回 ``{spec.name: spec}``，只为存量调用点（脚本、尚未迁移的 api 模块、测试）保留。
- ``registered_action()``：路由装配点的取值入口，等于"``ensure_registered()`` + 按名查，
  查不到直接抛"。

**为什么这么拆**（别改回"构建即注册"）：以前 ``define_action(...)`` 写在每个域构建器
里，于是"import/构建"就等于"注册"，每次聚合都得靠 ``get_action(...) is None`` 猜注册表
当前状态，``reset_registry()`` 之后能不能自愈取决于每个域自己写没写兜底——29 个域就有
29 份各自为政的猜测。现在"谁注册、什么时候注册、注册顺序"都收敛到
``ensure_registered()`` 一个函数里，可读、可审阅；构建器退化成纯函数（不许 import
registry，``tests/test_action_registry.py`` 用 AST 守着这条）。

领域模块放在 app/services/actions/domains/<domain>.py，暴露无参构建器
actions() -> dict[str, ActionSpec]（签名与 pilots.pilot_actions 一致，纯构建、可重入）。
本模块用 pkgutil 自动发现它们，因此新增一个域只需要新建一个模块文件，不需要改这个
聚合器（T28 并行迁移时避免共享文件冲突）。
"""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable
from typing import cast

from .registry import action_names, define_action, get_action
from .spec import ActionSpec

__all__ = [
    "all_actions",
    "build_all_actions",
    "domain_builders",
    "ensure_registered",
    "registered_action",
]


def domain_builders() -> list[Callable[[], dict[str, ActionSpec]]]:
    """导入并返回 domains 包下所有 actions() 构建器（按模块名排序，行为稳定）。"""
    from . import domains as domains_package

    builders: list[Callable[[], dict[str, ActionSpec]]] = []
    for info in sorted(pkgutil.iter_modules(domains_package.__path__), key=lambda item: item.name):
        module = importlib.import_module(f".domains.{info.name}", __package__)
        builder = getattr(module, "actions", None)
        if callable(builder):
            # getattr 的返回类型是 object；调用口径由各域模块的 actions() 约定（无参、
            # 返回 name -> ActionSpec），tests/test_actions_contract.py 逐个域校验。
            builders.append(cast("Callable[[], dict[str, ActionSpec]]", builder))
    return builders


def build_all_actions() -> dict[str, ActionSpec]:
    """纯构建全部动作（试点 + 各域），返回 name -> ActionSpec；**不触碰注册表**。

    顺序即行为契约：``pilot_actions()`` 在前，其后按 domains 包模块名排序（见
    ``ensure_registered`` 的说明）。返回值是新建的字典，调用方改它不会影响注册表。

    **重名在这里就报错**：改造前"同名不允许注册两次"由 ``define_action`` 保证，而
    构建不再经过注册表之后，两个域给出同名动作会被 ``dict.update()`` 静默覆盖（后
    者胜出，先者的实现消失且无人知道）。所以把这条守卫挪到构建期——它检查的是同一
    件事实（一个 name 只能有一份契约），只是发生得更早、信息更准。
    """
    from .pilots import pilot_actions

    specs: dict[str, ActionSpec] = {}
    for builder in [pilot_actions, *domain_builders()]:
        for name, spec in builder().items():
            if name in specs:
                raise ValueError(f"action 重复定义：{name}（多个构建器给出了同名动作）")
            if name != spec.name:
                raise ValueError(f"构建器字典的键与动作名不一致：{name} != {spec.name}")
            specs[name] = spec
    return specs


def ensure_registered() -> tuple[ActionSpec, ...]:
    """把当前全部动作注册进 registry（已注册的跳过），返回按契约顺序排列的动作。

    幂等：连调多次不会重复注册，也不会抛"action 重复注册"。``reset_registry()`` 之后
    调用可把注册表完整恢复成与进程启动时一致的 name 序列。

    注册顺序是行为契约（与 ``application_routers.ROUTERS`` 的路由顺序同理）：路由注册
    顺序决定 OpenAPI 文档里的顺序与 FastAPI 的匹配优先级，所以顺序只在
    ``build_all_actions()`` 里定义一次，本函数按它的顺序注册。
    """
    specs = build_all_actions()
    registered = set(action_names())
    for spec in specs.values():
        if spec.name not in registered:
            define_action(spec)
    return tuple(specs.values())


def all_actions() -> dict[str, ActionSpec]:
    """**兼容入口**：新代码请用 ``build_all_actions()`` 或 ``ensure_registered()``。

    等价于 ``{spec.name: spec for spec in ensure_registered()}``。保留它只是因为存量
    调用点还在用（脚本、尚未迁移的 api 模块、契约测试的收尾自愈）；它仍然会注册动作，
    但那是 ``ensure_registered()`` 的语义，不是"构建"的语义。
    """
    return {spec.name: spec for spec in ensure_registered()}


def registered_action(name: str) -> ActionSpec:
    """取一个动作并保证它已注册（必要时先 ``ensure_registered()``）；名字不存在即抛。

    供路由装配点使用：``add_action_route(router, registered_action("x"))``。之所以不
    直接暴露 ``get_action()``，是因为它返回 ``ActionSpec | None``，而装配期漏注册是
    bug——这里让它在 import 期就以 ``KeyError`` 失败，而不是把 ``None`` 传下去。
    """
    ensure_registered()
    spec = get_action(name)
    if spec is None:
        raise KeyError(f"未注册的 action：{name}")
    return spec

# SPDX-License-Identifier: Apache-2.0
"""action 目录（T28）：把各域 ActionSpec 聚合到同一个注册表。

领域模块放在 app/services/actions/domains/<domain>.py，暴露一个无参构建器
actions() -> dict[str, ActionSpec]（签名与 pilots.pilot_actions 一致，幂等、可重入）。
本模块用 pkgutil 自动发现 domains 包下的模块并逐个调用，因此新增一个域只需要新建
一个模块文件，不需要改这个聚合器（T28 并行迁移时避免共享文件冲突）。

所有构建器都会在第一次执行时把 ActionSpec 注册进 registry；测试 reset_registry() 之后
调用 all_actions() 即可完整自愈。
"""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable
from typing import cast

from .registry import define_action, get_action
from .spec import ActionSpec

__all__ = ["all_actions", "domain_builders"]


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


def all_actions() -> dict[str, ActionSpec]:
    """构建并注册全部动作（试点 + 各域），返回 name -> ActionSpec。"""
    from .pilots import pilot_actions

    specs: dict[str, ActionSpec] = dict(pilot_actions())
    for builder in domain_builders():
        specs.update(builder())
    # 注册表可能被 reset_registry() 清空；构建器通常已自愈，这里再兜底一次。
    for name, spec in specs.items():
        if get_action(name) is None:
            define_action(spec)
    return specs

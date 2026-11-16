# SPDX-License-Identifier: Apache-2.0
"""RF-10 守卫：action 的"构建"与"注册"必须彻底分开。

改造前每个域的构建器里都写着 ``define_action(...)``，于是"import/构建"就等于"注册"，
每次聚合都要靠 ``get_action(...) is None`` 猜注册表当前状态；``reset_registry()`` 之后
能不能自愈，取决于 29 个域各自写没写兜底。现在：

- ``build_all_actions()``：纯构建，不读不写注册表，可重复调用、内容恒定；
- ``ensure_registered()``：唯一的注册入口，幂等，``reset_registry()`` 后可完整恢复；
- ``all_actions()``：兼容外壳（= ``ensure_registered()`` 后按 name 建字典），不再新增使用；
- ``registered_action()``：路由装配点的取值入口（先注册、再按名取、取不到就抛）。

本文件钉住五条判据（判据编号与任务书一致）：

1. ``build_all_actions()`` 两次调用 name 序列一致，且**不改变注册表**；
2. ``ensure_registered()`` 幂等：连调两次不抛、结果相等、不产生重复；
3. ``reset_registry()`` → ``ensure_registered()`` 能完整恢复（数量与 name 序列与初始一致）；
4. **AST 判据**：``app/services/actions/domains/*.py`` 里不得出现 ``define_action`` /
   ``get_action`` / ``reset_registry`` 的引用（构建器必须是纯函数）；
5. 注册顺序契约：``pilot_actions()`` 全部排在域动作之前，域动作按模块名排序分块。

判据 4 的价值在于它挡的是"改回去"：只要有人给某个域加回 ``define_action(...)``，
"import 即注册"的半副作用就又回来了，而判据 1/2/3 全都会继续通过（注册是可重入的）。
所以第 4 条必须存在，且失败信息要点名具体文件。

**注册表是进程级单例**：本文件会 ``reset_registry()``，用例结束必须把它还给后续文件
（同上一个 worker 里可能连跑多个测试文件），否则别的守卫会看到空表而误红。
"""

from __future__ import annotations

import ast
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from app.services.actions import (
    action_names,
    list_actions,
    reset_registry,
)
from app.services.actions import domains as domains_package
from app.services.actions.catalog import (
    all_actions,
    build_all_actions,
    domain_builders,
    ensure_registered,
    registered_action,
)
from app.services.actions.pilots import pilot_actions
from app.services.actions.spec import ActionSpec

BuildFn = Callable[[], dict[str, ActionSpec]]


# ----------------------------- 夹具 -----------------------------


@pytest.fixture(autouse=True)
def _registry_baseline() -> Iterator[None]:
    """每个用例都从"进程启动时的完整注册表"出发，结束后把共享表还回去。"""
    reset_registry()
    ensure_registered()
    yield
    reset_registry()
    ensure_registered()


def _fingerprint(specs: dict[str, ActionSpec]) -> list[tuple[object, ...]]:
    """把一组动作压成可比较的形状：名称、描述、权限、路由、服务入口逐项对齐。"""
    return [
        (
            name,
            spec.description,
            spec.permission,
            spec.service_entry,
            spec.http.method if spec.http is not None else None,
            spec.http.path if spec.http is not None else None,
        )
        for name, spec in specs.items()
    ]


# ----------------------------- 判据 1：构建是纯函数 -----------------------------


def test_build_all_actions_is_deterministic() -> None:
    first = build_all_actions()
    second = build_all_actions()
    assert list(first) == list(second)
    assert _fingerprint(first) == _fingerprint(second)
    # 反空转：真拿到了动作，不是两个空字典相等。
    assert len(first) >= 70


def test_build_all_actions_keeps_its_hands_off_the_registry() -> None:
    reset_registry()
    assert action_names() == ()

    specs = build_all_actions()

    # 只构建不注册：注册表仍然空着，连名字都不该有。
    assert action_names() == ()
    assert list_actions() == ()
    assert len(specs) >= 70

    # 再来一次也一样（纯函数，不因为"已经构建过"而写表）。
    build_all_actions()
    assert action_names() == ()


# ----------------------------- 判据 2：注册是幂等的 -----------------------------


def test_ensure_registered_is_idempotent() -> None:
    reset_registry()
    first = ensure_registered()
    names_after_first = action_names()

    second = ensure_registered()  # 不抛"action 重复注册"才算幂等

    assert action_names() == names_after_first
    assert [spec.name for spec in second] == [spec.name for spec in first]
    assert second == first
    # 没有重复注册：名字序列里每个 name 只出现一次。
    assert len(set(names_after_first)) == len(names_after_first)


def test_ensure_registered_skips_names_that_are_already_taken() -> None:
    """幂等的实现口径是"跳过已注册的"，而不是"清表重来"。"""
    before = registered_action("list_claims")
    again = ensure_registered()
    assert registered_action("list_claims") is before
    assert "list_claims" in {spec.name for spec in again}


def test_all_actions_is_only_a_compat_shell_over_ensure_registered() -> None:
    reset_registry()
    shell = all_actions()
    assert action_names() == tuple(shell)
    assert [spec.name for spec in ensure_registered()] == list(shell)
    for name, spec in shell.items():
        assert spec.name == name
        assert registered_action(name) is spec


# ----------------------------- 判据 3：reset 之后能完整恢复 -----------------------------


def test_reset_then_ensure_restores_the_whole_registry() -> None:
    baseline_names = action_names()
    baseline_specs = list_actions()
    assert len(baseline_names) >= 70  # 反空转：初始状态确实是"已注册全部动作"

    reset_registry()
    assert action_names() == ()
    assert list_actions() == ()

    ensure_registered()

    assert action_names() == baseline_names
    assert len(list_actions()) == len(baseline_specs)
    assert list_actions() == baseline_specs  # 恢复的是同一批对象，不是重新造了一批
    assert all(registered_action(name) is not None for name in baseline_names)


# ----------------------------- 判据 4：构建器里不许出现注册表 -----------------------------

DOMAINS_DIR = Path(domains_package.__file__).resolve().parent
FORBIDDEN_SYMBOLS = frozenset({"define_action", "get_action", "reset_registry"})
# 构建器所在的模块：29 个域 + pilots（试点动作的构建器是同一个契约）。
BUILDER_MODULES = sorted(
    [*(DOMAINS_DIR.glob("*.py")), Path(pilot_actions.__code__.co_filename).resolve()]
)


def _registry_offences(source: str, label: str) -> list[str]:
    """返回该文件里所有"碰注册表"的位置（行号 + 符号），空列表表示干净。"""
    tree = ast.parse(source, filename=label)
    offences: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in FORBIDDEN_SYMBOLS:
            offences.append(f"{label}:{node.lineno}: {node.id}")
        elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_SYMBOLS:
            offences.append(f"{label}:{node.lineno}: .{node.attr}")
        elif isinstance(node, ast.ImportFrom) and (node.module or "").endswith("registry"):
            relative = "." * node.level + (node.module or "")
            offences.append(f"{label}:{node.lineno}: from {relative} import ...")
        elif isinstance(node, ast.Import):
            offences.extend(
                f"{label}:{node.lineno}: import {alias.name}"
                for alias in node.names
                if alias.name.endswith("registry")
            )
    return offences


def test_domain_builders_never_touch_the_registry() -> None:
    """构建器必须是纯函数：一旦 import/构建就注册，"构建与注册分离"就名存实亡。"""
    assert len(BUILDER_MODULES) >= 30, [path.name for path in BUILDER_MODULES]

    offences: list[str] = []
    for path in BUILDER_MODULES:
        offences.extend(_registry_offences(path.read_text(encoding="utf-8"), path.name))

    assert offences == [], (
        "构建器里出现了注册表引用（构建与注册必须分离：注册只允许在 "
        "catalog.ensure_registered() 一处发生）：\n" + "\n".join(offences)
    )


def test_registry_offence_scanner_catches_define_action() -> None:
    """反空转：扫描器对"改回去"的写法必须真的报错（否则判据 4 是摆设）。"""
    poisoned = (
        "from ..registry import define_action\n"
        "\n"
        "def actions():\n"
        "    return {spec.name: spec for spec in (define_action(SENTINEL),)}\n"
    )
    offences = _registry_offences(poisoned, "poisoned.py")
    assert len(offences) == 2  # import 行 + define_action 调用
    assert all(item.startswith("poisoned.py:") for item in offences)


# ----------------------------- 判据 5：注册顺序契约 -----------------------------


def _builder_pairs() -> list[tuple[str, BuildFn]]:
    """(模块名, 构建器) —— 模块名从生产用的发现函数里取，不另写一份发现逻辑。"""
    pairs: list[tuple[str, BuildFn]] = []
    for builder in domain_builders():
        pairs.append((builder.__module__.rsplit(".", 1)[-1], builder))
    return pairs


def test_pilot_actions_come_before_every_domain_action() -> None:
    pilot_names = list(pilot_actions())
    assert len(pilot_names) >= 1  # 反空转

    names = list(action_names())
    assert names[: len(pilot_names)] == pilot_names

    domain_names = set(names[len(pilot_names) :])
    assert domain_names.isdisjoint(pilot_names), "试点动作不得出现在域动作区段"


def test_domain_actions_follow_sorted_module_names() -> None:
    """域动作按模块名排序分块——这条是顺序契约的另一半，不写死完整名单。"""
    pairs = _builder_pairs()
    module_names = [name for name, _ in pairs]
    assert module_names == sorted(module_names)
    assert len(module_names) >= 29  # 反空转：29 个域都在

    expected_tail = [name for _, builder in pairs for name in builder()]
    assert expected_tail  # 反空转

    names = list(action_names())
    assert names == [*pilot_actions(), *expected_tail]


def test_registered_order_matches_build_order_exactly() -> None:
    """注册顺序就是构建顺序：任何"注册时重排"都会让 OpenAPI 顺序与构建口径分叉。"""
    assert list(action_names()) == list(build_all_actions())
    assert len(set(action_names())) == len(action_names())


# ----------------------------- 构建期的不双写守卫 -----------------------------


def test_duplicate_action_name_across_builders_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """构建与注册分离后，重名不能再靠 define_action 兜底——必须在这里就报错。"""
    from app.services.actions import catalog

    sample = next(iter(pilot_actions().values()))

    def fake_builder_a() -> dict[str, ActionSpec]:
        return {sample.name: sample}

    def fake_builder_b() -> dict[str, ActionSpec]:
        return {sample.name: sample}

    # 用 context() 而不是直接 setattr：补丁必须在**本用例返回前**撤掉，否则
    # 用例结束时的注册表复原（autouse 夹具）会拿到假构建器而误报重复定义。
    with monkeypatch.context() as patched:
        patched.setattr(catalog, "domain_builders", lambda: [fake_builder_a, fake_builder_b])
        with pytest.raises(ValueError, match=sample.name):
            build_all_actions()

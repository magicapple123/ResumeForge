# SPDX-License-Identifier: Apache-2.0
"""RF-03 守卫：动作层不得把 ``run`` 委托给路由 handler（旧实现委托范式的退场口径）。

## 为什么要守

``legacy.route_runner("app.api.X", "handler")`` 让动作直接调用**路由 handler**。代价是
同一段业务逻辑同时"长在 api 层"又被动作调用：路由没法变薄，改一处容易漏另一处。
RF-03a 把 25 处改到 7 处，RF-03b 把剩下的 7 处（resumes 家族 crud / versions /
layout_render）全部改成"动作直接调服务层、路由 handler 变薄壳"，本文件钉住
"不许再涨回来"。

## 三条判据

1. **计数上限**：``app/services/actions/domains/*.py`` 里 ``route_runner(...)`` 的
   **调用点数**不得超过 ``_MAX_ROUTE_RUNNERS``。阈值贴在**实测值**上而不是留余量：
   留一个的余量就等于允许"再塞一个进去而没人发现"。RF-03b 之后实测是 0。
2. **不许再 import**：domain 模块不得 ``from ..legacy import route_runner``（或别名）。
   计数为 0 之后单靠判据 1 只能证明"现在没调用"，证明不了"没人把它导回来备用"；
   这一条把"先 import 再慢慢用"的路也堵掉。
3. **剩余目标逐个点名**：``_REMAINING_TARGETS`` 与实测集合**双向**比对。它现在是空集
   （已全部迁完），但仍必须逐个登记：计数没涨却换了个目标的情况不会发生，而"某处被
   人写回 route_runner 却忘了登记"会被判据 1 与判据 3 同时点名。

另加一条方向判据：动作模块**不得直接 import app.api 下的任何模块**。动作层一旦能直接拿到
api 符号，"路由与动作共用同一个服务函数"就没有结构上的保证，只靠评审。

## 反证要求

按 ``docs/verification-playbook.md`` §3：把某处改回 ``route_runner(...)``，判据必须
**精确**变红（点名到文件/行号与目标），逐字节复原后复绿。没有做过反证的守卫只能证明
"当前产物长这样"。
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND / "app"
ACTIONS_DIR = APP_DIR / "services" / "actions"
DOMAINS_DIR = ACTIONS_DIR / "domains"

#: RF-03b 收尾后的实测调用点数：0（原 25 处 → RF-03a 的 7 处 → 本批的 0 处）。
#: 阈值按实测值贴死，任何新增都会先撞这一条。
_MAX_ROUTE_RUNNERS = 0

#: 剩余的 ``route_runner(模块, 函数)`` 目标，逐条登记（"改了哪一处"必须显式可见）。
#: RF-03b 之后**已清空**：7 处全部迁到"动作直接调服务层"。留空集而不是删掉变量，
#: 是为了让双向比对那一条继续工作——将来若有人写回一处，判据 1 与判据 3 同时红。
_REMAINING_TARGETS: frozenset[tuple[str, str]] = frozenset()

#: 扫描面自检下限：低于它说明 glob/parse 口径失效（守卫会静默空转）。
_MIN_DOMAIN_MODULES = 25

#: 旧实现委托的入口符号名：出现即视为"又准备把 run 委托回 api 层"。
_LEGACY_RUNNER_SYMBOL = "route_runner"


@dataclass(frozen=True)
class RouteRunnerCall:
    """一处 ``route_runner(模块, 函数)`` 调用点。"""

    file: str  # 相对 ``backend`` 的 posix 路径
    lineno: int
    target: tuple[str, str]  # (模块点路径, 函数名)


def _rel(path: Path) -> str:
    return path.relative_to(BACKEND).as_posix()


def _domain_modules() -> list[Path]:
    return sorted(DOMAINS_DIR.glob("*.py"))


def _is_route_runner_call(node: ast.AST) -> bool:
    """``route_runner(...)`` 调用（含 ``_contract_errors(route_runner(...))`` 这类内嵌）。"""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "route_runner"
    )


def _route_runner_calls() -> list[RouteRunnerCall]:
    """扫 ``domains/*.py`` 的全部 ``route_runner(...)`` 调用点（含参数里的两个字面量）。"""
    calls: list[RouteRunnerCall] = []
    for path in _domain_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not _is_route_runner_call(node):
                continue
            call = node
            args = call.args  # type: ignore[attr-defined] - 已由 _is_route_runner_call 收窄
            module = args[0].value if args and isinstance(args[0], ast.Constant) else "?"
            handler = args[1].value if len(args) > 1 and isinstance(args[1], ast.Constant) else "?"
            calls.append(
                RouteRunnerCall(
                    file=_rel(path),
                    lineno=call.lineno,  # type: ignore[attr-defined]
                    target=(str(module), str(handler)),
                )
            )
    return calls


def _absolute_module(path: Path, node: ast.ImportFrom) -> str:
    """把 ``from ...api.x import y`` 解析成绝对模块路径（与 import_direction 守卫同口径）。"""
    if not node.level:
        return node.module or ""
    package = path.parent.relative_to(APP_DIR.parent).parts
    base = package[: len(package) - (node.level - 1)]
    return ".".join([*base, node.module]) if node.module else ".".join(base)


def test_scan_reaches_action_modules() -> None:
    """守卫不能空转：扫不到 domain 模块时下面两条永远绿。"""
    modules = _domain_modules()
    assert len(modules) >= _MIN_DOMAIN_MODULES, (
        f"只扫到 {len(modules)} 个动作域模块（下限 {_MIN_DOMAIN_MODULES}），扫描口径可能已经失效"
    )


def test_route_runner_usage_stays_under_the_ceiling() -> None:
    """``route_runner(...)`` 调用点数不得超过上限（RF-03：不许把业务再委托回 api 层）。"""
    calls = _route_runner_calls()
    listing = "\n".join(
        f"  - {item.file}:{item.lineno} -> {item.target[0]}.{item.target[1]}" for item in calls
    )
    assert len(calls) <= _MAX_ROUTE_RUNNERS, (
        f"动作层出现 {len(calls)} 处 route_runner(...)（上限 {_MAX_ROUTE_RUNNERS}）。"
        "新写的动作必须直接调服务层（services/**），路由 handler 只做薄壳；"
        "确有必要保留旧实现委托时，请连同本文件的清单与上限一起评审：\n" + listing
    )


def test_domain_modules_do_not_import_the_legacy_runner() -> None:
    """计数归零之后还要堵住"先 import 进来备用"这条路。

    只钉调用点数时，``from ..legacy import route_runner`` 可以先静静躺着，
    下一次改动"顺手用一下"就没有任何结构阻力。这里把导入本身也判红。
    """
    offenders: list[str] = []
    for path in _domain_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name == _LEGACY_RUNNER_SYMBOL:
                        offenders.append(f"{_rel(path)}:{node.lineno} -> {alias.name}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.rsplit(".", 1)[-1] == _LEGACY_RUNNER_SYMBOL:
                        offenders.append(f"{_rel(path)}:{node.lineno} -> {alias.name}")
    assert offenders == [], (
        f"动作域模块 import 了 {_LEGACY_RUNNER_SYMBOL}（旧实现委托的入口）。"
        "RF-03b 之后动作层一律直接调服务层（services/**），路由 handler 只做薄壳；"
        "确有必要恢复旧范式时，请连同本文件的清单与上限一起评审：\n"
        + "\n".join(f"  - {item}" for item in offenders)
    )


def test_remaining_route_runner_targets_are_named() -> None:
    """剩余的每一处都必须在清单里逐条登记（双向比对，只钉数量不钉身份等于没有守卫）。"""
    found = {item.target for item in _route_runner_calls()}
    unexpected = sorted(found - _REMAINING_TARGETS)
    missing = sorted(_REMAINING_TARGETS - found)
    details = []
    if unexpected:
        details.append(
            "出现了未登记的目标（要么新增了旧实现委托，要么登记清单没跟上）：\n"
            + "\n".join(f"  - {module}.{handler}" for module, handler in unexpected)
        )
    if missing:
        details.append(
            "清单里的目标已经不存在（迁移完成后请从 _REMAINING_TARGETS 删掉）：\n"
            + "\n".join(f"  - {module}.{handler}" for module, handler in missing)
        )
    assert details == [], "\n".join(details)


def test_action_modules_do_not_import_api() -> None:
    """动作层不得直接 import ``app.api.*``：业务只能经服务层复用。"""
    offenders: list[str] = []
    for path in _domain_modules():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                module = _absolute_module(path, node)
                if module == "app.api" or module.startswith("app.api."):
                    offenders.append(f"{_rel(path)}:{node.lineno} -> {module}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "app.api" or alias.name.startswith("app.api."):
                        offenders.append(f"{_rel(path)}:{node.lineno} -> {alias.name}")
    assert offenders == [], (
        "动作模块直接 import 了 api 层（应改为引用 services 层的服务函数）：\n"
        + "\n".join(f"  - {item}" for item in offenders)
    )

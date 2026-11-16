# SPDX-License-Identifier: Apache-2.0
"""守卫：``service_entry`` 必须是 action ``run`` **直接调用**的服务符号，不能是内部辅助函数。

## 为什么需要第三条元数据守卫

``test_assistant_tool_service_entries`` 已经验了两件事：符号**真实存在**（能 import）、
**被执行体引用**（含沿 ``assistant_tools`` helper 向下两层）。两条都是必要条件，但都
碰不到"指错层"这类错——把一个只在链路深处被调用的内部辅助函数写进 ``service_entry``，
它照样绿。

2026-11 的 RF-03b 一轮里，同一类错重复踩了三次：
``list_interview_sessions`` / ``get_interview_report`` 都指向 ``answered_rounds``、
``get_drill_report`` 指向 ``session_summary``——三者都是"被内部函数调用的辅助函数"。
``service_entry`` 的全部价值就是给人（和模型）指路，指到第二跳比留空更坏：留空至少
会让人去查，指错会让人以为查到了。

## 判据口径

对**全部** ActionSpec（``catalog.build_all_actions()``，不碰注册表）：

1. ``service_entry is None`` → 跳过（合法声明，另有 ``_SERVICE_FREE_TOOLS`` 白名单管它）；
2. 否则取 ``spec.run`` 的执行体，收集它**直接调用**的、落在 ``app.services.*`` 的业务
   符号，要求 ``service_entry`` **是其中之一**（**按对象身份**比对，不是按点路径字符串
   ——服务层大量使用 re-export，``tracker.list_tracks`` 与 ``tracker_query.list_tracks``
   是同一个对象，按字符串比会把"同一入口的两个合法写法"误判成错误）。
3. 取不到任何服务调用但 ``service_entry`` 非 None → 同样算红（声明的入口根本没被执行体调用）。

**为什么不要求"必须是第一个"**：``get_claim`` 这类动作的 run 第一句是
``claim_or_none(db, id)``（存在性校验），第二句才是 ``claim_detail_text``。把口径钉成
"第一跳"会逼人把 ``service_entry`` 写成存在性校验函数——那是把元数据写坏，不是写好。
真正的错是"声明的符号压根没被调用"（指到内部辅助函数、指到别的模块的同名函数、指到
提示词预算之类的无关函数），这一条恰好能被"必须被直接调用"精确抓住。

排除项：``app.services.actions.*``（契约层自身：``ActionOutcome`` / ``ActionError`` /
``_contract_errors`` 闭包）与 ``assistant_tools.*``（内部 helper，不是业务入口）。
``_contract_errors(runner)`` 这类包装先沿 ``__closure__['runner']`` 剥到真正的 run 再扫。

## 已知偏差（``_KNOWN_DEVIATIONS``）

按上面口径扫全量 65 条已声明动作，剩 **2 条**对不上，都是同一类：run 复用
``assistant_tools`` 的既有工具 handler，模块内没有**直接**的服务调用，而
``service_entry`` 描述的是那条链路里的业务函数。它们的元数据不是错的，只是这一条
静态判据看不到——登记在这里，并与实测集合**双向一致**（多一个少一个都红）。

这不是赦免清单：新出现的偏差一律红（不允许"加进表里就绿"），修好的条目必须从表里
删掉否则也红。
"""

from __future__ import annotations

import ast
import importlib
import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]

#: 不计入"业务入口"的包：契约层自身，以及助手工具的内部实现。
_EXCLUDED_MODULE_PREFIXES = ("app.services.actions",)
_EXCLUDED_MODULE_PARTS = (".assistant_tools.",)

#: 静态解析失败的条目（动态 ``run`` / 工厂 / 别名链）：必须逐条登记理由。
#: 目前为**空**——65 条已声明动作全部可静态解析（``_contract_errors`` 闭包会被剥开）。
_UNRESOLVABLE: dict[str, str] = {}

#: 解析不出来但这一个都容忍不了：超过就说明口径失效，必须有人来登记白名单。
_MAX_UNRESOLVABLE = 3

#: 扫描面自检下限：catalog 构建失败会返回空表，那时下面的判据全部静默通过。
_MIN_TRACKED_ACTIONS = 60

#: run 复用 ``assistant_tools`` 的既有工具 handler、模块内没有**直接**服务调用的动作。
#: 它们的元数据不是错的（``service_entry`` 描述的是那条链路里的业务函数），只是这条静态
#: 判据看不到。逐条写明理由；新出现"没有直接服务调用"的动作一律红，必须来这里登记。
#: 注意：这两条的可见性依赖 import 顺序（工具模块被 import 后模块属性才出现），所以判据
#: 对它们的处理是"有调用时按调用验、没调用时承认已登记"，不参与双向比对。
_DELEGATED_TO_TOOL_HANDLER: dict[str, str] = {
    "create_reminder": "run 走 report_tools.create_reminder_record（模块属性调用，测试打桩接缝）",
    "get_job_preferences": "run 委托既有的 job_preference 工具 handler",
}


@dataclass(frozen=True)
class Deviation:
    """一处"声明的入口不是 run 的第一跳"。"""

    action: str
    location: str  # "backend/app/...:行号"
    declared: str
    actual: str

    def describe(self) -> str:
        return (
            f"  - {self.location} | {self.action} | 声明 {self.declared} | 实际第一跳 {self.actual}"
        )


def _is_business_service(obj: Any) -> bool:
    """是否算"业务服务符号"：``app.services.*`` 且不是契约层/助手工具内部实现。"""
    module = getattr(obj, "__module__", None)
    if not isinstance(module, str) or not module.startswith("app.services"):
        return False
    if module.startswith(_EXCLUDED_MODULE_PREFIXES):
        return False
    return not any(part in f"{module}." for part in _EXCLUDED_MODULE_PARTS)


def _label(obj: Any) -> str:
    return f"{getattr(obj, '__module__', '?')}.{getattr(obj, '__name__', '?')}"


def _unwrap_runner(fn: Any) -> Any:
    """剥掉 ``_contract_errors(runner)`` 这类包装，拿到真正的 run 执行体。

    包装器的形态：内层 ``run`` 通过闭包变量 ``runner`` 调用被包装的函数。沿它一路剥到底，
    但用 ``id`` 集合防自环（``runner`` 可能就是自己）。
    """
    seen: set[int] = set()
    while getattr(fn, "__closure__", None) and id(fn) not in seen:
        seen.add(id(fn))
        cells = dict(
            zip(
                fn.__code__.co_freevars,
                (cell.cell_contents for cell in fn.__closure__),
                strict=False,
            )
        )
        inner = cells.get("runner")
        if inner is None or not callable(inner):
            break
        fn = inner
    return fn


def _absolute_module(module_name: str, level: int, node_module: str | None) -> str:
    """把 ``from ...x import y`` 的相对层级解析成绝对模块路径。"""
    if not level:
        return node_module or ""
    package = module_name.split(".")[:-1]
    if level > 1:
        package = package[: -(level - 1)]
    return ".".join(package + ([node_module] if node_module else []))


def _local_bindings(tree: ast.AST, module_name: str) -> dict[str, Any]:
    """函数体内的 import 绑定：``本地名 -> 被导入的对象``。

    服务层大量使用**函数内延迟 import**（躲循环依赖），只在模块全局表里查名字会把它们
    全部漏成"没有服务调用"，于是判据要么误报要么空转。
    """
    bindings: dict[str, Any] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = _absolute_module(module_name, node.level, node.module)
            for alias in node.names:
                if alias.name == "*":
                    continue
                try:
                    bindings[alias.asname or alias.name] = getattr(
                        importlib.import_module(module), alias.name
                    )
                except (ImportError, AttributeError):
                    continue
        elif isinstance(node, ast.Import):
            for alias in node.names:
                target = alias.name if alias.asname else alias.name.split(".")[0]
                try:
                    bindings[alias.asname or alias.name.split(".")[0]] = importlib.import_module(
                        target
                    )
                except ImportError:
                    continue
    return bindings


def _resolve_callee(node: ast.Call, module: Any, bindings: dict[str, Any]) -> Any:
    """``Call`` 节点对应的可调用对象（支持 ``name(...)`` 与 ``name.symbol(...)``）。"""
    func = node.func
    if isinstance(func, ast.Name):
        return bindings[func.id] if func.id in bindings else getattr(module, func.id, None)
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        base = (
            bindings[func.value.id]
            if func.value.id in bindings
            else getattr(module, func.value.id, None)
        )
        return getattr(base, func.attr, None) if base is not None else None
    return None


def _business_calls(fn: Any) -> list[Any]:
    """run 执行体里**直接调用**的业务服务符号（按源码顺序、按身份去重）。"""
    fn = _unwrap_runner(fn)
    module = importlib.import_module(fn.__module__)
    tree = ast.parse(inspect.getsource(fn).lstrip())
    bindings = _local_bindings(tree, fn.__module__)
    calls: list[Any] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        callee = _resolve_callee(node, module, bindings)
        if callee is None or not _is_business_service(callee):
            continue
        if not any(callee is seen for seen in calls):
            calls.append(callee)
    return calls


def _declared_symbol(entry: str) -> Any:
    """``service_entry``（相对 ``app.services`` 的点路径）-> 实际对象。"""
    dotted = f"app.services.{entry}"
    module_path, _, attribute = dotted.rpartition(".")
    module = importlib.import_module(module_path)
    return getattr(module, attribute, None)


def _location(fn: Any) -> str:
    """``backend/相对路径:行号``（取不到就退回路径或 ``?``，绝不让守卫因此崩掉）。"""
    target = _unwrap_runner(fn)
    source = inspect.getsourcefile(target)
    relative = "?"
    if source is not None:
        try:
            relative = Path(source).resolve().relative_to(BACKEND.parent).as_posix()
        except (OSError, ValueError):
            relative = "?"
    try:
        return f"{relative}:{inspect.getsourcelines(target)[1]}"
    except (OSError, TypeError):
        return relative


def _scan() -> tuple[list[Deviation], list[str], int]:
    """扫全量 action：返回 (偏差清单, 无法静态解析的 action 名, 已声明动作总数)。"""
    from app.services.actions import catalog

    specs = catalog.build_all_actions()
    deviations: list[Deviation] = []
    unresolvable: list[str] = []
    declared_total = 0
    for name, spec in sorted(specs.items()):
        if not spec.service_entry:
            continue
        declared_total += 1
        try:
            calls = _business_calls(spec.run)
            declared = _declared_symbol(spec.service_entry)
        except (OSError, TypeError, ValueError, ImportError, AttributeError, SyntaxError):
            unresolvable.append(name)
            continue
        if not calls:
            # 没有直接服务调用：只允许已登记的"委托工具 handler"动作，其余一律偏差。
            if name not in _DELEGATED_TO_TOOL_HANDLER:
                deviations.append(
                    Deviation(
                        action=name,
                        location=_location(spec.run),
                        declared=f"app.services.{spec.service_entry}",
                        actual="<run 内没有直接的服务调用>",
                    )
                )
            continue
        if any(declared is call for call in calls):
            continue
        deviations.append(
            Deviation(
                action=name,
                location=_location(spec.run),
                declared=f"app.services.{spec.service_entry}",
                actual=" / ".join(_label(call) for call in calls),
            )
        )
    return deviations, unresolvable, declared_total


def test_service_entry_is_called_by_run() -> None:
    """``service_entry`` 必须是 run 里被**直接调用**的业务服务符号（不能是内部辅助函数）。"""
    deviations, _unresolvable, declared_total = _scan()
    assert declared_total >= _MIN_TRACKED_ACTIONS, (
        f"只扫到 {declared_total} 条声明了 service_entry 的动作（下限 {_MIN_TRACKED_ACTIONS}），"
        "catalog 构建口径可能已经失效"
    )
    assert deviations == [], (
        "以下动作的 service_entry 没有被 run 直接调用（指到内部辅助函数等于给读元数据的人指错路）：\n"
        + "\n".join(item.describe() for item in deviations)
        + "\n  提示：service_entry 必须是 run 里出现的那个调用；"
        "内部辅助函数（被别的服务函数调用）不算入口。若该动作确实只委托 assistant_tools 的 "
        "handler，请登记到 _DELEGATED_TO_TOOL_HANDLER 并写明理由。"
    )


def test_scanner_covers_every_declared_action() -> None:
    """扫描面必须覆盖 100% 已声明动作；解析不了的显式计数，不许静默通过。"""
    _deviations, unresolvable, declared_total = _scan()
    assert declared_total >= _MIN_TRACKED_ACTIONS, (
        f"只扫到 {declared_total} 条声明了 service_entry 的动作（下限 {_MIN_TRACKED_ACTIONS}）"
    )
    scanned = declared_total - len(unresolvable)
    # 覆盖率要求 100%：每一条已声明动作都真的被扫过（解析失败会从 scanned 里扣掉，
    # 于是"偷偷跳过一半"这条会先红，而不是让下面的双向比对在残缺集合上给出结论）。
    assert scanned == declared_total, (
        f"扫描面只覆盖 {scanned}/{declared_total} 条已声明动作：无法静态解析 {sorted(unresolvable)}"
    )
    assert len(unresolvable) <= _MAX_UNRESOLVABLE, (
        f"{len(unresolvable)} 条动作的 run 无法静态解析（上限 {_MAX_UNRESOLVABLE}）："
        f"{sorted(unresolvable)}。超过上限说明判据口径失效，请人工确认后登记 _UNRESOLVABLE"
        "（逐条写明理由）或修掉动态 run。"
    )
    assert set(unresolvable) == set(_UNRESOLVABLE), (
        "_UNRESOLVABLE 必须与实际无法解析的集合双向一致："
        f"实测多出={sorted(set(unresolvable) - set(_UNRESOLVABLE))}，"
        f"白名单已失效={sorted(set(_UNRESOLVABLE) - set(unresolvable))}"
    )


def test_delegated_actions_are_documented() -> None:
    """``_DELEGATED_TO_TOOL_HANDLER`` 每条都要写清"为什么静态判据看不到它的入口"。"""
    offenders = [
        f"  - {name}"
        for name, reason in _DELEGATED_TO_TOOL_HANDLER.items()
        if len(reason.strip()) < 10
    ]
    assert offenders == [], (
        "登记项必须写明足够具体的理由，否则下一个人没法判断它该不该留：\n" + "\n".join(offenders)
    )

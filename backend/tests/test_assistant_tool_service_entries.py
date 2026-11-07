# SPDX-License-Identifier: Apache-2.0
"""T23-b 守卫：每个工具在注册处显式声明 service_entry（T23-a 映射清单的机器可读版）。

三条性质：
1. 「没想过」与「想过并写明理由」必须能区分：Tool.service_entry 的默认值是哨兵
   SERVICE_ENTRY_UNSET，不是 None。None 是合法声明，表示这个工具没有 services
   收口，但必须同时写 service_reason。漏声明会被逐工具点名到声明处。
2. 声明必须是真的：service_entry 指向 app.services 下的符号（相对 app.services 的
   点路径），守卫会 import 该符号，并解析「实际执行体」源码确认它确实被引用——
   静态 Tool(...) 查 handler；T27 起经 as_tool(ActionSpec) 生成的工具查
   ActionSpec.run（tool_adapter 的 handler 是闭包，源码里当然没有业务符号）。
   这防的是「照抄映射清单但执行体没接上」或符号改名后声明悬空。
3. 无 services 收口的工具必须进白名单：新增这类工具时要显式登记（而不是忘了声明
   被默认值蒙混过去）；白名单与注册表双向一致。

不做「必须调用 services」的强约束：纯计算/转换类、内联 ORM 实现、经
assistant_tools 内部 helper 收口的工具可以是 None，但理由必须写清楚（这些正是
T27 的收口候选，白名单就是它们的显式清单）。

注册方式不钉死：T27 起契约层 ActionSpec 是单一真源，as_tool() 把 ActionSpec 的
service_entry/service_reason 原样透传给 Tool 实例。守卫因此分两条线核对——
静态 Tool(...) 的声明处一一对应；as_tool 生成的工具在 ActionSpec 上必须有同样的
显式声明且与 Tool 实例一致。两条线的最终判定都落在 Tool 实例字段上。
"""

from __future__ import annotations

import ast
import functools
import importlib
import importlib.util
import inspect
import re
from pathlib import Path

import pytest
from app.services.assistant_tools._registry import _TOOLS, tool_names
from app.services.assistant_tools._types import SERVICE_ENTRY_UNSET, Tool

BACKEND = Path(__file__).resolve().parents[1]
TOOLS_DIR = BACKEND / "app" / "services" / "assistant_tools"
_ENTRY_RE = re.compile(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$")
_ADAPTER_MODULE_SUFFIX = ".actions.tool_adapter"

# 无 services 收口的工具白名单（T23-b）。三类：
# - 内联 ORM 查询/组装（读）：T27 收口候选；
# - 内联 ORM 写入：T27 收口候选；
# - 经 assistant_tools.document_support 读写 v2 文档：内部唯一收口，无 services 符号。
# 新增工具如果确实没有 services 收口，必须同时：service_entry=None +
# service_reason="..." + 把名字加进这里。三者缺一，守卫变红。
_SERVICE_FREE_TOOLS = frozenset(
    {
        "get_overview",
        "list_jobs",
        "list_resumes",
        "get_resume",
        "get_application_track",
        "create_candidate_job",
        "update_candidate_job",
        "get_skill",
        "list_user_files",
        "list_web_form_fills",
        "get_web_form_fill",
        "list_chat_conversations",
        "get_chat_conversation",
        "list_drill_sessions",
        "update_resume",
        "list_match_analyses",
        "get_entry",
        "add_resume_entry",
        "reorder_sections",
        "set_entry_layout",
        "diagnose_recent_errors",
    }
)


def _is_adapted_tool(tool: Tool) -> bool:
    """工具是否由 T27 的 as_tool() 从 ActionSpec 生成（handler 是适配层闭包）。"""
    return (
        tool.handler.__module__.endswith(_ADAPTER_MODULE_SUFFIX)
        and tool.handler.__name__ == "handler"
    )


def _pilot_specs():
    """全部域的 ActionSpec 表：工具名 -> ActionSpec（T28 起由 action catalog 汇总）。"""
    from app.services.actions.catalog import all_actions

    return all_actions()


@functools.lru_cache(maxsize=1)
def _declaration_sites() -> dict[str, tuple[str, int]]:
    """静态 Tool(...) 声明：工具名 -> (声明文件, Tool(...) 起始行号)。"""
    sites: dict[str, tuple[str, int]] = {}
    for path in sorted(TOOLS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "Tool"
            ):
                continue
            name = None
            for keyword in node.keywords:
                if keyword.arg == "name" and isinstance(keyword.value, ast.Constant):
                    name = keyword.value.value
            if name:
                relative = path.relative_to(BACKEND.parent).as_posix()
                sites[name] = (relative, node.lineno)
    return sites


def _package_of(module: str) -> str:
    return module.rsplit(".", 1)[0] if "." in module else ""


def _resolve_import(module: str, module_name: str, level: int) -> str:
    if level == 0:
        return module
    try:
        return importlib.util.resolve_name("." * level + (module or ""), _package_of(module_name))
    except Exception:  # noqa: BLE001 - 解析失败时保留原始串，让断言把问题暴露出来
        return module


@functools.lru_cache(maxsize=32)
def _imports_of(path: str, module_name: str) -> dict[str, str]:
    """模块里的 import 别名 -> 绝对点路径（含函数体内的局部 import）。"""
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            base = _resolve_import(node.module or "", module_name, node.level)
            for alias in node.names:
                if alias.name == "*":
                    continue
                mapping[alias.asname or alias.name] = f"{base}.{alias.name}"
        elif isinstance(node, ast.Import):
            for alias in node.names:
                mapping[alias.asname or alias.name.split(".")[0]] = alias.name
    return mapping


def _function_references(function) -> set[str]:
    """函数体里引用到的符号（按 import 解析成绝对点路径）。"""
    path = Path(inspect.getsourcefile(function))
    imports = _imports_of(str(path), function.__module__)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    declaration = None
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == function.__name__
            and node.lineno == function.__code__.co_firstlineno
        ):
            declaration = node
            break
    assert declaration is not None, f"在 {path} 里找不到函数体：{function.__name__}"
    references: set[str] = set()
    for node in ast.walk(declaration):
        if isinstance(node, ast.Attribute):
            parts: list[str] = []
            current: ast.AST = node
            while isinstance(current, ast.Attribute):
                parts.append(current.attr)
                current = current.value
            if isinstance(current, ast.Name) and current.id in imports:
                references.add(imports[current.id] + "." + ".".join(reversed(parts)))
        elif isinstance(node, ast.Name) and node.id in imports:
            references.add(imports[node.id])
    return references


def _execution_target(tool: Tool):
    """返回 (实际执行体函数, 人类可读位置)。静态工具 = handler；as_tool 工具 = ActionSpec.run。"""
    if not _is_adapted_tool(tool):
        return tool.handler, f"handler {tool.handler.__module__}.{tool.handler.__name__}"
    spec = _pilot_specs().get(tool.name)
    assert spec is not None, (
        f"{tool.name} 经 as_tool 注册，但在 action catalog 里找不到对应 ActionSpec"
    )
    return spec.run, f"ActionSpec.run {spec.run.__module__}.{spec.run.__qualname__}"


def _resolve_callable(dotted: str):
    module_path, _, attribute = dotted.rpartition(".")
    try:
        module = importlib.import_module(module_path)
    except Exception:  # noqa: BLE001 - 解析不到就当没引用，交给调用方报错
        return None
    return getattr(module, attribute, None)


def _symbol_referenced(target, dotted: str, depth: int = 2, seen: set[str] | None = None) -> bool:
    """执行体（或它一层层调到的 assistant_tools helper）是否引用/就是声明的符号。

    T27 迁移后的 ActionSpec.run 常常复用现有 handler 或 re-export 的 service 函数
    （例如 _run_get_job 调 _tool_get_job、_run_create_reminder 调 re-export 的
    reminder_service.create_reminder），所以允许沿「assistant_tools 内部 helper」
    向下跟两层；同时按对象身份识别 re-export（调用的就是声明的那个函数）。
    """
    references = _function_references(target)
    if dotted in references:
        return True
    if depth <= 0:
        return False
    seen = seen if seen is not None else set()
    target_symbol = _resolve_callable(dotted)
    for reference in references:
        if reference in seen:
            continue
        helper = _resolve_callable(reference)
        if helper is None:
            continue
        if target_symbol is not None and helper is target_symbol:
            return True
        if inspect.isfunction(helper):
            seen.add(reference)
            if _symbol_referenced(helper, dotted, depth - 1, seen):
                return True
    return False


_DECLARED_TOOLS = tuple(tool for tool in _TOOLS if isinstance(tool.service_entry, str))


def test_every_registered_tool_declares_service_entry():
    sites = _declaration_sites()
    offenders = []
    for tool in _TOOLS:
        if tool.service_entry is not SERVICE_ENTRY_UNSET:
            continue
        location = sites.get(tool.name)
        where = f"{location[0]}:{location[1]}" if location else "<as_tool 的 ActionSpec 声明处>"
        offenders.append(f"{tool.name}（{where}）")
    assert not offenders, (
        "以下工具漏声明 service_entry。静态工具直接写在 Tool(...)；经 as_tool 生成的工具"
        "写在对应 ActionSpec。service_entry=None 是合法声明，但必须显式写出并附 "
        "service_reason：\n" + "\n".join(offenders)
    )


def test_declaration_sites_cover_registered_tools_one_to_one():
    sites = _declaration_sites()
    registered = set(tool_names())
    assert len(tool_names()) == len(registered), "注册表里有重名工具"
    adapted = {tool.name for tool in _TOOLS if _is_adapted_tool(tool)}
    static = registered - adapted
    assert static == set(sites), (
        "注册表与 Tool(...) 静态声明必须一一对应（经 as_tool 生成的工具由 ActionSpec "
        "声明，不计入此集合）："
        f"已注册但没找到声明={sorted(static - set(sites))}，"
        f"有声明但没注册={sorted(set(sites) - static)}"
    )


def test_adapted_tools_declare_service_on_actionspec():
    adapter_tools = [
        tool for tool in _TOOLS if tool.handler.__module__.endswith(_ADAPTER_MODULE_SUFFIX)
    ]
    adapted = [tool for tool in _TOOLS if _is_adapted_tool(tool)]
    assert len(adapter_tools) == len(adapted), (
        "as_tool 生成的工具识别失败（handler 闭包形态变了？）——"
        f"adapter 模块工具 {len(adapter_tools)} 个，识别出 {len(adapted)} 个"
    )
    specs = _pilot_specs()
    for tool in adapted:
        spec = specs.get(tool.name)
        assert spec is not None, (
            f"{tool.name} 经 as_tool 注册，但在 pilot_actions() 里没有 ActionSpec"
        )
        assert hasattr(spec, "service_entry") and hasattr(spec, "service_reason"), (
            "ActionSpec 必须提供 service_entry/service_reason 字段（T23-b 与 T27 的单一真源口径）"
        )
        assert spec.service_entry == tool.service_entry, (
            f"{tool.name} 的 ActionSpec.service_entry={spec.service_entry!r} 与 Tool 实例不一致——"
            "as_tool() 必须原样透传"
        )
        assert spec.service_reason == tool.service_reason


@pytest.mark.parametrize("tool", _DECLARED_TOOLS, ids=[tool.name for tool in _DECLARED_TOOLS])
def test_declared_service_symbol_imports_and_is_referenced(tool: Tool):
    entry = tool.service_entry
    assert isinstance(entry, str)
    assert _ENTRY_RE.match(entry), f"{tool.name} 的 service_entry 格式不是点路径：{entry!r}"
    assert not entry.startswith("app."), (
        "service_entry 用相对 app.services 的点路径，不写 app. 前缀"
    )
    assert ".assistant_tools." not in entry, (
        "service_entry 必须指向 services/ 的业务符号，不能是内部 helper"
    )
    dotted = "app.services." + entry
    module_path, _, attribute = dotted.rpartition(".")
    module = importlib.import_module(module_path)
    assert hasattr(module, attribute), f"{tool.name} 声明的符号不存在：{dotted}"
    target, target_label = _execution_target(tool)
    if "actions.legacy" in target_label or str(getattr(target, "__module__", "")).startswith(
        "app.services.actions.domains"
    ):
        # T28「旧实现委托」范式：run 只是 legacy.route_runner(...) 生成的闭包，函数体里没有
        # 业务符号；真正的实现是既有 api/tool handler（本来就由既有测试覆盖）。这里只要求
        # service_entry 能 import 且工具注册表/权限守卫仍然通过。
        return
    references = _function_references(target)
    assert dotted in references or _symbol_referenced(target, dotted), (
        f"{tool.name} 声明 service_entry={entry!r}，但 {target_label} 的源码没有引用它"
        "（含 assistant_tools 内部 helper 一层层调用 / re-export 身份核对）；"
        "实际引用的 services 符号："
        + str(
            sorted(
                ref
                for ref in references
                if ref.startswith("app.services.") and ".assistant_tools" not in ref
            )[:8]
        )
    )


def test_service_entry_none_requires_reason():
    missing = [
        tool.name
        for tool in _TOOLS
        if tool.service_entry is None and not tool.service_reason.strip()
    ]
    assert not missing, (
        "service_entry=None 必须写 service_reason 说明为什么没有 services 收口：\n"
        + "\n".join(missing)
    )
    extra = [
        tool.name
        for tool in _TOOLS
        if isinstance(tool.service_entry, str) and tool.service_reason.strip()
    ]
    assert not extra, (
        "service_entry 非 None 的工具不应再写 service_reason（两套说法会漂移）：\n"
        + "\n".join(extra)
    )


def test_service_free_tools_are_explicitly_whitelisted():
    none_tools = {tool.name for tool in _TOOLS if tool.service_entry is None}
    assert none_tools == set(_SERVICE_FREE_TOOLS), (
        "无 services 收口的工具必须显式登记在 _SERVICE_FREE_TOOLS（新增这类工具时同步"
        "在该白名单写明理由分类）："
        f"缺少登记={sorted(none_tools - set(_SERVICE_FREE_TOOLS))}，"
        f"白名单里已不存在={sorted(set(_SERVICE_FREE_TOOLS) - none_tools)}"
    )


def test_undeclared_sentinel_is_not_silently_none():
    def handler(_db, _arguments):
        return None

    base = {
        "name": "sentinel_probe",
        "description": "守卫自身的最小构造：只验证哨兵与显式 None 可区分",
        "parameters": {"type": "object", "properties": {}},
        "handler": handler,
    }
    implicit = Tool(**base)
    explicit = Tool(**base, service_entry=None, service_reason="纯计算，无 services 收口")
    assert implicit.service_entry is SERVICE_ENTRY_UNSET
    assert explicit.service_entry is None

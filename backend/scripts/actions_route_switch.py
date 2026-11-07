# SPDX-License-Identifier: Apache-2.0
"""T28 路由切换：把仍是 @router 装饰的旧 handler 换成 add_action_route（可预演）。

用法：
  python scripts/actions_route_switch.py --dry-run   # 只打印将改哪些文件/函数
  python scripts/actions_route_switch.py             # 真正改文件

匹配依据：ActionSpec.http 的 (method, absolute path) 与各 api 模块（含子包）里
@router 装饰器的 (模块 prefix 或祖先包 include prefix + 相对 path) 逐字相等。

命中后：
- 删除对应的 @router 装饰器（函数体保留——ActionSpec.run/run_tool 的旧实现委托还要调用它）；
- 在原装饰器位置插入 add_action_route(router, all_actions()["<name>"], route_path="<相对路径>")；
- 补 from ..services.actions import add_action_route 与 catalog import（按相对深度生成）。
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_DIR = ROOT / "app" / "api"
sys.path.insert(0, str(ROOT))

_METHODS = {"get", "post", "put", "patch", "delete"}
_INCLUDE_PREFIX_RE = re.compile(r"include_router\([^)]*?prefix\s*=\s*[\"']([^\"']+)[\"']")
_ROUTER_PREFIX_RE = re.compile(r"router\s*=\s*APIRouter\([^)]*?prefix\s*=\s*[\"']([^\"']+)[\"']")


def _action_targets() -> dict[tuple[str, str], str]:
    from app.services.actions.catalog import all_actions

    targets: dict[tuple[str, str], str] = {}
    for name, spec in all_actions().items():
        route = spec.http
        if route is None:
            continue
        targets[(route.method.upper(), route.path)] = name
    return targets


def _module_prefix(source: str) -> str:
    match = _ROUTER_PREFIX_RE.search(source)
    return match.group(1) if match else ""


def _ancestor_prefixes(path: Path) -> list[str]:
    prefixes: list[str] = []
    package = path.parent
    while package != API_DIR.parent:
        init = package / "__init__.py"
        if init.exists():
            prefixes.extend(_INCLUDE_PREFIX_RE.findall(init.read_text(encoding="utf-8")))
        if package == API_DIR:
            break
        package = package.parent
    return prefixes


def _decorator_route(decorator: ast.AST) -> tuple[str, str, int, int] | None:
    if not isinstance(decorator, ast.Call):
        return None
    func = decorator.func
    if not isinstance(func, ast.Attribute):
        return None
    if not (isinstance(func.value, ast.Name) and func.value.id == "router"):
        return None
    if func.attr not in _METHODS or not decorator.args:
        return None
    path = decorator.args[0]
    if not isinstance(path, ast.Constant) or not isinstance(path.value, str):
        return None
    return func.attr.upper(), path.value, decorator.lineno, decorator.end_lineno


def _relative_imports(path: Path) -> tuple[str, str]:
    depth = len(path.relative_to(API_DIR).parent.parts)
    dots = "." + "." * (depth + 1)
    return f"from {dots}services.actions import add_action_route", (
        f"from {dots}services.actions.catalog import all_actions"
    )


def _ensure_imports(source: str, import_lines: tuple[str, str]) -> str:
    for line in import_lines:
        if line in source:
            continue
        anchor = "\nrouter = APIRouter("
        idx = source.find(anchor)
        if idx == -1:
            raise RuntimeError("找不到 router = APIRouter( 插入 import 的位置")
        source = source[:idx] + "\n" + line + source[idx:]
    return source


def _apply_edits(source: str, edits: list[tuple[int, int, str]]) -> str:
    lines = source.splitlines(keepends=True)
    for start_line, end_line, replacement in sorted(edits, reverse=True):
        start = start_line - 1
        end = end_line
        lines[start:end] = [replacement + "\n"]
    return "".join(lines)


def _migrated_actions() -> set[str]:
    """已经用 add_action_route 注册过的 action（不需要再切换）。"""
    migrated: set[str] = set()
    pattern = re.compile(r'add_action_route\(router, all_actions\\(\\)\["([a-z0-9_]+)"\]')
    for path in API_DIR.rglob("*.py"):
        migrated.update(pattern.findall(path.read_text(encoding="utf-8")))
    return migrated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    targets = _action_targets()
    pending = dict(targets)
    changes: list[tuple[Path, list[tuple[int, int, str]], list[str]]] = []
    ambiguous: list[str] = []
    for path in sorted(API_DIR.rglob("*.py")):
        if path.name == "__init__.py":
            continue
        source = path.read_text(encoding="utf-8")
        own_prefix = _module_prefix(source)
        prefixes = [own_prefix, ""] + _ancestor_prefixes(path)
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue
        edits: list[tuple[int, int, str]] = []
        actions_here: list[str] = []
        for node in tree.body:
            if not isinstance(node, ast.FunctionDef):
                continue
            for decorator in node.decorator_list:
                parsed = _decorator_route(decorator)
                if parsed is None:
                    continue
                method, rel, start_line, end_line = parsed
                absolute = None
                for prefix in prefixes:
                    candidate = (prefix.rstrip("/") + rel) if prefix else rel
                    if (method, candidate) in pending:
                        absolute = candidate
                        break
                if absolute is None:
                    continue
                action = pending.pop((method, absolute))
                replacement = (
                    f'add_action_route(router, all_actions()["{action}"], route_path="{rel}")'
                )
                edits.append((start_line, end_line, replacement))
                actions_here.append(action)
        if edits:
            changes.append((path, edits, actions_here))

    migrated = _migrated_actions()
    for action, _ in sorted(pending.items()):
        if action in migrated:
            continue
        ambiguous.append(f"{action[0]} {action[1]}")
    for path, _edits, actions_here in changes:
        rel_path = path.relative_to(ROOT)
        print("FILE", rel_path, "->", ",".join(actions_here))
    if ambiguous:
        print("UNMATCHED", len(ambiguous), "routes:")
        for item in ambiguous:
            print("  ", item)
    print("TOTAL_ACTIONS", sum(len(actions_here) for _, _, actions_here in changes))
    if args.dry_run:
        return 0
    for path, edits, _ in changes:
        source = path.read_text(encoding="utf-8")
        # 先按原始行号替换装饰器，再插 import（反过来会让行号整体偏移）。
        source = _apply_edits(source, edits)
        source = _ensure_imports(source, _relative_imports(path))
        path.write_text(source, encoding="utf-8")
        print("PATCHED", path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# SPDX-License-Identifier: Apache-2.0
"""async 路由守卫：禁止在 async 路由里构造同步 SQLAlchemy 查询。

规则来源：技术债治理计划 T5-b / D6。async 路由里出现查询构造
（`select(...)` / `db.query(...)` / `db.execute(...)`）会让同步 SQLAlchemy
在事件循环线程上阻塞。允许 `db.get(...)`（主键点查）与 `db.commit()`
（unit-of-work 收尾）。落地时实测 73 个 async 路由、0 处违规，故不设白名单：
新增即回退，查询构造应在服务层实现。
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
API_DIR = BACKEND_DIR / "app" / "api"
ROUTE_METHODS = frozenset({"get", "post", "put", "patch", "delete"})
FORBIDDEN_DB_METHODS = frozenset({"query", "execute"})


@dataclass(frozen=True)
class Violation:
    path: Path
    function: str
    lineno: int
    call: str

    def format(self) -> str:
        rel = self.path.relative_to(BACKEND_DIR).as_posix()
        return f"{rel}:{self.lineno} async 路由 {self.function}() 内出现 {self.call}"


def _is_route_decorator(node: ast.expr) -> bool:
    """装饰器是否是 `<router>.get/post/put/patch/delete(...)` 形式。"""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in ROUTE_METHODS
    )


def _forbidden_call(node: ast.Call) -> str | None:
    """命中禁止原语时返回展示名，否则 None。"""
    func = node.func
    if isinstance(func, ast.Name) and func.id == "select":
        return "select()"
    if (
        isinstance(func, ast.Attribute)
        and func.attr in FORBIDDEN_DB_METHODS
        and isinstance(func.value, ast.Name)
        and func.value.id == "db"
    ):
        return f"db.{func.attr}()"
    return None


def _iter_async_routes(tree: ast.Module) -> Iterator[ast.AsyncFunctionDef]:
    """产出模块内所有带路由装饰器的 `async def`。"""
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and any(
            _is_route_decorator(dec) for dec in node.decorator_list
        ):
            yield node


def _violations_for_route(path: Path, route: ast.AsyncFunctionDef) -> list[Violation]:
    """扫描路由函数体；嵌套内层函数同样跑在事件循环线程上，一并扫描。"""
    return [
        Violation(path, route.name, node.lineno, call)
        for node in ast.walk(route)
        if isinstance(node, ast.Call) and (call := _forbidden_call(node))
    ]


def _scan_api_dir() -> tuple[int, list[Violation]]:
    """扫描 `app/api/**`，返回 (async 路由数, 违规列表)。"""
    route_count = 0
    violations: list[Violation] = []
    for path in sorted(API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for route in _iter_async_routes(tree):
            route_count += 1
            violations.extend(_violations_for_route(path, route))
    return route_count, violations


def test_async_routes_do_not_construct_sync_queries() -> None:
    route_count, violations = _scan_api_dir()
    # 扫描面自检：路径写错时不能静默空转成"0 违规"。
    assert route_count >= 50, f"只扫到 {route_count} 个 async 路由，扫描面疑似失效"
    assert not violations, "async 路由内禁止构造同步查询：\n" + "\n".join(
        v.format() for v in violations
    )


_SYNTHETIC = """
@router.get("/bad")
async def bad_route(db):
    select(object); db.execute(None)

@router.get("/ok")
async def ok_route(db, item_id):
    db.get(object, item_id); db.commit()
"""


def test_detector_recognizes_forbidden_patterns() -> None:
    """检测器自检：select()/db.execute() 命中，db.get()/db.commit() 放过。"""
    routes = {r.name: r for r in _iter_async_routes(ast.parse(_SYNTHETIC))}
    found = _violations_for_route(Path("synthetic.py"), routes["bad_route"])
    assert [v.call for v in found] == ["select()", "db.execute()"]
    assert _violations_for_route(Path("synthetic.py"), routes["ok_route"]) == []

# SPDX-License-Identifier: Apache-2.0
"""守卫：**路由函数体内不得构造查询**（T2 / D2 / D6 的规则落地）。

规则来自 docs/architecture.md「路由层允许与禁止」：

- 允许：`db.get` 做主键存在性校验、`db.commit` 收尾事务、调用 service 后组装响应；
- 禁止：在路由函数里构造查询（`select(...)` / `db.query(...)` / `db.execute(...)`）。

为什么钉这一条：查询构造一旦回到路由，同一查询语义就会出现第二份实现，而"服务层是唯一
数据入口"就无法自证。当前 api 层查询构造为 0 处（T2 把最后一处 `db.execute` 也搬走了），
本守卫让"再放回去"必须先改这条测试。

口径：AST 静态扫描，不 import 任何 app 模块（与 test_import_direction 同一取舍）。
被装饰成路由的函数才扫——`add_action_route` 动态注册的 handler 不在路由函数体内，
由各自的 action 契约测试覆盖。
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"
API_DIR = APP_DIR / "api"

# FastAPI 路由装饰器的方法名（@router.get / @app.api_route ...）。
_ROUTE_METHODS = frozenset({"get", "post", "put", "patch", "delete", "api_route"})


def _is_route_decorator(node: ast.expr) -> bool:
    target = node.func if isinstance(node, ast.Call) else node
    return isinstance(target, ast.Attribute) and target.attr in _ROUTE_METHODS


def _iter_route_functions() -> Iterator[tuple[Path, ast.FunctionDef | ast.AsyncFunctionDef]]:
    for path in sorted(API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if any(_is_route_decorator(item) for item in node.decorator_list):
                yield path, node


def _is_query_construction(node: ast.Call) -> bool:
    """`select(...)` / `db.query(...)` / `db.execute(...)`。"""
    func = node.func
    if isinstance(func, ast.Name) and func.id == "select":
        return True
    return (
        isinstance(func, ast.Attribute)
        and func.attr in {"query", "execute"}
        and isinstance(func.value, ast.Name)
        and func.value.id == "db"
    )


def _query_construction_calls(
    function: ast.FunctionDef | ast.AsyncFunctionDef,
) -> list[ast.Call]:
    """函数体内（含嵌套定义）的查询构造调用。"""
    return [
        node
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and _is_query_construction(node)
    ]


def test_route_functions_do_not_build_queries() -> None:
    """路由函数体里不得出现 select(...) / db.query(...) / db.execute(...)。"""
    offenders: list[str] = []
    for path, function in _iter_route_functions():
        for call in _query_construction_calls(function):
            rel = path.relative_to(APP_DIR.parent).as_posix()
            offenders.append(
                f"{rel}:{call.lineno} 函数 {function.name}() 内构造查询（{ast.unparse(call)}）"
            )
    assert offenders == [], (
        "路由函数体里出现了查询构造——查询必须下沉到 services，路由只做 db.get 存在性校验"
        "与 db.commit 收尾（规则见 docs/architecture.md「路由层允许与禁止」）：\n"
        + "\n".join(f"  - {item}" for item in offenders)
    )


def test_the_scan_actually_reaches_route_functions() -> None:
    """守卫不能空转：扫不到路由函数时上面那条永远绿，等于没有守卫。"""
    routes = list(_iter_route_functions())
    # 实测口径（2026-11-14）：app/api 下约 500+ 个被装饰的路由函数。
    assert len(routes) >= 400, f"只扫到 {len(routes)} 个路由函数，扫描口径可能已经失效"

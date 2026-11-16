# SPDX-License-Identifier: Apache-2.0
"""守卫：**api 层持有数据库会话的函数体内不得构造查询**（T2 / D2 / D6 / RF-04 的规则落地）。

规则来自 docs/architecture.md「路由层允许与禁止」：

- 允许：``db.get`` 做主键存在性校验、``db.commit`` 收尾事务、调用 service 后组装响应；
- 禁止：在 api 层构造查询（``select(...)`` / ``db.query(...)`` / ``db.execute(...)``）。

为什么钉这一条：查询构造一旦回到 api 层，同一查询语义就会出现第二份实现，而"服务层是
唯一数据入口"就无法自证。

## RF-04：口径为什么从"只看被装饰函数"扩到"看所有带会话形参的函数"

原口径只扫被路由装饰器装饰的函数，且只认接收者名叫 ``db``。于是 ``api/apply.py`` 里那个
**未被装饰的** helper ``_task_detail(data: Session, ...)`` 中的
``data.query(ApplyTaskItem)...`` 既不在扫描面内、接收者名字也对不上——守卫全绿，而 api 层
明明在构造查询。把那处下沉到服务层之后，扫描口径必须跟着放宽，否则"再放回去"依然扫不到。

现在的口径：

1. **扫描面**：``app/api`` 下**所有**函数（含未装饰的 helper、类的嵌套定义），只要它有一个
   "数据库会话"形参。
2. **会话形参的判定分两档**（必须分档，否则全是误报）：

   - **有注解**：注解的类型名（取 ``a.b.Session`` 的最后一段，兼容 ``Session | None``）是
     ``Session`` / ``AsyncSession`` / ``scoped_session``。这一档按**允许清单**判定，
     清单外的任何方法调用都算违例（``data.query`` 与 ``db.query`` 一样红）。
   - **没注解**：只有形参名在 ``{db, data, session, database}`` 里时才当作怀疑对象，且只
     认**明确的查询构造方法** ``query`` / ``execute``。这一档不能套允许清单——api 层有大量
     形参名恰好叫 ``session`` 的**业务对象**（面试会话、采集会话），套清单会把
     ``session.report`` 判成违例。注解里"含 Session 子串"同样不能用作判据：
     ``payload: LLMSessionKeyIn`` 会让 ``payload.api_key`` 变成"查询构造"。

3. 额外禁 ``select(...)`` 这个裸名字调用（ORM 2.0 风格，与接收者叫什么无关）。

``add_action_route`` 动态注册的 handler 只要持有会话形参就落在第 1 条里；它们的请求/响应
契约另由各自的 action 契约测试覆盖。
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"
API_DIR = APP_DIR / "api"

# FastAPI 路由装饰器的方法名（@router.get / @app.api_route ...）。只用于"扫描面自检"里
# 区分被装饰的路由函数与未装饰的 helper，不参与违例判定。
_ROUTE_METHODS = frozenset({"get", "post", "put", "patch", "delete", "api_route"})

# 注解里被认作"数据库会话"的类型名（取注解的最后一段，兼容 `orm.Session` / `Session | None`）。
_SESSION_TYPE_NAMES = frozenset({"Session", "AsyncSession", "scoped_session"})

# 形参是"数据库会话"的**名字**白名单：仅在完全没写类型注解时启用（见模块 docstring 第 2 条）。
_SESSION_PARAM_NAMES = frozenset({"db", "data", "session", "database"})

# 有类型注解的会话形参：允许调用的方法 = 主键存在性校验 + 事务收尾 + 只读取引擎。
# 增删任何一项都等于调整规则本身，必须在 docs/architecture.md 里同步说明。
_ALLOWED_SESSION_METHODS = frozenset(
    {
        # 主键存在性校验 / 按 id 取单行（不是查询构造：走 identity-map 的主键取数）。
        "get",
        # 只读取绑定引擎的访问器（与 database.session_engine(db) 同义），不构造查询。
        "get_bind",
        # 事务收尾与写事务里的最小动作。
        "add",
        "delete",
        "flush",
        "commit",
        "rollback",
        "refresh",
        "expire_all",
        "close",
    }
)

# 没写注解的会话形参：只认这两个明确的查询构造方法（见模块 docstring 第 2 条的误报说明）。
_FORBIDDEN_METHODS_FOR_UNANNOTATED = frozenset({"query", "execute"})

# 裸名字调用里属于"查询构造"的函数名。
_FORBIDDEN_BARE_CALLS = frozenset({"select"})

# 扫描面自检的下限。实测口径（2026-11-15，RF-04）：580 个带会话形参的函数，其中 96 个
# 未被路由装饰器装饰。留一点点余量给"合并/搬迁函数"，但幅度必须小到能发现"扫描口径失效"
# ——阈值贴到 0 时这条自检就只剩装饰作用。
_MIN_SCANNED_FUNCTIONS = 550
_MIN_UNDECORATED_FUNCTIONS = 85


def _is_route_decorator(node: ast.expr) -> bool:
    target = node.func if isinstance(node, ast.Call) else node
    return isinstance(target, ast.Attribute) and target.attr in _ROUTE_METHODS


def _annotation_is_session(annotation: ast.expr) -> bool:
    """注解的类型名是否就是数据库会话（按最后一段比对，兼容 ``| None`` 与带引号的写法）。"""
    text = ast.unparse(annotation).strip("'\"")
    return any(part.strip().rsplit(".", 1)[-1] in _SESSION_TYPE_NAMES for part in text.split("|"))


def _session_params(function: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, bool]:
    """函数签名里的会话形参：``形参名 -> 是否有 Session 类型注解``。"""
    params: dict[str, bool] = {}
    arguments = function.args
    for arg in (*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs):
        if arg.annotation is not None:
            if _annotation_is_session(arg.annotation):
                params[arg.arg] = True
        elif arg.arg in _SESSION_PARAM_NAMES:
            params[arg.arg] = False
    return params


def _iter_session_functions() -> Iterator[
    tuple[Path, ast.FunctionDef | ast.AsyncFunctionDef, dict[str, bool], bool]
]:
    """``app/api`` 下所有带会话形参的函数：``(文件, 节点, 会话形参表, 是否路由函数)``。"""
    for path in sorted(API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            params = _session_params(node)
            if not params:
                continue
            decorated = any(_is_route_decorator(item) for item in node.decorator_list)
            yield path, node, params, decorated


def _attr_is_query_construction(annotated: bool | None, attr: str) -> bool:
    """``形参名.属性`` 是否构成查询构造（``annotated`` 为 ``None`` 表示不是会话形参）。"""
    if annotated is None:
        return False
    if annotated:
        # 有 Session 注解：允许清单以外一律违例（口径见模块 docstring 第 2 条）。
        return attr not in _ALLOWED_SESSION_METHODS
    return attr in _FORBIDDEN_METHODS_FOR_UNANNOTATED


def _query_construction_calls(
    function: ast.FunctionDef | ast.AsyncFunctionDef, session_params: dict[str, bool]
) -> list[ast.AST]:
    """函数体内（含嵌套定义）的查询构造痕迹。

    对被注解成会话的形参调用清单外方法、对未注解的会话别名形参调用 ``query``/``execute``、
    以及裸名字 ``select(...)``——三类都算。**不区分接收者叫 db 还是 data。**
    """
    offenders: list[ast.AST] = []
    for node in ast.walk(function):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if _attr_is_query_construction(session_params.get(node.value.id), node.attr):
                offenders.append(node)
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _FORBIDDEN_BARE_CALLS
        ):
            offenders.append(node)
    return offenders


def test_api_functions_do_not_build_queries() -> None:
    """api 层带会话形参的函数体里不得构造查询（含未被装饰的 helper）。"""
    offenders: list[str] = []
    for path, function, params, _decorated in _iter_session_functions():
        rel = path.relative_to(APP_DIR.parent).as_posix()
        for node in _query_construction_calls(function, params):
            offenders.append(
                f"{rel}:{node.lineno} 函数 {function.name}() 内构造查询（{ast.unparse(node)}）"
            )
    allowed = "、".join(sorted(_ALLOWED_SESSION_METHODS))
    assert offenders == [], (
        "api 层出现了查询构造——查询必须下沉到 services，api 层只做 db.get 存在性校验"
        f"与事务收尾（允许的会话方法：{allowed}；规则见 docs/architecture.md"
        "「路由层允许与禁止」）：\n" + "\n".join(f"  - {item}" for item in offenders)
    )


def test_the_scan_actually_reaches_api_functions() -> None:
    """守卫不能空转：扫不到函数时上面那条永远绿，等于没有守卫。"""
    scanned = list(_iter_session_functions())
    assert len(scanned) >= _MIN_SCANNED_FUNCTIONS, (
        f"只扫到 {len(scanned)} 个带会话形参的函数（下限 {_MIN_SCANNED_FUNCTIONS}），"
        "扫描口径可能已经失效"
    )


def test_the_scan_also_covers_undecorated_helpers() -> None:
    """RF-04 的盲区必须一直在扫描面内：未装饰的 helper 也要被扫到。

    只扫"被路由装饰器装饰的函数"正是 ``_task_detail(data: Session, ...)`` 漏网的原因。
    这条断言钉住扫描面的宽度——把口径收窄回"只看被装饰函数"会立刻变红。
    """
    undecorated = [item for item in _iter_session_functions() if not item[3]]
    assert len(undecorated) >= _MIN_UNDECORATED_FUNCTIONS, (
        f"只扫到 {len(undecorated)} 个未装饰的带会话形参函数"
        f"（下限 {_MIN_UNDECORATED_FUNCTIONS}），扫描口径可能收窄回只看路由函数了"
    )

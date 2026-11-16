# SPDX-License-Identifier: Apache-2.0
"""守卫：``async def`` 里不得把请求 Session 交给同步函数（RF-02）。

原有守卫（``test_async_routes_no_blocking_db.py``）只禁 ``select()`` / ``db.query()`` /
``db.execute()``。真实阻塞面比它大：``db.get()`` / ``db.commit()`` / ``db.flush()`` /
``db.refresh()`` 同样是同步 IO，而"把 ``db`` 传给一个同步服务函数"（``get_llm_config(db)``、
``_session_or_404(db, id)``）在语法上完全看不出阻塞——它在函数体里做查询。SQLite 的
``busy_timeout`` 是 5 秒，一次锁等待就够把同进程的 SSE 与轮询一起卡住。

口径（AST，只扫 ``app/api/**``）：

- 识别"会话变量"：形参名在 ``{db, data, session, database}``，或注解里含 ``Session``；
- 违规一：在会话变量上调用阻塞方法（get/query/execute/scalars/commit/...）；
- 违规二：把会话变量作为实参传给任何同步调用（本地 helper、``module.func`` 都算）；
- 放行：包在 ``run_sync(...)`` / ``run_in_threadpool(...)`` 的实参里的调用——那是唯一
  被认可的"把同步工作单元挪出事件循环"的方式（见 ``app/runtime/blocking.py``）。

覆盖边界（**写清楚，别让 0 违规冒充"全站不阻塞"**）：本守卫不跨模块追踪函数体，
所以"服务内部又调了另一个同步函数"不在检测范围；``app/services/**`` 里的 async 生成器
（SSE 收尾）由各自的领域测试覆盖，不在本守卫内。
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
API_DIR = BACKEND_DIR / "app" / "api"

SESSION_PARAMS = frozenset({"db", "data", "session", "database"})
BLOCKING_SESSION_METHODS = frozenset(
    {
        "add",
        "add_all",
        "begin",
        "begin_nested",
        "bulk_save_objects",
        "close",
        "commit",
        "delete",
        "execute",
        "expire",
        "expire_all",
        "flush",
        "get",
        "merge",
        "query",
        "refresh",
        "rollback",
        "scalars",
    }
)
# 允许把同步工作单元挪出事件循环的唯一入口。
OFFLOAD_CALLS = frozenset({"run_sync", "run_in_threadpool"})
# 名单只为下一批留线索，**当前不设规则**。原因：上一版用它禁 ``async def`` 里的
# ``with fresh_session(): await ...``，但「同一 with 块里再加一个 await」不改变 fingerprint、
# 逃得掉棘轮；而两位领域 owner 都建议"判据随修法同批插入，不设白名单"。
#
# 下一批做 drill 三段式改造时，把判据与修复一起打开，并且**逐处核**这三处（不是一处）：
#   - ``drill.py:answer``  ``with fresh_session()`` 跨 ``generate_plan``/``generate_review``
#     （读事务 + 一条池连接被钉住；写事务已在 await 前提交，WAL 下不挡别人写）
#   - ``drill.py:answer``  ``loaded_for_model(...)`` 读出的 messages 跨 await
#   - ``drill.py:finish``  ``loaded_for_model(...)`` 同上
# 判据要同时认 ``fresh_session`` / ``SessionLocal`` / ``loaded_for_model``（后者是"读一整份
# 会话快照"的封装，属于同一类）。修法：拆 ``app/api/drill_units.py`` + 登记
# ``SHARED_API_MODULES``；worker 里拼好 messages → 会话在 await 前关掉；
# ``services/drill/**`` 不用动（``build_*_messages``/``parse_*`` 已是纯函数）。
SESSION_FACTORIES = frozenset(
    {"fresh_session", "SessionLocal", "session_scope", "loaded_for_model"}
)


def _annotation_mentions_session(node: ast.expr | None) -> bool:
    if node is None:
        return False
    return "Session" in ast.unparse(node)


def _session_names(function: ast.FunctionDef | ast.AsyncFunctionDef) -> set[str]:
    names: set[str] = set()
    args = [*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs]
    for arg in args:
        if arg.arg in SESSION_PARAMS or _annotation_mentions_session(arg.annotation):
            names.add(arg.arg)
    return names


def _call_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _is_session_method_call(node: ast.Call, sessions: set[str]) -> bool:
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr not in BLOCKING_SESSION_METHODS:
        return False
    return isinstance(func.value, ast.Name) and func.value.id in sessions


def _passes_session(node: ast.Call, sessions: set[str]) -> bool:
    for arg in [*node.args, *(keyword.value for keyword in node.keywords)]:
        if isinstance(arg, ast.Name) and arg.id in sessions:
            return True
    return False


@dataclass(frozen=True)
class Violation:
    rel: str
    function: str
    call: str
    lineno: int
    kind: str  # "direct" | "indirect"

    @property
    def fingerprint(self) -> str:
        """``文件:函数:被调用的名字``——不含行号，改别的函数不会把登记表冲掉。"""
        return f"{self.rel}:{self.function}:{self.call}"

    def format(self) -> str:
        if self.kind == "direct":
            return f"{self.rel}:{self.lineno} async {self.function}() 里直接调用 {self.call}()"
        return f"{self.rel}:{self.lineno} async {self.function}() 把 Session 传给 {self.call}()"


# 已登记、**本轮未迁移**的同步调用点：fingerprint -> 原因。
# 新增条目必须有具体理由（哪个批次/为什么不影响当前语义），修好后必须删掉。
_PENDING: dict[str, str] = {}


class _AsyncBodyVisitor(ast.NodeVisitor):
    """遍历一个 ``async def`` 的函数体，跟踪"是否已在 offload 调用里"。"""

    def __init__(self, sessions: set[str], rel: str, function: str) -> None:
        self.sessions = sessions
        self.rel = rel
        self.function = function
        self.offload_depth = 0
        self.violations: list[Violation] = []

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802 - ast 接口
        offload = _call_name(node) in OFFLOAD_CALLS
        if offload:
            self.offload_depth += 1
        if self.offload_depth == 0:
            if _is_session_method_call(node, self.sessions):
                self.violations.append(
                    Violation(
                        self.rel, self.function, ast.unparse(node.func), node.lineno, "direct"
                    )
                )
            elif _passes_session(node, self.sessions):
                self.violations.append(
                    Violation(
                        self.rel, self.function, ast.unparse(node.func), node.lineno, "indirect"
                    )
                )
        self.generic_visit(node)
        if offload:
            self.offload_depth -= 1


def _iter_async_functions() -> Iterator[tuple[Path, ast.AsyncFunctionDef]]:
    for path in sorted(API_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef):
                yield path, node


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path, function in _iter_async_functions():
        sessions = _session_names(function)
        if not sessions:
            continue
        rel = path.relative_to(BACKEND_DIR).as_posix()
        visitor = _AsyncBodyVisitor(sessions, rel, function.name)
        for statement in function.body:
            visitor.visit(statement)
        violations.extend(visitor.violations)
    return violations


_NL = chr(10)


def _detail(items: list[Violation]) -> str:
    return _NL.join(f"  - {item.format()}" for item in items)


def test_no_unregistered_sync_session_work_in_async_functions() -> None:
    """表外零违规：新增的 async 代码必须把同步工作单元包进 ``run_sync``。"""
    violations = collect_violations()
    unexpected = [item for item in violations if item.fingerprint not in _PENDING]
    assert unexpected == [], (
        "async 函数在事件循环线程上执行同步数据库工作（规则见 app/runtime/blocking.py）："
        + _NL
        + _detail(unexpected)
    )


def test_pending_registry_has_no_ghost_entries() -> None:
    """登记表不能腐烂：已修复的条目必须删掉，否则它会永远掩盖同一处回归。"""
    found = {item.fingerprint for item in collect_violations()}
    ghosts = sorted(set(_PENDING) - found)
    assert ghosts == [], (
        "这些登记条目已经扫描不到了（已修复或代码已改），请从 _PENDING 删除："
        + _NL
        + _NL.join(f"  - {item}" for item in ghosts)
    )


def test_pending_entries_carry_a_reason() -> None:
    """每条登记都要写清"为什么现在还没搬"，不允许空字符串占位。"""
    empty = sorted(key for key, reason in _PENDING.items() if not reason.strip())
    assert empty == [], f"以下登记缺少理由：{empty}"


_SYNTHETIC = """
async def bad_direct(db):
    db.get(object, 1)

async def bad_service(db, payload):
    return get_llm_config(db)

async def good_offloaded(db, payload):
    return await run_sync(_prepare, db, payload)

async def good_pure(payload):
    return payload.value
"""


def test_detector_catches_direct_and_indirect_session_use() -> None:
    """检测器自检：直接调用与"传 db 给同步函数"都命中，offload 与纯函数放过。"""
    tree = ast.parse(_SYNTHETIC)
    found: dict[str, list[str]] = {}
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        visitor = _AsyncBodyVisitor(_session_names(node), "synthetic.py", node.name)
        for statement in node.body:
            visitor.visit(statement)
        found[node.name] = visitor.violations

    assert [item.kind for item in found["bad_direct"]] == ["direct"]
    assert [item.kind for item in found["bad_service"]] == ["indirect"]
    assert found["good_offloaded"] == [], "run_sync(...) 里的调用不该被算违规"
    assert found["good_pure"] == []


def test_scan_actually_reaches_async_functions() -> None:
    """扫描面自检：扫不到 async 函数时上面那条永远绿。

    下界取 70（RF-02 之后实测 86）：本轮把"全函数没有 await"的路由改成了同步 ``def``
    （Starlette 会在线程池里跑），所以 async 函数总数比改造前少。这里只要守住"扫描
    确实进到了函数体"，不是精度断言——真正的门槛是违规表。
    """
    count = sum(1 for _ in _iter_async_functions())
    assert count >= 70, f"只扫到 {count} 个 async 函数，扫描口径可能失效"
    with_session = sum(1 for path, node in _iter_async_functions() if _session_names(node))
    assert with_session >= 30, f"只扫到 {with_session} 个带会话形参的 async 函数"

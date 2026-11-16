# SPDX-License-Identifier: Apache-2.0
"""守卫：``async def`` 里不得让"持有 Session 的上下文"跨 ``await``。

## 这条守的是哪种失效

``with fresh_session() as db: ... await provider.chat(...)`` 在语法上完全正常，但模型
调用期间它钉住的是**一条池连接 + 一个 WAL 读快照**，而不是写锁——所以"把 commit 提前"
解决不了它（判定结果的写事务早就提交了，见 ``services/drill/evaluate.apply_verdict``）。
同进程的其他请求、SSE 推送与健康检查会排在 SQLite 的 ``busy_timeout=5000`` 后面，最长
卡 5 秒；而 ``async def`` 的签名让这一切完全看不出来。

``loaded_for_model`` / ``fresh_session`` / ``session_scope`` / ``SessionLocal`` 属于同一类：
它们的存在意义就是"yield 期间连接保持打开"，跨 ``await`` 用一次就等于把连接借给了模型
调用（``loaded_for_model`` 甚至会把整份契约与轮次装进内存，俗称"跨 await 的会话快照"）。

## 判据（AST，扫 ``app/``）

两条同时成立才算命中：

1. ``with`` / ``async with`` 的上下文表达式属于 :data:`SESSION_SCOPES`；
2. 该 ``with`` 体内含挂起点（``await`` / ``async for`` / ``async with``）。

**归零式**：``assert offenders == []``，不设 ``_PENDING`` 指纹登记——同一个 ``with`` 块里
再加一个 ``await`` 不改变指纹，而"多一个 await"正好是本类缺陷最常见的复发形态；指纹式
只会让它在登记条目底下安静地复发。

## 修法（照抄 drill 的三段式）

worker 里把 messages 拼好 → **会话在 ``await`` 之前关掉** → 事件循环上只
``provider.chat(...)`` → 再进 worker 落库/决策。``build_*_messages`` / ``parse_*`` 都是
纯函数，所以"拼消息"与"解析"都能留在 worker 里，循环上只剩一个真正的 ``await``。
参考实现：``app/api/drill.py`` + ``app/api/drill_units.py``。

## 覆盖边界（写清楚，别让 0 违规冒充"全站不跨 await"）

只看 ``with`` 语句本身，不跨函数追踪（"A 开了会话，又 await 了一个会碰它的协程"检不出）；
``run_sync`` 那条纪律（同步工作单元整段搬出事件循环、不要把 Session 传进同步函数）由
``test_async_route_thread_boundary.py`` 管，两条合起来才完整。
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

SESSION_SCOPES = frozenset({"fresh_session", "loaded_for_model", "SessionLocal", "session_scope"})


@dataclass(frozen=True)
class Offender:
    """一处"持有会话的 with 块跨过了挂起点"。"""

    rel: str
    function: str
    scope: str
    lineno: int
    awaited: tuple[int, ...]

    def format(self) -> str:
        lines = ", ".join(str(item) for item in self.awaited)
        return (
            f"app/{self.rel}:{self.lineno} async {self.function}() 的 "
            f"with {self.scope}(...) 块里有挂起点（第 {lines} 行）"
        )


def _scope_name(expr: ast.expr) -> str:
    """上下文表达式 → 名字：``fresh_session()`` / ``SessionLocal()`` / ``module.scope()``。"""
    node: ast.expr = expr
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    return ""


def _await_lines(statements: list[ast.stmt]) -> list[int]:
    """块内的挂起点行号：``await`` 与 ``async for`` / ``async with`` 同样是让出点。"""
    lines: set[int] = set()
    for statement in statements:
        for child in ast.walk(statement):
            if isinstance(child, (ast.Await, ast.AsyncFor, ast.AsyncWith)):
                lines.add(child.lineno)
    return sorted(lines)


def _iter_async_functions() -> Iterator[tuple[Path, ast.AsyncFunctionDef]]:
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef):
                yield path, node


_ScopeBlock = tuple[ast.With | ast.AsyncWith, str]


def _as_scope_block(node: ast.AST) -> _ScopeBlock | None:
    """若是"会话上下文块"，返回 ``(with 节点, 名字)``；否则返回 ``None``。

    返回节点本身而不是布尔值，调用方才能拿到 ``.body`` 去数挂起点（也让类型收窄成立）。
    """
    if not isinstance(node, (ast.With, ast.AsyncWith)):
        return None
    scope = "/".join(
        sorted({_scope_name(item.context_expr) for item in node.items} & SESSION_SCOPES)
    )
    return (node, scope) if scope else None


def _iter_all_scope_blocks() -> Iterator[tuple[Path, _ScopeBlock]]:
    """``app/`` 下**全部**会话上下文块（含同步函数里的）。

    同步函数里的那些不可能跨 ``await``，所以不参与判据；它们只用来证明
    :data:`SESSION_SCOPES` 仍然认得出真实代码（名字被改掉时判据会静默空转）。
    """
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            block = _as_scope_block(node)
            if block is not None:
                yield path, block


def _iter_async_scope_blocks() -> Iterator[tuple[Path, ast.AsyncFunctionDef, _ScopeBlock]]:
    """只取 async 函数里的会话上下文块——只有这些才可能跨过挂起点。"""
    for path, function in _iter_async_functions():
        for node in ast.walk(function):
            block = _as_scope_block(node)
            if block is not None:
                yield path, function, block


def collect_offenders() -> list[Offender]:
    """命中判据：async 函数里的会话上下文块内含挂起点。"""
    offenders: list[Offender] = []
    for path, function, (node, scope) in _iter_async_scope_blocks():
        awaited = _await_lines(node.body)
        if not awaited:
            continue
        offenders.append(
            Offender(
                rel=path.relative_to(APP_DIR).as_posix(),
                function=function.name,
                scope=scope,
                lineno=node.lineno,
                awaited=tuple(awaited),
            )
        )
    return offenders


_NL = chr(10)


def test_no_session_scope_crosses_an_await() -> None:
    """归零：会话上下文不跨 ``await``（修法见本模块 docstring）。"""
    offenders = collect_offenders()
    assert offenders == [], (
        "这些 async 函数在模型调用期间还握着 Session（一条池连接 + 一个 WAL 读快照，"
        "不是写锁，提前 commit 无效）："
        + _NL
        + _NL.join(f"  - {item.format()}" for item in offenders)
        + _NL
        + "修法：worker 里把 messages 拼好 → 会话在 await 之前关掉 → 循环上只 provider.chat(...) "
        "→ 再进 worker 落库/决策（样板见 app/api/drill.py + app/api/drill_units.py）。"
    )


def test_scan_reaches_async_functions() -> None:
    """扫描面自检：扫不到 async 函数时上面那条永远绿。

    下界取 70（与 ``test_async_route_thread_boundary`` 同口径；本守卫扫整个 ``app/``，
    实测 312 个 async 函数）。这里只守"扫描确实进到了函数体"，精度门槛是违规列表。
    """
    scanned = sum(1 for _ in _iter_async_functions())
    assert scanned >= 70, f"只扫到 {scanned} 个 async 函数，扫描口径可能失效"


def test_scan_reaches_session_scope_blocks() -> None:
    """名字集合自检：``SESSION_SCOPES`` 拼错/改名会让判据静默空转。

    ``app/`` 里实测 18 处 ``with`` 用的是这四个名字（分布在 11 个文件，多数在同步函数
    里）；下界取 10，只守"仍然认得出真实的会话块"，不是精度断言。
    """
    blocks = sum(1 for _ in _iter_all_scope_blocks())
    assert blocks >= 10, f"只认出 {blocks} 个会话上下文块，SESSION_SCOPES 可能已经过时"


_SYNTHETIC = """
async def bad_fresh(provider):
    with fresh_session() as db:
        db.get(object, 1)
        return await provider.chat(messages)


async def bad_loaded(provider):
    with loaded_for_model(1) as record:
        return await provider.chat(build_messages(record))


async def bad_nested_async_for(provider):
    with session_scope() as db:
        async for chunk in provider.stream_chat(messages):
            yield chunk


async def good_closed_before_await(provider):
    with fresh_session() as db:
        messages = build_messages(db)
    return await provider.chat(messages)


async def good_sync_block():
    with SessionLocal() as db:
        return db.get(object, 1)


async def good_other_context(provider):
    with suppress(ValueError):
        return await provider.chat(messages)
"""


def test_detector_catches_the_pattern_and_passes_the_fix() -> None:
    """检测器自检：三种命中形态都抓到，"先关会话再 await" 与同步块放过。"""
    tree = ast.parse(_SYNTHETIC)
    found: dict[str, list[int]] = {}
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        lines: list[int] = []
        for child in ast.walk(node):
            block = _as_scope_block(child)
            if block is not None:
                lines.extend(_await_lines(block[0].body))
        found[node.name] = sorted(lines)

    assert found["bad_fresh"] == [5], "with 块内的 await 没被抓到"
    assert found["bad_loaded"] == [10], "loaded_for_model（读整份快照）同样要算命中"
    assert found["bad_nested_async_for"] == [15], "async for 也是挂起点"
    assert found["good_closed_before_await"] == [], "会话在 await 之前关掉（三段式）不该命中"
    assert found["good_sync_block"] == [], "没有挂起点的同步块不该命中"
    assert found["good_other_context"] == [], "非会话上下文不该命中"

# SPDX-License-Identifier: Apache-2.0
"""守卫：RF-02 第二批（简历写作 / 修订 / 生成 / 匹配 / 岗位解读 / 体检）的两条边界不变式。

主守卫 ``test_async_route_thread_boundary.py`` 只回答"某个调用有没有被 ``run_sync`` 包住"。
它检不出这两件事，而它们恰好是本批改造里最容易在后续 PR 中被"顺手改回去"的形态：

1. **ContextVar 不得进线程池**。``set_ambient_scope`` / ``set_ambient_task`` /
   ``dataset_scope`` 的 enter/leave 写的是 ContextVar，而 worker 拿到的是上下文的
   **副本**——在 worker 里写只影响那一个线程，回到请求协程就丢了。表现不是报错，而是
   "审计表里 input_scope 忽然全空 / 语言回落成默认值"，非常难查。所以这些调用只能出现在
   ``run_sync(...)`` 的**外面**，需要数据库才能算的值要先在 worker 里读出来带回。

2. **本批六个入口的 async 路由只要碰请求 Session，就必须至少有一处 offload**。
   换句话说：不许出现"我把 ``db`` 参数留着，但一次都没交给线程池"的中间态——那正是
   改造做了一半的样子（同步 DB 仍然跑在事件循环线程上）。

加上两条**行为证据**（不靠 AST，也不靠耗时阈值）：

3. ``risk_scan``（纯准备型）与 ``star_rewrite``（准备 + 模型 await）的同步准备段真的
   跑在 worker 线程上：用一个 ``Event`` 屏障把 worker 卡住，事件循环必须还能推进到
   “放行”那一步。旧实现（同步段留在事件循环上）会卡死在 ``release.wait()`` 里，
   屏障永远打不通，于是失败信息会直接指出"事件循环被同步阶段占住"。
   同时断言 ``db.close()`` 发生在同一个 worker 线程——连接是从 worker 归还的，
   不是事件循环替它关。

覆盖边界（写清楚，别让 0 违规冒充"全站不阻塞"）：AST 两条只扫描本批的六个入口模块，
判据是"有没有 offload 调用"，不追踪服务层内部；服务层的异步路径仍由各自的领域测试覆盖。
屏障两条只覆盖两个代表入口（一个无模型、一个有模型 await），不代表其余入口已逐个验证。
"""

from __future__ import annotations

import ast
import asyncio
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from app.api import resume_risk as risk_api
from app.api import resume_writing as writing_api
from app.models.resume import ResumeRecord
from app.schemas.resume_risk import RiskScanOut, RiskScanRequest
from app.schemas.resume_writing import StarRewriteOut, StarRewriteRequest
from app.schemas.setting import LLMConfig

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR / "app"

# 事件循环所在的线程 = 收集/运行 pytest 的线程（``asyncio.run`` 就在这个线程里跑）。
_LOOP_THREAD = threading.get_ident()


def _tid() -> int:
    """当前线程标识；屏障证据只比对它，不用耗时阈值。"""
    return threading.get_ident()


# 本批（RF-02 第二批）的入口模块：简历写作 / 修订 / 生成 / 匹配 / 岗位解读 / 体检。
BATCH_MODULES = (
    "app/api/resume_writing.py",
    "app/api/resumes/ai_edits_routes.py",
    "app/api/resumes/generate_routes.py",
    "app/api/job_match.py",
    "app/api/jobs_analysis.py",
    "app/api/resume_risk.py",
)

SESSION_PARAMS = frozenset({"db", "data", "session", "database"})
OFFLOAD_CALLS = frozenset({"run_sync", "run_in_threadpool"})
# 写 ContextVar 的入口：它们永远不属于"可以搬进线程池的同步工作单元"。
CONTEXT_VAR_SETTERS = frozenset({"set_ambient_scope", "set_ambient_task"})


def _call_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _mentions_session(node: ast.expr | None) -> bool:
    return node is not None and "Session" in ast.unparse(node)


def _has_session_param(function: ast.AST) -> bool:
    args = function.args  # type: ignore[attr-defined]
    for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
        if arg.arg in SESSION_PARAMS or _mentions_session(arg.annotation):
            return True
    return False


def test_context_var_setters_never_run_inside_the_thread_pool() -> None:
    """写 ContextVar 的调用不得出现在 ``run_sync`` / ``run_in_threadpool`` 的实参里。

    线程池里的写入不会回传给请求协程，症状是审计字段静默变空，而不是异常。
    """
    offenders: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        rel = path.relative_to(BACKEND_DIR).as_posix()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or _call_name(node) not in OFFLOAD_CALLS:
                continue
            for inner in ast.walk(node):
                if not isinstance(inner, ast.Call):
                    continue
                if _call_name(inner) in CONTEXT_VAR_SETTERS:
                    offenders.append(f"{rel}:{inner.lineno} {_call_name(inner)}() 在线程池实参里")
    assert offenders == [], (
        "ContextVar 只能在事件循环线程上写（worker 拿到的是上下文副本）："
        + "".join(f"\n  - {item}" for item in offenders)
    )


def test_batch_entry_async_routes_offload_their_session_work() -> None:
    """六个入口里，凡是带请求 Session 的 ``async def`` 都必须至少 offload 一次。

    ``run_sync`` 不在这个函数体里出现过，就说明同步数据库工作还留在事件循环线程上
    ——改造做了一半（或后续 PR 把 offload 删掉了）。
    """
    offenders: list[str] = []
    for rel in BATCH_MODULES:
        path = BACKEND_DIR / rel
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef) or not _has_session_param(node):
                continue
            offloads = [
                call
                for call in ast.walk(node)
                if isinstance(call, ast.Call) and _call_name(call) in OFFLOAD_CALLS
            ]
            if not offloads:
                offenders.append(f"{rel}:{node.lineno} async {node.name}()")
    assert offenders == [], (
        "这些 async 路由带着请求 Session 却没有把同步工作单元交给线程池："
        + "".join(f"\n  - {item}" for item in offenders)
    )


def test_batch_modules_are_actually_scanned() -> None:
    """扫描面自检：模块路径写错时上面两条会静默变绿。"""
    missing = [rel for rel in BATCH_MODULES if not (BACKEND_DIR / rel).is_file()]
    assert missing == [], f"这些入口模块不存在，路径写错了：{missing}"

    total = 0
    for rel in BATCH_MODULES:
        tree = ast.parse((BACKEND_DIR / rel).read_text(encoding="utf-8"))
        total += sum(
            1
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef) and _has_session_param(node)
        )
    assert total >= 10, f"只扫到 {total} 个带 Session 的 async 路由，扫描口径可能失效"


# ===== 行为证据：同步准备段真的跑在 worker 线程上（Event 屏障，不用 sleep 阈值）=====


def _spy_close(db: Any, sink: list[int]) -> None:
    """把 ``db.close`` 换成"先记线程再真关"，用来证明连接是从 worker 归还的。"""
    real_close = db.close

    def _close() -> None:
        sink.append(_tid())
        real_close()

    db.close = _close


@pytest.fixture
def resume_record(db_session: Any) -> ResumeRecord:
    """真实落库的一份简历记录（两个端点都要按 id 读它）。"""
    record = ResumeRecord(title="张三-后端开发工程师", content={"name": "张三"})
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def test_risk_scan_prepare_runs_off_loop(
    monkeypatch: pytest.MonkeyPatch, db_session: Any, resume_record: ResumeRecord
) -> None:
    """纯准备型入口：``_prepare_scan`` 在 worker 里跑，事件循环全程可推进。

    屏障即证据：worker 拿住后再等 ``release``，只有"同步段不在事件循环线程上"时
    测试主线程才能走到 ``release.set()``。旧实现（在事件循环上直调）会卡在
    ``release.wait()`` 里 3 秒后自己抛错，失败信息就是那句话。
    """
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    closed: list[int] = []
    real_prepare = risk_api._prepare_scan

    def barrier_prepare(db: Any, resume_id: int, enhance: bool):  # noqa: ANN202
        threads["prepare"] = _tid()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("体检准备阶段等待放行超时：事件循环被同步阶段占住")
        # 屏障放行后再真跑一遍准备段：真读库、真关连接，语义没有被假实现替换。
        return real_prepare(db, resume_id, enhance)

    monkeypatch.setattr(risk_api, "_prepare_scan", barrier_prepare)
    # 只关心线程边界：把模型配置钉成"未配置"，让 provider 一定是 None，纯本地规则。
    monkeypatch.setattr(risk_api, "get_llm_config", lambda _db: LLMConfig(base_url="", model=""))
    _spy_close(db_session, closed)

    async def scenario() -> RiskScanOut:
        task = asyncio.create_task(
            risk_api.risk_scan(  # type: ignore[arg-type]
                resume_record.id, RiskScanRequest(enhance=False), db_session
            )
        )
        assert await asyncio.to_thread(entered.wait, 3.0), "体检准备阶段没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    result = asyncio.run(scenario())

    assert threads["prepare"] != _LOOP_THREAD, "体检准备段仍在事件循环线程上执行"
    assert closed == [threads["prepare"]], "请求连接应由同一个 worker 归还，而不是事件循环"
    assert isinstance(result, RiskScanOut)
    assert result.llm_used is False, "enhance=false 时不该有远端增强"


def test_star_rewrite_prepare_off_loop_and_model_on_loop(
    monkeypatch: pytest.MonkeyPatch, db_session: Any, resume_record: ResumeRecord
) -> None:
    """有模型 await 的入口：准备在 worker、模型协程回到事件循环，两者顺序不颠倒。

    同时证明 ``_prepare_star`` 里那句 ``db.close()`` 是 worker 干的：连接在模型调用
    开始之前就已归还，模型那几十秒不会占着请求连接。
    """
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    closed: list[int] = []
    real_prepare = writing_api._prepare_star

    def barrier_prepare(db: Any, resume_id: int, claim_id: int | None):  # noqa: ANN202
        threads["prepare"] = _tid()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("STAR 改写准备阶段等待放行超时：事件循环被同步阶段占住")
        return real_prepare(db, resume_id, claim_id)

    async def fake_rewrite_star(provider: Any, text: str, claim: Any = None) -> str:
        threads["model"] = _tid()
        # 模型调用应该在准备段归还连接之后才开始。
        assert closed, "模型调用开始前请求连接必须已经归还"
        return f"{text}（已量化）"

    monkeypatch.setattr(writing_api, "_prepare_star", barrier_prepare)
    monkeypatch.setattr(
        writing_api, "get_llm_config", lambda _db: LLMConfig(base_url="http://fake", model="m")
    )
    monkeypatch.setattr(writing_api, "create_provider", lambda _config: object())
    monkeypatch.setattr(writing_api, "rewrite_star", fake_rewrite_star)
    _spy_close(db_session, closed)

    # 只测线程边界与顺序：客户端一直在线（连断开探测都不需要真 Request）。
    async def never_disconnected() -> bool:
        return False

    request = SimpleNamespace(is_disconnected=never_disconnected)

    async def scenario() -> StarRewriteOut:
        task = asyncio.create_task(
            writing_api.star_rewrite(  # type: ignore[arg-type]
                request, resume_record.id, StarRewriteRequest(text="负责后端服务开发"), db_session
            )
        )
        assert await asyncio.to_thread(entered.wait, 3.0), "STAR 改写准备阶段没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    result = asyncio.run(scenario())

    assert threads["prepare"] != _LOOP_THREAD, "STAR 改写准备段仍在事件循环线程上执行"
    assert threads["model"] == _LOOP_THREAD, "模型协程应回到事件循环线程，而不是留在 worker 里"
    assert closed == [threads["prepare"]], "请求连接应由同一个 worker 归还，而不是事件循环"
    assert isinstance(result, StarRewriteOut)
    assert result.result == "负责后端服务开发（已量化）"

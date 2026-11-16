# SPDX-License-Identifier: Apache-2.0
"""SSE 生成器的**执行边界**：同步落库在 worker 线程 + 收盘钩子的形状与终态（RF-02）。

本批把每个入口切成「准备 → 模型 → 落库」，并让异步编排只吃一份冻结准备结果
（``AnswerPrep``）——两者的失败模式都是"看起来还能跑，但边界已经破了"，所以在这里钉死：

1. **准备段真的在 worker 里**（``POST /api/interview``）：用一个 Event 屏障把住
   准备函数。若以后有人把 ``run_sync`` 去掉（回到在事件循环上直接调），屏障永远等不到
   释放信号 → 用例超时变红，而不是变成"偶发卡顿"。
2. **收尾落库真的在 worker 里**（SSE 收盘）：同上，用屏障把住 ``_close_and_commit``。
3. **钩子形状**：收盘钩子被调用时拿到的是 ``AnswerPrep``，且一轮只调一次。若有人把它改回
   ``(db, session, provider)``，这里立刻变红——而 HTTP 层的用例不会发现（两条链路都还能
   收盘，只是钩子拿到的东西不对）。
4. **收盘不算中断**：轮数用尽那条分支是"这一答答完了"，``completed`` 必须在收盘前置真，
   否则 ``finally`` 会把已答完的回答标成 ``interrupted``，界面上出现一个点了必然 409 的
   「重新回答」。
5. **取消发生在收盘期间**：收盘已经落地、回答也不该被标 interrupted（这一轮没缺东西，
   缺的只是那份还没推送的 ``done``）。
6. **跨 ``await`` 只传 id**：同一会话里两条回答时，只有 ``prep.answer_id`` 那条会被标
   ``interrupted``——传错行会把用户已经答完的一轮改坏。

屏障纪律：全部用 ``threading.Event`` + ``asyncio.to_thread`` 等待，**不用 sleep 凑超时**，
所以既没有 flaky 窗口，也不会因为机器慢而假红（超时值 3–5 秒只是"死锁保险丝"）。
"""

import asyncio
import json
import threading
from types import SimpleNamespace
from typing import Any

import pytest
from app.api import interview as interview_api
from app.api.interview import _answer_stream_events
from app.api.interview_stream import make_answer_stream
from app.api.interview_units import AnswerPrep
from app.models.interview import InterviewSession
from app.schemas.interview import InterviewCreate
from app.services.interview.interview import (
    MESSAGE_STATUS_COMPLETE,
    MESSAGE_STATUS_INTERRUPTED,
    add_message,
)
from app.services.llm.base import LLMError
from starlette.requests import Request
from tests.interview_target_support import answer_prep, targets
from tests.interview_target_support import start_interview as _start

TURN_JSON = json.dumps({"question": "第二题", "feedback": "不错", "done": False})


def _live_request() -> Request:
    """最小可用 Request：``is_disconnected()`` 永远返回 False（本文件不测断开）。"""

    async def receive() -> dict[str, Any]:
        # 每次都给 http.request（不是 http.disconnect）：``run_until_disconnect`` 会反复问，
        # 第二次就"断开"的假通道会把模型调用取消掉，让屏障用例测成另一件事。
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/interview",
            "raw_path": b"/api/interview",
            "query_string": b"",
            "headers": [(b"content-type", b"application/json")],
            "path_params": {},
            "server": ("testserver", 80),
            "client": ("testclient", 123),
        },
        receive,
    )


class _Provider:
    """按脚本吐 delta 的假 provider：``fail_with`` / ``cancel_after`` 决定这一轮怎么结束。"""

    def __init__(self, chunks=None, *, fail_with=None, cancel_after: bool = False) -> None:
        self.chunks = list(chunks or [])
        self.fail_with = fail_with
        self.cancel_after = cancel_after

    async def chat(self, _messages, *, thinking: bool = True) -> str:
        return TURN_JSON

    async def stream_chat_events(self, _messages, **_kwargs):
        for text in self.chunks:
            yield SimpleNamespace(text=text)
        if self.fail_with is not None:
            raise self.fail_with
        if self.cancel_after:
            raise asyncio.CancelledError


def _configure(monkeypatch, provider) -> _Provider:
    """钉住开场那两次模型调用，其余流程走真实代码。"""

    async def ask(_turn):
        return "第一题", "", False

    monkeypatch.setattr("app.api.interview._require_provider", lambda _db: (provider, "m"))
    monkeypatch.setattr("app.api.interview._ask_next_question", ask)
    return provider


def _session_with_answers(client, db_session, count: int = 1):
    """开一场面试，并手工写 ``count`` 条候选人回答（模拟"已提交、回应还没来"）。"""
    session_id = _start(client, db_session).json()["id"]
    session = db_session.get(InterviewSession, session_id)
    assert session is not None
    answers = [add_message(session, role="user", content=f"我的回答{i}") for i in range(count)]
    db_session.commit()
    return session_id, session, answers


def _messages(client, session_id: int) -> list[dict]:
    return client.get(f"/api/interview/{session_id}").json()["messages"]


def _user_messages(client, session_id: int) -> list[dict]:
    return [item for item in _messages(client, session_id) if item["role"] == "user"]


async def _drain(generator) -> list[str]:
    return [chunk async for chunk in generator]


@pytest.mark.asyncio
async def test_close_hook_receives_the_prep_and_runs_once(client, db_session, monkeypatch):
    """轮数用尽：收盘钩子拿到 ``AnswerPrep``，一轮只调一次（不能靠 db/session 实参）。"""
    provider = _configure(monkeypatch, _Provider())
    session_id, session, (answer,) = _session_with_answers(client, db_session)
    # rounds 默认 12：把这一场改成"只剩最后一轮"，走到收盘分支。
    session.rounds = 1
    db_session.commit()
    seen: list[AnswerPrep] = []

    async def close_hook(prep: AnswerPrep) -> None:
        seen.append(prep)

    events = await _drain(
        _stream_with_hook(close_hook)(
            db_session, answer_prep(db_session, session, provider, 1, answer.id)
        )
    )

    assert [json.loads(item.removeprefix("data: ").strip())["type"] for item in events] == ["done"]
    assert len(seen) == 1, "收盘钩子必须恰好被调用一次"
    prep = seen[0]
    assert isinstance(prep, AnswerPrep)
    assert prep.session is session, "钩子必须拿到这一轮的那份准备结果，而不是别的会话行"
    assert prep.answer_id == answer.id


def _stream_with_hook(close_hook):
    """真实的生成器实现，只换收盘钩子（钩子是 ``make_answer_stream`` 的注入项）。"""
    from app.api.interview import (
        _mark_interrupted,
        _resume_text,
        _session_job_text,
        _to_detail,
    )

    return make_answer_stream(
        close_hook,
        _to_detail,
        _resume_text,
        _session_job_text,
        _mark_interrupted,
    )


@pytest.mark.asyncio
async def test_round_limit_close_is_not_an_interruption(client, db_session, monkeypatch):
    """轮数用尽（正常答完）→ 回答仍是 complete，不出现"重新回答"入口。"""
    provider = _configure(monkeypatch, _Provider())
    session_id, session, (answer,) = _session_with_answers(client, db_session)
    session.rounds = 1
    session.status = "finished"
    db_session.commit()

    await _drain(
        _answer_stream_events(db_session, answer_prep(db_session, session, provider, 1, answer.id))
    )

    users = _user_messages(client, session_id)
    assert [item["status"] for item in users] == [MESSAGE_STATUS_COMPLETE]


@pytest.mark.asyncio
async def test_cancel_before_close_marks_the_round_interrupted(client, db_session, monkeypatch):
    """插话取消（生成到一半）→ 这一轮标 interrupted，且收盘钩子不该被调用。"""
    provider = _configure(
        monkeypatch,
        _Provider(
            [
                '{"question": "第二',
            ],
            cancel_after=True,
        ),
    )
    session_id, session, (answer,) = _session_with_answers(client, db_session)
    closed: list[int] = []

    async def close_hook(prep: AnswerPrep) -> None:  # pragma: no cover - 不该被调用
        closed.append(prep.answer_id)

    generator = _stream_with_hook(close_hook)(
        db_session, answer_prep(db_session, session, provider, 1, answer.id)
    )

    # 先让生成器跑起来（cancel 由 provider 里的 cancel_after 触发），再看终态。
    with pytest.raises(asyncio.CancelledError):
        [chunk async for chunk in generator]

    assert closed == [], "没有走到收盘分支时不该调用收盘钩子"
    users = _user_messages(client, session_id)
    assert [item["status"] for item in users] == [MESSAGE_STATUS_INTERRUPTED]


@pytest.mark.asyncio
async def test_cancel_during_close_keeps_the_round_complete(client, db_session, monkeypatch):
    """取消落在收盘期间：收盘已经落地，回答不该被回标成 interrupted。"""
    provider = _configure(monkeypatch, _Provider())
    session_id, session, (answer,) = _session_with_answers(client, db_session)
    session.rounds = 1
    db_session.commit()

    from app.api.interview import _close_and_commit

    async def close_then_cancel(prep: AnswerPrep) -> None:
        _close_and_commit(prep.db, prep.session)  # 真的收盘
        raise asyncio.CancelledError

    generator = _stream_with_hook(close_then_cancel)(
        db_session, answer_prep(db_session, session, provider, 1, answer.id)
    )

    with pytest.raises(asyncio.CancelledError):
        [chunk async for chunk in generator]

    detail = client.get(f"/api/interview/{session_id}").json()
    assert detail["status"] == "finished", "收盘已经落库"
    assert [item["status"] for item in detail["messages"] if item["role"] == "user"] == [
        MESSAGE_STATUS_COMPLETE
    ]


@pytest.mark.asyncio
async def test_only_the_prep_answer_id_is_marked_interrupted(client, db_session, monkeypatch):
    """跨 ``await`` 只传 id：模型这一轮失败时，只标 ``prep.answer_id`` 那条。"""
    provider = _configure(monkeypatch, _Provider(fail_with=LLMError("模型超时")))
    session_id, session, answers = _session_with_answers(client, db_session, count=2)
    target = answers[-1]

    events = await _drain(
        _answer_stream_events(db_session, answer_prep(db_session, session, provider, 2, target.id))
    )
    assert [json.loads(item.removeprefix("data: ").strip())["type"] for item in events] == ["error"]

    users = _user_messages(client, session_id)
    assert [item["status"] for item in users] == [
        MESSAGE_STATUS_COMPLETE,
        MESSAGE_STATUS_INTERRUPTED,
    ]


# ===== 执行边界：同步 DB 段真的在 worker 线程里（屏障证据，不用 sleep）=====


@pytest.mark.asyncio
async def test_create_session_prepare_runs_in_a_worker_thread(db_session, monkeypatch):
    """``POST /api/interview`` 的准备段（校验材料 + 建会话行 + 提交）不在事件循环线程上。

    屏障：被 patch 的准备函数先 ``entered.set()`` 再 ``release.wait(3)``，事件循环侧用
    ``asyncio.to_thread`` 等到它真的开始，才发释放信号。**若这段回到事件循环线程执行**，
    释放信号永远发不出去（循环被同步段占住，连 ``to_thread`` 的等待者都排不上），
    用例会以超时变红——这就是"同步 DB 段离开事件循环"的直接证据，而不是靠耗时阈值。
    """
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}

    real_prepare = interview_api.prepare_interview_session

    def probe(db, payload, **kwargs):  # noqa: ANN001, ANN202 - 屏障探针
        threads["prepare"] = threading.get_ident()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("准备段的释放信号没送达：同步段可能又跑在事件循环线程上了")
        return real_prepare(db, payload, **kwargs)

    _configure(monkeypatch, _Provider())
    monkeypatch.setattr(interview_api, "prepare_interview_session", probe)

    payload = InterviewCreate(**targets(db_session))
    task = asyncio.create_task(
        interview_api.create_session(payload, _live_request(), db_session)  # type: ignore[arg-type]
    )
    try:
        started = await asyncio.to_thread(entered.wait, 3.0)
        loop_thread = threading.get_ident()
        assert started, "准备段没有开始：它可能已经不在 run_sync 里了"
        release.set()
        detail = await asyncio.wait_for(task, 5.0)
    finally:
        release.set()
        if not task.done():
            task.cancel()

    assert threads["prepare"] != loop_thread, (
        "建会话的准备段仍在事件循环线程上执行：一次 SQLite 锁等待（busy_timeout 5 秒）"
        "就会把同进程的 SSE 与其他请求一起卡住"
    )
    # 语义没被屏障挪走：会话真的落库了，开场问题也真的写进去了。
    assert detail.status == "active"
    assert detail.messages[0].content == "第一题"


@pytest.mark.asyncio
async def test_stream_close_persists_in_a_worker_thread(client, db_session, monkeypatch):
    """SSE 收盘的落库（``_close_and_commit``）不在事件循环线程上，且终态照旧落地。

    这是"收尾落库"那一侧的同款屏障：收盘写库若回到事件循环，等待者会在同一线程上排队，
    释放信号永远送不到（用例超时变红）。
    """
    provider = _configure(monkeypatch, _Provider())
    session_id, session, (answer,) = _session_with_answers(client, db_session)
    # 已收盘 + 轮数用尽：走 ``_auto_close`` 的幂等分支，只做一次"提交刷新"，不调模型。
    session.rounds = 1
    session.status = "finished"
    db_session.commit()

    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    real_close = interview_api._close_and_commit

    def probe(db, target_session, reply=""):  # noqa: ANN001, ANN202 - 屏障探针
        threads["close"] = threading.get_ident()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("收盘落库的释放信号没送达：它可能又跑在事件循环线程上了")
        return real_close(db, target_session, reply)

    monkeypatch.setattr(interview_api, "_close_and_commit", probe)

    async def consume() -> list[str]:
        return [
            chunk
            async for chunk in _answer_stream_events(
                db_session, answer_prep(db_session, session, provider, 1, answer.id)
            )
        ]

    task = asyncio.create_task(consume())
    try:
        started = await asyncio.to_thread(entered.wait, 3.0)
        loop_thread = threading.get_ident()
        assert started, "收盘落库没有开始：它可能已经不在 run_sync 里了"
        release.set()
        events = await asyncio.wait_for(task, 5.0)
    finally:
        release.set()
        if not task.done():
            task.cancel()

    assert threads["close"] != loop_thread, (
        "收盘的落库仍在事件循环线程上执行：SQLite 写事务会占住循环（busy_timeout 5 秒），"
        "客户端断开时这一轮终态就可能写不进去"
    )
    assert [json.loads(item.removeprefix("data: ").strip())["type"] for item in events] == ["done"]
    # 屏障没有把语义搅乱：回答仍是 complete（收盘分支不是中断），会话仍是 finished。
    detail = client.get(f"/api/interview/{session_id}").json()
    assert detail["status"] == "finished"
    assert [item["status"] for item in _user_messages(client, session_id)] == [
        MESSAGE_STATUS_COMPLETE
    ]


# 自检用的护栏：只验证"判据能命中"，不需要 3 秒，也只在**失败形态**下等这么久。
_SELF_CHECK_FUSE = 0.2


@pytest.mark.asyncio
async def test_prepare_barrier_detects_a_loop_thread_regression(db_session, monkeypatch):
    """自检①：把 ``run_sync`` 换成"就地调用"（= 回到事件循环线程）时，上面那条判据必须命中。

    没有这一条，上面两条屏障用例可能只是装饰：即使准备段真的跑在事件循环上，
    探针也能 ``entered.set()`` 成功、测试照样绿。这里把回归形态直接造出来，断言探针
    **落在事件循环线程**且释放信号等不到——判据因此是被证明有效的。
    """
    release = threading.Event()
    seen: dict[str, int] = {}
    real_prepare = interview_api.prepare_interview_session

    def probe(db, payload, **kwargs):  # noqa: ANN001, ANN202 - 屏障探针
        seen["thread"] = threading.get_ident()
        if not release.wait(_SELF_CHECK_FUSE):
            raise AssertionError("屏障命中：同步段跑在事件循环线程上")
        return real_prepare(db, payload, **kwargs)

    async def inline_run_sync(func, *args, **kwargs):  # noqa: ANN001, ANN202 - 回归形态
        return func(*args, **kwargs)

    _configure(monkeypatch, _Provider())
    monkeypatch.setattr(interview_api, "prepare_interview_session", probe)
    monkeypatch.setattr(interview_api, "run_sync", inline_run_sync)

    with pytest.raises(AssertionError, match="屏障命中"):
        await interview_api.create_session(
            InterviewCreate(**targets(db_session)),
            _live_request(),
            db_session,  # type: ignore[arg-type]
        )
    assert seen["thread"] == threading.get_ident(), "自检自身失效：探针没落在事件循环线程上"


@pytest.mark.asyncio
async def test_close_barrier_detects_a_loop_thread_regression(client, db_session, monkeypatch):
    """自检②：收盘落库回到事件循环线程时，SSE 那条判据同样必须命中。"""
    provider = _configure(monkeypatch, _Provider())
    session_id, session, (answer,) = _session_with_answers(client, db_session)
    session.rounds = 1
    session.status = "finished"
    db_session.commit()

    release = threading.Event()
    seen: dict[str, int] = {}
    real_close = interview_api._close_and_commit

    def probe(db, target_session, reply=""):  # noqa: ANN001, ANN202 - 屏障探针
        seen["thread"] = threading.get_ident()
        if not release.wait(_SELF_CHECK_FUSE):
            raise AssertionError("屏障命中：收盘落库跑在事件循环线程上")
        return real_close(db, target_session, reply)

    async def inline_run_sync(func, *args, **kwargs):  # noqa: ANN001, ANN202 - 回归形态
        return func(*args, **kwargs)

    monkeypatch.setattr(interview_api, "_close_and_commit", probe)
    monkeypatch.setattr(interview_api, "run_sync", inline_run_sync)

    with pytest.raises(AssertionError, match="屏障命中"):
        await _drain(
            _answer_stream_events(
                db_session, answer_prep(db_session, session, provider, 1, answer.id)
            )
        )
    assert seen["thread"] == threading.get_ident(), "自检自身失效：探针没落在事件循环线程上"

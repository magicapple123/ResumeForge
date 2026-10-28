# SPDX-License-Identifier: Apache-2.0
"""模拟面试「中途停止」的一致性契约。

面试是**强交互流式**：用户的消息先落库、再流式生成面试官那句回应。客户端在这一步断开
（用户点了「停止本轮」，或者直接关掉页面）会留下"我说了话、面试官没接话"的不一致。
这里钉住收口方式：**不删用户数据**，把那一轮标成 ``interrupted``，然后允许原样重答。

重答走的是原来的提问链路（同一句话再提交一次），所以后端必须**复用**那条被中断的回答，
不能写出第二条一模一样的用户消息——否则进度条会多走一轮、转录里同一句出现两遍。
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from app.api.interview import _answer_stream_events
from app.models.interview import InterviewSession
from app.services.interview.interview import (
    MESSAGE_STATUS_COMPLETE,
    MESSAGE_STATUS_INTERRUPTED,
    add_message,
    mark_answer_interrupted,
)
from app.services.llm.base import LLMError
from tests.interview_target_support import start_interview as _start


def _turn_json(question: str = "第二题", feedback: str = "不错", done: bool = False) -> str:
    return json.dumps(
        {"question": question, "feedback": feedback, "done": done}, ensure_ascii=False
    )


class _Provider:
    """替身：非流式那条路（开场）返回预设 JSON，流式那条路按片段推文本。

    ``cancel_after`` 用来模拟客户端断开——Starlette 关闭 SSE 生成器时就是把取消/关闭
    信号送进正在 ``await`` 的那一行，这里用同样的异常形状复现。
    """

    def __init__(
        self,
        *,
        replies: list[str] | None = None,
        chunks: list[str] | None = None,
        cancel_after: bool = False,
        fail_with: Exception | None = None,
    ) -> None:
        self.replies = list(replies or [])
        self.chunks = list(chunks or [])
        self.cancel_after = cancel_after
        self.fail_with = fail_with

    async def chat(self, _messages, *, thinking: bool = True) -> str:
        return self.replies.pop(0) if self.replies else _turn_json("第一题")

    async def stream_chat_events(self, _messages, **_kwargs):
        for text in self.chunks:
            yield SimpleNamespace(text=text)
        if self.fail_with is not None:
            raise self.fail_with
        if self.cancel_after:
            raise asyncio.CancelledError


def _configure(monkeypatch, provider: _Provider) -> _Provider:
    monkeypatch.setattr("app.api.interview._require_provider", lambda _db: (provider, "test-model"))
    return provider


def _session_with_answer(client, db_session, *, content: str = "我的回答"):
    """开一场面试，再手工把这一轮的候选人回答写进库（模拟"已提交、回应还没来"）。"""
    session_id = _start(client, db_session).json()["id"]
    session = db_session.get(InterviewSession, session_id)
    assert session is not None
    answer = add_message(session, role="user", content=content)
    db_session.commit()
    return session_id, session, answer


def _messages(client, session_id: int) -> list[dict]:
    return client.get(f"/api/interview/{session_id}").json()["messages"]


@pytest.mark.asyncio
async def test_disconnect_marks_the_round_interrupted_and_keeps_the_answer(
    client, db_session, monkeypatch
):
    """客户端断开：这一轮标 interrupted，用户那条消息原样留在记录里。"""
    provider = _configure(
        monkeypatch, _Provider(chunks=['{"question": "第二题"'], cancel_after=True)
    )
    session_id, session, answer = _session_with_answer(client, db_session)

    with pytest.raises(asyncio.CancelledError):
        async for _chunk in _answer_stream_events(db_session, session, provider, 1, answer):
            pass

    messages = _messages(client, session_id)
    users = [item for item in messages if item["role"] == "user"]
    assert len(users) == 1, "用户那条消息不能被删掉"
    assert users[0]["content"] == "我的回答"
    assert users[0]["status"] == MESSAGE_STATUS_INTERRUPTED
    # 面试官那一句确实没生成出来：不一致被如实记下来，而不是留一条假问题。
    assert [item for item in messages if item["role"] == "interviewer"] == messages[:1]
    assert client.get(f"/api/interview/{session_id}").json()["answered_rounds"] == 1


@pytest.mark.asyncio
async def test_model_failure_also_leaves_the_round_re_answerable(client, db_session, monkeypatch):
    """模型这一轮失败（error 事件）同样标 interrupted：用户能接着重答，不用重写一遍。"""
    provider = _configure(monkeypatch, _Provider(fail_with=LLMError("模型超时")))
    session_id, session, answer = _session_with_answer(client, db_session)

    event_types = [
        json.loads(chunk.removeprefix("data: ").strip())["type"]
        async for chunk in _answer_stream_events(db_session, session, provider, 1, answer)
    ]
    assert event_types == ["error"]

    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert len(users) == 1
    assert users[0]["status"] == MESSAGE_STATUS_INTERRUPTED


def test_reanswer_reuses_the_interrupted_round(client, db_session, monkeypatch):
    """重答复用那条被中断的回答：记录里始终只有一条用户消息，状态回到 complete。"""
    _configure(monkeypatch, _Provider(chunks=[_turn_json("第二题")]))
    session_id, _session_, answer = _session_with_answer(client, db_session)
    mark_answer_interrupted(answer)
    db_session.commit()
    assert answer.status == MESSAGE_STATUS_INTERRUPTED

    response = client.post(
        f"/api/interview/{session_id}/answers/stream", json={"content": "我的回答"}
    )
    assert response.status_code == 200, response.text

    messages = _messages(client, session_id)
    users = [item for item in messages if item["role"] == "user"]
    assert len(users) == 1, "重答不该再写一条一模一样的用户消息"
    assert users[0]["status"] == MESSAGE_STATUS_COMPLETE
    # 面试官这句回应这次生成出来了，这一轮才算走完。
    assert messages[-1]["role"] == "interviewer"
    assert messages[-1]["content"] == "第二题"
    assert client.get(f"/api/interview/{session_id}").json()["answered_rounds"] == 1


def test_reanswer_can_carry_a_new_answer(client, db_session, monkeypatch):
    """重答也可以改内容：以本次提交为准（用户看完提示再补几句是常态）。"""
    _configure(monkeypatch, _Provider(chunks=[_turn_json("第二题")]))
    session_id, _session_, answer = _session_with_answer(client, db_session, content="旧内容")
    mark_answer_interrupted(answer)
    db_session.commit()

    client.post(f"/api/interview/{session_id}/answers/stream", json={"content": "补充后的回答"})

    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert len(users) == 1
    assert users[0]["content"] == "补充后的回答"


def test_a_completed_round_is_not_marked_interrupted(client, db_session, monkeypatch):
    """正常走完的一轮保持 complete，下次回答也不会被"复用"成覆盖上一条。"""
    _configure(monkeypatch, _Provider(chunks=[_turn_json("第二题"), _turn_json("第三题")]))
    session_id = _start(client, db_session).json()["id"]

    for content in ("第一个回答", "第二个回答"):
        assert (
            client.post(
                f"/api/interview/{session_id}/answers/stream", json={"content": content}
            ).status_code
            == 200
        )

    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert [item["content"] for item in users] == ["第一个回答", "第二个回答"]
    assert {item["status"] for item in users} == {MESSAGE_STATUS_COMPLETE}

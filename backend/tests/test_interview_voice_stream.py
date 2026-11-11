# SPDX-License-Identifier: Apache-2.0
"""#26 P0 实时语音的服务端契约：``client_turn_id`` 幂等、cancel → interrupted、回滚上下文。

三条验收线，各自在这里钉死：

1. **幂等**：同一轮重复 POST 不再调用模型、不再写第二条用户消息（回放 ``done``）；
   同一轮正在生成时再提交 → 409。
2. **cancel**：独立 cancel 请求 → 生成器在下一个 delta 边界停下，写回"已播出"的部分回应，
   用户回答保持（``interrupted``，可重答），回滚字数如实记在 context 里。
3. **下一轮上下文**：模型看到的提示词里出现「上一轮的回答被候选人打断，只说到 X」，
   且**不含**用户没听过的那一部分。

断开连接（不 cancel）的老行为保持不变：由 ``test_interview_interrupt.py` 覆盖。
"""

import json
from types import SimpleNamespace

import pytest
from app.api.interview import _answer_stream_events
from app.api.interview_voice import (
    active_turn_count,
    register_turn,
    unregister_turn,
)
from app.models.interview import InterviewSession
from app.services.interview.interview import (
    MESSAGE_STATUS_COMPLETE,
    MESSAGE_STATUS_INTERRUPTED,
    add_message,
)
from app.services.interview.voice_turns import INTERRUPTED_MARKER
from app.services.llm.base import LLMError
from tests.interview_target_support import start_interview as _start

STREAM_URL = "/api/interview/{session_id}/answers/stream"
CANCEL_URL = "/api/interview/voice/turns/cancel"

# 模型输出切成两段：第一段里 question 的字符串值已经完整（含收尾引号），
# 提取器会在它之后停止；第二段只是补齐合法 JSON。真实模型也是这样分片的。
QUESTION_CHUNKS = [
    '{"question": "请举一个具体的例子说明你的贡献",',
    ' "feedback": "不错", "done": false}',
]
FULL_QUESTION = "请举一个具体的例子说明你的贡献"
TURN_JSON = json.dumps(
    {"question": "下一题", "feedback": "不错", "done": False}, ensure_ascii=False
)


class _Provider:
    """替身：``chat`` 负责开场，``stream_chat_events`` 按片段推流并记录收到的消息。"""

    def __init__(self, *, chunks=None, fail_with=None) -> None:
        self.chunks = list(chunks if chunks is not None else [TURN_JSON])
        self.fail_with = fail_with
        self.replies: list[str] = []
        self.stream_calls = 0
        self.stream_messages: list[list[dict]] = []

    async def chat(self, _messages, *, thinking: bool = True) -> str:
        if self.replies:
            return self.replies.pop(0)
        return json.dumps(
            {"question": "请先做自我介绍", "feedback": "", "done": False}, ensure_ascii=False
        )

    async def stream_chat_events(self, messages, **_kwargs):
        self.stream_calls += 1
        self.stream_messages.append(messages)
        for text in self.chunks:
            yield SimpleNamespace(text=text)
        if self.fail_with is not None:
            raise self.fail_with


def _configure(monkeypatch, provider: _Provider) -> _Provider:
    monkeypatch.setattr("app.api.interview._require_provider", lambda _db: (provider, "test-model"))
    return provider


def _events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: ").strip())
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def _messages(client, session_id: int) -> list[dict]:
    return client.get(f"/api/interview/{session_id}").json()["messages"]


def _answer(client, db_session, *, content: str = "我的回答"):
    """开一场面试，再手工写一条候选人回答（模拟"已提交、回应还没来"）。"""
    session_id = _start(client, db_session).json()["id"]
    session = db_session.get(InterviewSession, session_id)
    assert session is not None
    answer = add_message(session, role="user", content=content)
    db_session.commit()
    return session_id, session, answer


def test_duplicate_client_turn_id_replays_without_generating_again(client, db_session, monkeypatch):
    """同一轮重复提交：直接回放 done，不重复调用模型、不重复计轮。"""
    provider = _configure(monkeypatch, _Provider(chunks=[TURN_JSON]))
    session_id = _start(client, db_session).json()["id"]
    payload = {"content": "我的回答", "client_turn_id": "turn-1"}

    first = client.post(STREAM_URL.format(session_id=session_id), json=payload)
    assert first.status_code == 200
    first_events = _events(first)
    assert [event["type"] for event in first_events] == ["question_delta", "done"]
    assert provider.stream_calls == 1

    second = client.post(STREAM_URL.format(session_id=session_id), json=payload)
    assert second.status_code == 200
    second_events = _events(second)
    assert [event["type"] for event in second_events] == ["done"]
    assert second_events[0]["replayed"] is True
    assert provider.stream_calls == 1, "重复请求不能重新生成"

    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert len(users) == 1, "重复请求不能写出第二条用户消息"
    assert client.get(f"/api/interview/{session_id}").json()["answered_rounds"] == 1


def test_interrupted_turn_can_be_retried_with_the_same_turn_id(client, db_session, monkeypatch):
    """被中断的一轮用同一个幂等键重发：复用那条回答，生成成功即补上。"""
    failing = _configure(monkeypatch, _Provider(fail_with=LLMError("模型超时")))
    payload = {"content": "我的回答", "client_turn_id": "turn-1"}
    session_id = _start(client, db_session).json()["id"]

    first = client.post(STREAM_URL.format(session_id=session_id), json=payload)
    # 先推了一段问题、再报错：这一轮没走完，用户回答要能重答。
    assert [event["type"] for event in _events(first)][-1] == "error"
    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert users[0]["status"] == MESSAGE_STATUS_INTERRUPTED

    _configure(monkeypatch, _Provider(chunks=[TURN_JSON]))
    second = client.post(STREAM_URL.format(session_id=session_id), json=payload)
    assert [event["type"] for event in _events(second)] == ["question_delta", "done"]
    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert len(users) == 1, "重发同一轮不能追加第二条用户消息"
    assert users[0]["status"] == MESSAGE_STATUS_COMPLETE
    assert failing.stream_calls == 1


def test_concurrent_duplicate_turn_is_rejected(client, db_session, monkeypatch):
    """同一轮已经在生成中：再提交 → 409（不重复计轮、不让两条流同时写库）。"""
    _configure(monkeypatch, _Provider())
    session_id = _start(client, db_session).json()["id"]
    control = register_turn(session_id, "turn-1")
    try:
        response = client.post(
            STREAM_URL.format(session_id=session_id),
            json={"content": "我的回答", "client_turn_id": "turn-1"},
        )
        assert response.status_code == 409
        assert "正在生成" in response.json()["detail"]
    finally:
        unregister_turn(control)


def test_cancel_route_marks_the_active_turn(client):
    """cancel 端点把活动轮次标成取消，并按上报的播放位置估算回滚字数。"""
    control = register_turn(4242, "turn-x")
    control.sent_text = "六个字符"
    try:
        response = client.post(
            CANCEL_URL,
            json={"session_id": 4242, "client_turn_id": "turn-x", "played_chars": 3},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["cancelled"] == 1
        assert body["generated_chars"] == 4
        assert body["played_chars"] == 3
        assert body["rolled_back_chars"] == 1
        assert control.cancelled is True
        assert control.played_chars == 3
    finally:
        unregister_turn(control)


def test_cancel_route_is_idempotent_when_nothing_is_active(client):
    assert active_turn_count() == 0
    response = client.post(CANCEL_URL, json={})
    assert response.status_code == 200
    assert response.json()["cancelled"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"played_chars": -1},
        {"played_chars": 1.5},
        {"unknown_field": 1},
        {"client_turn_id": "x" * 65},
    ],
)
def test_cancel_route_rejects_invalid_payload(client, payload):
    assert client.post(CANCEL_URL, json=payload).status_code == 422


@pytest.mark.asyncio
async def test_cancel_mid_stream_rolls_back_to_played_text(client, db_session, monkeypatch):
    """生成到一半 cancel：写回"已播出"的部分回应，其余记成回滚字数。"""
    provider = _configure(monkeypatch, _Provider(chunks=QUESTION_CHUNKS))
    session_id, session, answer = _answer(client, db_session)

    generator = _answer_stream_events(db_session, session, provider, 1, answer)
    first = await generator.__anext__()
    first_event = json.loads(first.removeprefix("data: ").strip())
    assert first_event["type"] == "question_delta"
    assert first_event["text"] == FULL_QUESTION

    cancel = client.post(
        CANCEL_URL,
        json={"session_id": session_id, "played_chars": 5},
    )
    assert cancel.status_code == 200
    assert cancel.json()["cancelled"] == 1

    events = [first_event]
    async for chunk in generator:
        events.append(json.loads(chunk.removeprefix("data: ").strip()))
    assert events[-1]["type"] == "interrupted"
    assert events[-1]["played_chars"] == 5
    assert events[-1]["generated_chars"] == len(FULL_QUESTION)
    assert events[-1]["rolled_back_chars"] == len(FULL_QUESTION) - 5
    assert events[-1]["text"] == FULL_QUESTION[:5]

    messages = _messages(client, session_id)
    users = [item for item in messages if item["role"] == "user"]
    assert len(users) == 1, "被打断的那一轮不能删用户回答"
    assert users[0]["status"] == MESSAGE_STATUS_INTERRUPTED
    partials = [
        item
        for item in messages
        if item["role"] == "interviewer" and item["context"].get("interrupted")
    ]
    assert len(partials) == 1
    partial = partials[0]
    assert partial["content"].startswith(FULL_QUESTION[:5])
    assert INTERRUPTED_MARKER in partial["content"]
    assert FULL_QUESTION[5:] not in partial["content"]
    assert partial["context"]["played_chars"] == 5
    assert partial["context"]["rolled_back_chars"] == len(FULL_QUESTION) - 5
    assert active_turn_count() == 0, "生成结束必须注销活动轮次"


@pytest.mark.asyncio
async def test_next_round_prompt_only_quotes_played_text(client, db_session, monkeypatch):
    """下一轮提示词里有「上一轮被打断」，且只引用播出过的文本。"""
    provider = _configure(monkeypatch, _Provider(chunks=QUESTION_CHUNKS))
    session_id, session, answer = _answer(client, db_session)
    generator = _answer_stream_events(db_session, session, provider, 1, answer)
    await generator.__anext__()
    client.post(CANCEL_URL, json={"session_id": session_id, "played_chars": 5})
    async for _chunk in generator:
        pass

    next_provider = _configure(monkeypatch, _Provider(chunks=[TURN_JSON]))
    response = client.post(
        STREAM_URL.format(session_id=session_id),
        json={"content": "我接着说", "client_turn_id": "turn-2"},
    )
    assert response.status_code == 200
    assert next_provider.stream_calls == 1
    sent = next_provider.stream_messages[0]
    dump = json.dumps(sent, ensure_ascii=False)
    assert "上一轮的回答被候选人打断" in dump
    assert FULL_QUESTION[:5] in dump
    assert FULL_QUESTION[5:] not in dump, "没播出去的文本不能进模型上下文"


def test_stream_without_client_turn_id_keeps_legacy_behavior(client, db_session, monkeypatch):
    """纯文字调用方不传幂等键：行为与以前逐字一致（同一句话提交两次 = 两轮）。"""
    provider = _configure(monkeypatch, _Provider(chunks=[TURN_JSON, TURN_JSON]))
    session_id = _start(client, db_session).json()["id"]
    for _ in range(2):
        response = client.post(
            STREAM_URL.format(session_id=session_id), json={"content": "相同回答"}
        )
        assert response.status_code == 200
    users = [item for item in _messages(client, session_id) if item["role"] == "user"]
    assert [item["content"] for item in users] == ["相同回答", "相同回答"]
    assert provider.stream_calls == 2


@pytest.mark.asyncio
async def test_interrupted_context_is_visible_in_session_detail(client, db_session, monkeypatch):
    """被打断的部分回应会落库成一条带 context 的面试官消息（刷新后 UI/报告都看得到）。"""
    provider = _configure(monkeypatch, _Provider(chunks=QUESTION_CHUNKS))
    session_id, session, answer = _answer(client, db_session)
    generator = _answer_stream_events(db_session, session, provider, 1, answer)
    await generator.__anext__()
    client.post(CANCEL_URL, json={"session_id": session_id, "played_chars": 2})
    async for _chunk in generator:
        pass

    detail = client.get(f"/api/interview/{session_id}").json()
    interrupted = [
        item
        for item in detail["messages"]
        if item["role"] == "interviewer" and item["context"].get("interrupted")
    ]
    assert len(interrupted) == 1
    assert interrupted[0]["status"] == MESSAGE_STATUS_COMPLETE

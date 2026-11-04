# SPDX-License-Identifier: Apache-2.0
"""模拟面试的**收尾语**（2026-11-04 用户口径）。

用户原话：「我希望模拟面试我这边回答完最后一个问题之后，面试官要回复我了之后才说结束
（可以对我的最后一个回答做回复，然后说一些让我回去等通知之类的话），我这边可以选择
继续追问」。

此前轮数用尽直接 ``_close_session``：界面上最后一句话是候选人的回答，紧跟着就是
「本场正式问答已结束」——真实面试里不会这样。现在顺序是：
最后一答落库 → **多跑一次模型换一段"点评最后那段 + 收尾"** → 落成面试官消息 →
收盘 → 决策卡（继续追问 / 结束并生成报告）。

这里钉住四件事：
1. 轮数用尽时确实多出一条面试官消息，且被标成 ``closing``（前端据此不再补兜底文案）；
2. 这次调用失败时**不写空消息**、仍然收盘（否则用户卡在一场结束不了的面试里）；
3. 幂等：重复收盘不会写出第二条告别；
4. 模型提前 ``done`` 的那句就是告别，不会再补第二段。
"""

from __future__ import annotations

import json

import pytest
from app.services.llm.base import LLMError
from tests.interview_target_support import start_interview as _start

_DEFAULT_REPORT = {
    "score": 80,
    "dimensions": [{"name": "技术", "score": 80, "comment": "细节到位"}],
    "strengths": ["结构清楚"],
    "improvements": ["补充数据"],
    "summary": "整体不错",
}

_CLOSING_TEXT = "你最后那段把背景和目标说清了，但结果缺一个数字。今天先到这里，后面有结果会通知你。"


def _is_closing_prompt(messages) -> bool:
    """收尾那一轮与提问轮的区别：系统提示里写着"正式问答已经全部问完"。"""
    system = next((item["content"] for item in messages if item["role"] == "system"), "")
    return "正式问答已经全部问完" in system


class _ClosingProvider:
    """按提示词种类回包：提问轮给问题 JSON，收尾轮给 ``{"reply": ...}``。

    比"按顺序弹预设"更稳：收尾那次调用发生在哪一轮、会不会被跳过，与用例写的顺序无关。
    """

    def __init__(self, *, closing_reply: str | None = _CLOSING_TEXT, fail_closing=False):
        self.closing_reply = closing_reply
        self.fail_closing = fail_closing
        self.calls: list[str] = []

    async def chat(self, messages, *, thinking: bool = True):
        if _is_closing_prompt(messages):
            self.calls.append("closing")
            if self.fail_closing:
                raise LLMError("收尾失败")
            return json.dumps({"reply": self.closing_reply or ""}, ensure_ascii=False)
        self.calls.append("turn")
        return json.dumps({"question": "再讲讲那次扩容的细节", "feedback": "还行", "done": False})


def _configure(monkeypatch, provider: _ClosingProvider) -> None:
    async def build_report(_provider, _session_):
        return _DEFAULT_REPORT

    monkeypatch.setattr("app.api.interview._require_provider", lambda _db: (provider, "test-model"))
    monkeypatch.setattr("app.api.interview.generate_report", build_report)


def _answer_all(client, session_id: int, times: int = 3) -> dict:
    """把一场面试答满：返回**最后一次**的回答结果（收尾就发生在这一次）。"""
    payload: dict = {}
    for index in range(times):
        response = client.post(
            f"/api/interview/{session_id}/answers", json={"content": f"第 {index + 1} 次回答"}
        )
        assert response.status_code == 200, response.text
        payload = response.json()
    return payload


def _closing_messages(payload: dict) -> list[dict]:
    return [
        item
        for item in payload["messages"]
        if item["role"] == "interviewer" and (item.get("context") or {}).get("closing")
    ]


def test_last_answer_gets_a_closing_reply_before_the_interview_ends(
    client, db_session, monkeypatch
):
    provider = _ClosingProvider()
    _configure(monkeypatch, provider)
    session_id = _start(client, db_session, rounds=3).json()["id"]

    payload = _answer_all(client, session_id)
    # 答完最后一题就收盘（报告仍留给决策卡），但**面试官先说了话**。
    assert payload["finished"] is True
    assert payload["needs_report"] is True
    closing = _closing_messages(payload["session"])
    assert len(closing) == 1
    assert closing[0]["content"] == _CLOSING_TEXT
    # 收尾那段不能被算成一轮问答，否则刷新后进度会从 1/1 涨到 2/1。
    assert answered_rounds_for(payload["session"]) == 3
    # 每轮一次提问调用，最后一轮多一次收尾调用。
    assert provider.calls == ["turn", "turn", "turn", "closing"]


def answered_rounds_for(session_payload: dict) -> int:
    """按接口返回的消息算"正式回答过几次"，与后端 ``answered_rounds`` 同口径。"""
    return sum(
        1
        for item in session_payload["messages"]
        if item["role"] == "user" and item.get("phase", "interview") == "interview"
    )


def test_closing_call_failure_still_ends_without_an_empty_message(client, db_session, monkeypatch):
    provider = _ClosingProvider(fail_closing=True)
    _configure(monkeypatch, provider)
    session_id = _start(client, db_session, rounds=3).json()["id"]

    payload = _answer_all(client, session_id)
    assert payload["finished"] is True
    # 不留空消息：前端会用本地化兜底文案补一句，库里不存半成品。
    assert _closing_messages(payload["session"]) == []
    assert all(item["content"].strip() for item in payload["session"]["messages"])


def test_closing_is_written_once_even_if_close_runs_twice(client, db_session, monkeypatch):
    provider = _ClosingProvider()
    _configure(monkeypatch, provider)
    session_id = _start(client, db_session, rounds=3).json()["id"]
    _answer_all(client, session_id)

    # 已经在结束态：再次提交必须 409，且**不会**再写一条告别。
    again = client.post(f"/api/interview/{session_id}/answers", json={"content": "再来一次"})
    assert again.status_code == 409
    detail = client.get(f"/api/interview/{session_id}").json()
    assert len(_closing_messages(detail)) == 1
    assert provider.calls.count("closing") == 1


def test_model_done_turn_is_the_only_farewell(client, db_session, monkeypatch):
    """模型自己收尾时，那句 ``question`` 就是告别；不能再补第二段。"""

    class _DoneProvider:
        def __init__(self):
            self.calls: list[str] = []

        async def chat(self, messages, *, thinking: bool = True):
            if _is_closing_prompt(messages):
                self.calls.append("closing")
                return json.dumps({"reply": "再说一句告别"}, ensure_ascii=False)
            self.calls.append("turn")
            return json.dumps(
                {
                    "question": "今天先聊到这里，回去等通知",
                    "feedback": "最后一答还行",
                    "done": True,
                },
                ensure_ascii=False,
            )

    provider = _DoneProvider()
    _configure(monkeypatch, provider)
    session_id = _start(client, db_session, rounds=3).json()["id"]

    payload = client.post(f"/api/interview/{session_id}/answers", json={"content": "答完了"}).json()

    assert payload["finished"] is True
    closing = _closing_messages(payload["session"])
    assert len(closing) == 1
    assert closing[0]["content"] == "今天先聊到这里，回去等通知"
    # 没有再为"收尾"多跑一次模型：模型已经自己告别了（两次 turn = 开场 + 这一答）。
    assert "closing" not in provider.calls
    assert provider.calls == ["turn", "turn"]


def test_closing_prompt_carries_the_last_answer():
    """收尾提示词必须带上对话记录：不带就只有人设，模型会写出与最后一答无关的客套话。"""
    from app.models.interview import InterviewMessage, InterviewSession
    from app.services.interview.interview import build_closing_messages

    session = InterviewSession(
        title="后端开发 模拟面试",
        job_title="后端开发工程师",
        company="示例公司",
        interview_type="技术面",
        difficulty="中级",
        interviewer_style="持续追问",
        rounds=1,
        focus="Go 并发",
        persona="",
    )
    session.messages = [
        InterviewMessage(role="interviewer", content="请讲讲你做过的高并发项目", phase="interview"),
        InterviewMessage(role="user", content="我做的是订单履约，峰值 3000 QPS", phase="interview"),
    ]

    messages = build_closing_messages(session)

    assert "正式问答已经全部问完" in messages[0]["content"]
    assert "订单履约，峰值 3000 QPS" in messages[1]["content"]
    # 提问轮的输出格式不能出现：收尾只许回一句话，不许再问。
    assert '"question"' not in messages[0]["content"]


def test_parse_closing_rejects_empty_reply():
    from app.services.interview.interview import parse_closing

    assert parse_closing('{"reply": "回去等通知"}') == "回去等通知"
    with pytest.raises(LLMError):
        parse_closing('{"reply": "   "}')

# SPDX-License-Identifier: Apache-2.0
"""模拟面试的「有效时长」（0066）：上报接口、取大值语义、报告提示词里的用时。

时长不是 ``created_at`` 差值：界面要等候选人点「准备好了」才开始计时、中途离开会暂停，
所以它是前端累计后**整份上报**的绝对值，服务端只做 ``max()`` 防回退。
"""

from __future__ import annotations

from app.services.interview.interview import build_report_messages
from tests.interview_target_support import start_interview as _start
from tests.test_interview import _configure, _session


def test_duration_keeps_the_largest_reported_value(client, db_session, monkeypatch):
    """绝对累计值 + 取大值：乱序或重试的旧请求不会把时长往回拨。"""
    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])
    session_id = _start(client, db_session, rounds=3).json()["id"]

    first = client.put(f"/api/interview/{session_id}/duration", json={"elapsed_seconds": 65})
    assert first.status_code == 200, first.text
    assert first.json()["duration_seconds"] == 65

    second = client.put(f"/api/interview/{session_id}/duration", json={"elapsed_seconds": 130})
    assert second.json()["duration_seconds"] == 130

    # 迟到的旧请求（例如重试）带着更小的值：不允许回退。
    stale = client.put(f"/api/interview/{session_id}/duration", json={"elapsed_seconds": 20})
    assert stale.json()["duration_seconds"] == 130

    detail = client.get(f"/api/interview/{session_id}").json()
    assert detail["duration_seconds"] == 130


def test_duration_rejects_invalid_values(client, db_session, monkeypatch):
    """负数与超过一天的值都是 422：那是前端算错了，不该悄悄写进库。"""
    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])
    session_id = _start(client, db_session, rounds=3).json()["id"]

    assert (
        client.put(
            f"/api/interview/{session_id}/duration", json={"elapsed_seconds": -1}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/interview/{session_id}/duration", json={"elapsed_seconds": 86_401}
        ).status_code
        == 422
    )
    # 多余字段一律拒绝（与其它面试请求同口径：extra="forbid"）。
    assert (
        client.put(
            f"/api/interview/{session_id}/duration",
            json={"elapsed_seconds": 10, "delta": 1},
        ).status_code
        == 422
    )
    assert (
        client.put("/api/interview/999999/duration", json={"elapsed_seconds": 1}).status_code == 404
    )


def test_session_out_exposes_duration_and_resume(client, db_session, monkeypatch):
    """列表与详情都要带 duration_seconds / resume_title：历史卡与报告卡都要用。"""
    _configure(monkeypatch, [{"question": "第一题", "feedback": "", "done": False}])
    created = _start(client, db_session, rounds=3)
    session = created.json()
    assert session["duration_seconds"] == 0
    assert session["resume_title"] == "后端版简历"
    assert session["resume_id"] is not None

    listed = client.get("/api/interview").json()
    assert listed[0]["duration_seconds"] == 0
    assert listed[0]["resume_title"] == "后端版简历"


def test_report_prompt_carries_duration():
    """报告提示词里要有「面试用时」，让模型把它算进节奏判断。"""
    messages = build_report_messages(_session(duration_seconds=545))
    system = messages[0]["content"]
    assert "面试用时" in system
    assert "9 分 5 秒" in system
    # 没记录过时长的会话不能写成"0 分 0 秒"（模型会以为候选人秒答）。
    unrecorded = build_report_messages(_session(duration_seconds=0))[0]["content"]
    assert "未记录" in unrecorded

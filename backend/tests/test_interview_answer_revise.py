# SPDX-License-Identifier: Apache-2.0
"""Q1-L2「改文字重问」的纯逻辑契约（``voice_turns.revise_answer_for_turn``）。

三件会真出事的事：
1. 只改文字却**没作废**旧的面试官回应 → 重新生成后同一轮出现两个问题；
2. 允许改中间某一轮 → 后面几轮的上下文与"第 N 轮"编号一起错位；
3. 把后面几轮的面试官消息一起删了 → 用户的历史被吃掉。
"""

from __future__ import annotations

import pytest
from app.models.interview import InterviewSession
from app.services.interview.interview import add_message
from app.services.interview.voice_turns import AnswerNotReviseable, revise_answer_for_turn


def _session(db_session) -> InterviewSession:
    session = InterviewSession(title="改文字重问", rounds=6)
    db_session.add(session)
    db_session.commit()
    return session


def _three_rounds(db_session):
    """造 3 轮：面试官问 / 用户答，各三条。返回 (session, 用户消息列表)。"""
    session = _session(db_session)
    answers = []
    for index in range(3):
        add_message(session, role="interviewer", content=f"问题 {index + 1}")
        answers.append(add_message(session, role="user", content=f"回答 {index + 1}"))
        add_message(session, role="interviewer", content=f"点评 {index + 1}")
    db_session.commit()
    return session, answers


def test_revise_last_answer_updates_text_and_invalidates_only_its_reply(db_session):
    session, answers = _three_rounds(db_session)
    target, stale = revise_answer_for_turn(session, answers[-1].id, "  改过的回答  ")

    assert target.content == "改过的回答"
    assert target.error == ""
    # 只有最后一轮的「点评 3」作废；前两轮的点评原样保留。
    assert [item.content for item in stale] == ["点评 3"]


def test_revise_rejects_middle_answer(db_session):
    session, answers = _three_rounds(db_session)
    with pytest.raises(AnswerNotReviseable):
        revise_answer_for_turn(session, answers[0].id, "想改第一轮")


def test_revise_rejects_unknown_message(db_session):
    session, _ = _three_rounds(db_session)
    with pytest.raises(AnswerNotReviseable):
        revise_answer_for_turn(session, 999_999, "不存在")


def test_revise_keeps_followup_messages_out_of_scope(db_session):
    """追问（phase=followup）不是正式轮次：改最后一条正式回答时不该把它当"下一轮"截断。"""
    session, answers = _three_rounds(db_session)
    add_message(session, role="user", content="追问一句", phase="followup")
    db_session.commit()

    target, stale = revise_answer_for_turn(session, answers[-1].id, "改过的回答")
    assert target.content == "改过的回答"
    assert [item.content for item in stale] == ["点评 3"]

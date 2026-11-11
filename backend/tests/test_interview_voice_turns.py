# SPDX-License-Identifier: Apache-2.0
"""#26 P0 实时语音：轮次幂等、打断回滚、下一轮上下文的纯逻辑契约。

这些函数是 SSE 生成器与 cancel 端点共用的判断层，行为必须能在不跑模型、不跑 HTTP
的情况下钉死：
- 重复提交同一轮 → 不重复计轮、不重复生成（回放）；
- 被中断的一轮 → 复用那条用户消息，不写出第二条一样的回答；
- 回滚只保留"已播出"的字符，其余字数如实记账；
- 上一轮被打断的提示只引用播出过的内容，且只对最近一轮生效。
"""

import pytest
from app.models.interview import InterviewSession
from app.services.interview.interview import (
    MESSAGE_STATUS_COMPLETE,
    MESSAGE_STATUS_INTERRUPTED,
    add_message,
)
from app.services.interview.voice_turns import (
    INTERRUPTED_MARKER,
    append_interruption_notice,
    build_interruption_notice,
    find_turn_answer,
    mark_barge_in,
    normalize_client_turn_id,
    recent_interrupted_response,
    record_answer_for_turn,
    response_after,
    rollback_text,
    store_interrupted_response,
    turn_completed,
)

BASE_MESSAGES = [
    {"role": "system", "content": "你是面试官"},
    {"role": "user", "content": "面试数据"},
]


def _session(db_session, *, rounds: int = 6) -> InterviewSession:
    session = InterviewSession(title="语音契约", rounds=rounds)
    db_session.add(session)
    db_session.commit()
    return session


def test_normalize_client_turn_id_strips_and_caps():
    assert normalize_client_turn_id(None) is None
    assert normalize_client_turn_id("   ") is None
    assert normalize_client_turn_id(" turn-1 ") == "turn-1"
    assert normalize_client_turn_id("x" * 100) == "x" * 64


def test_rollback_text_keeps_only_the_played_prefix():
    text = "请举一个具体的例子说明你的贡献"
    kept, rolled_back = rollback_text(text, 5)
    assert kept == "请举一个具"
    assert rolled_back == len(text) - 5
    assert kept + "x" * rolled_back != text or rolled_back == 0


def test_rollback_text_without_reported_position_assumes_everything_played():
    kept, rolled_back = rollback_text("完整回答", None)
    assert kept == "完整回答"
    assert rolled_back == 0


@pytest.mark.parametrize(("played", "expected_len"), [(-3, 0), (0, 0), (999, 4)])
def test_rollback_text_clamps_out_of_range(played, expected_len):
    kept, rolled_back = rollback_text("四个字符", played)
    assert len(kept) == expected_len
    assert len(kept) + rolled_back == 4


def test_store_interrupted_response_writes_marker_and_counts(db_session):
    session = _session(db_session)
    stored = store_interrupted_response(
        session,
        index=2,
        played_text="只说到这",
        played_chars=4,
        generated_chars=11,
    )
    db_session.commit()
    assert stored is not None
    assert stored.role == "interviewer"
    assert stored.content.startswith("只说到这")
    assert INTERRUPTED_MARKER in stored.content
    assert stored.context["interrupted"] is True
    assert stored.context["played_chars"] == 4
    assert stored.context["generated_chars"] == 11
    assert stored.context["rolled_back_chars"] == 7


def test_store_interrupted_response_skips_empty_played_text(db_session):
    session = _session(db_session)
    assert (
        store_interrupted_response(
            session, index=1, played_text="   ", played_chars=0, generated_chars=3
        )
        is None
    )


def test_build_interruption_notice_quotes_only_what_was_played():
    notice = build_interruption_notice("请举一个具体的例子")
    assert "上一轮的回答被候选人打断" in notice
    assert "请举一个具体的例子" in notice


def test_append_interruption_notice_is_noop_without_interrupt(db_session):
    session = _session(db_session)
    add_message(session, role="interviewer", content="第一题")
    add_message(session, role="user", content="我的回答")
    db_session.commit()
    assert append_interruption_notice(list(BASE_MESSAGES), session) == BASE_MESSAGES


def test_append_interruption_notice_quotes_played_text_only(db_session):
    session = _session(db_session)
    add_message(session, role="user", content="我的回答")
    stored = store_interrupted_response(
        session,
        index=1,
        played_text="播出到这里",
        played_chars=5,
        generated_chars=20,
    )
    add_message(session, role="user", content="我接着说")
    db_session.commit()
    assert stored is not None

    messages = append_interruption_notice(list(BASE_MESSAGES), session)
    assert len(messages) == len(BASE_MESSAGES) + 1
    notice = messages[-1]
    assert notice["role"] == "system"
    assert "上一轮的回答被候选人打断" in notice["content"]
    assert "播出到这里" in notice["content"]
    assert INTERRUPTED_MARKER not in notice["content"]


def test_recent_interrupted_response_only_looks_at_recent_window(db_session):
    session = _session(db_session)
    add_message(session, role="user", content="旧回答")
    store_interrupted_response(
        session, index=1, played_text="旧的中断", played_chars=4, generated_chars=4
    )
    for content in ("一", "二", "三"):
        add_message(session, role="user", content=content)
    error = recent_interrupted_response(session, window=3)
    assert error is None, "更早的中断已经被后续轮次接上，不该再提示模型"
    assert recent_interrupted_response(session, window=5) is not None


def test_turn_completed_only_after_interviewer_reply(db_session):
    session = _session(db_session)
    answer = add_message(session, role="user", content="回答")
    db_session.commit()
    assert turn_completed(session, answer) is False
    add_message(session, role="interviewer", content="下一题")
    db_session.commit()
    assert turn_completed(session, answer) is True
    assert response_after(session, answer) is not None


def test_record_answer_replays_a_completed_turn_without_duplicating(db_session):
    session = _session(db_session)
    first = record_answer_for_turn(session, "回答一", "turn-1")
    add_message(session, role="interviewer", content="下一题")
    db_session.commit()

    replay = record_answer_for_turn(session, "回答一", "turn-1")
    assert replay.id == first.id
    users = [item for item in session.messages if item.role == "user"]
    assert len(users) == 1, "重复提交同一轮不能写出第二条用户消息"
    assert turn_completed(session, replay) is True


def test_record_answer_reuses_an_interrupted_turn(db_session):
    session = _session(db_session)
    first = record_answer_for_turn(session, "旧内容", "turn-1")
    first.status = MESSAGE_STATUS_INTERRUPTED
    db_session.commit()

    reused = record_answer_for_turn(session, "补充后的内容", "turn-1")
    db_session.commit()
    assert reused.id == first.id
    users = [item for item in session.messages if item.role == "user"]
    assert len(users) == 1
    assert users[0].content == "补充后的内容"
    assert users[0].status == MESSAGE_STATUS_COMPLETE
    assert find_turn_answer(session, "turn-1") is users[0]


def test_record_answer_without_key_keeps_legacy_reuse_semantics(db_session):
    session = _session(db_session)
    first = add_message(session, role="user", content="旧回答")
    first.status = MESSAGE_STATUS_INTERRUPTED
    db_session.commit()
    reused = record_answer_for_turn(session, "新回答")
    db_session.commit()
    assert reused.id == first.id
    assert reused.content == "新回答"


def test_record_answer_new_key_appends_a_new_turn(db_session):
    session = _session(db_session)
    record_answer_for_turn(session, "第一轮", "turn-1")
    add_message(session, role="interviewer", content="下一题")
    db_session.commit()
    record_answer_for_turn(session, "第二轮", "turn-2")
    db_session.commit()
    users = [item for item in session.messages if item.role == "user"]
    assert [item.content for item in users] == ["第一轮", "第二轮"]


def test_mark_barge_in_flags_context_without_touching_status(db_session):
    session = _session(db_session)
    answer = add_message(session, role="user", content="回答")
    db_session.commit()
    before = answer.status
    mark_barge_in(answer)
    db_session.commit()
    assert answer.context["barge_in"] is True
    assert answer.status == before

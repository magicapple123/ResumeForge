# SPDX-License-Identifier: Apache-2.0
"""面试结束后的「追问」分相（#41）：追问不占正式轮次。

这条链路的验收口径只有一句话：**追问多少次都不会让轮次变**。所以这里逐条钉住：

1. 追问写入 ``phase="followup"``，``answered_rounds`` 只数 ``phase="interview"``；
2. 追问之后刷新（重新 GET）读数不变——这正是原来那个 bug 的现象（刷新后进度变大）；
3. 追问不会让一场 ``finished`` 的面试重新变回 ``active``，也不会破坏"重开 / 再看报告"；
4. 还没结束的面试不能追问（追问的语义是"考完再问"）。
"""

from __future__ import annotations

import json

from app.models.interview import MESSAGE_PHASE_FOLLOWUP, MESSAGE_PHASE_INTERVIEW
from tests.interview_target_support import start_interview as _start

_REPORT = {
    "score": 78,
    "dimensions": [{"name": "技术深度", "score": 78, "comment": "细节还可以更具体"}],
    "strengths": ["结构清楚"],
    "improvements": ["补充数据"],
    "summary": "整体不错",
}


def _configure(monkeypatch, *, answers: list[str] | None = None) -> dict[str, int]:
    """把每一轮提问与追问的回答都换成预设文本，其余流程全走真实代码。"""
    turns = [
        {"question": "第一题：介绍一个你做过的项目", "feedback": "", "done": False},
        {"question": "第二题：这个项目里最难的地方", "feedback": "讲得清楚", "done": False},
        {"question": "第三题：还有什么想补充的", "feedback": "可以", "done": False},
    ]
    queue = list(turns)
    follow_ups = list(answers or ["我第二题答漏了容量规划。", "谢谢，我明白了。"])
    calls = {"followups": 0}

    class _Provider:
        async def chat(self, messages, *, thinking: bool = True):
            # 追问走的是自由文本提示词；轮次走 JSON，两者在同一个 provider 上分流。
            if "追问" in json.dumps(messages, ensure_ascii=False)[:2000]:
                calls["followups"] += 1
                return follow_ups.pop(0) if follow_ups else "已答完"
            return json.dumps(queue.pop(0) if queue else {"question": "收尾", "done": True})

    async def ask(_db, _session_, _provider):
        payload = queue.pop(0) if queue else {"question": "收尾", "feedback": "", "done": True}
        return payload["question"], payload.get("feedback", ""), payload.get("done", False)

    async def build_report(_provider, _session_):
        return _REPORT

    monkeypatch.setattr(
        "app.api.interview._require_provider", lambda _db: (_Provider(), "test-model")
    )
    monkeypatch.setattr("app.api.interview._ask_next_question", ask)
    monkeypatch.setattr("app.api.interview.generate_report", build_report)
    return calls


def _finished_session(client, db_session) -> int:
    session_id = _start(client, db_session, rounds=3).json()["id"]
    client.post(f"/api/interview/{session_id}/answers", json={"content": "我做过 A"})
    finished = client.post(f"/api/interview/{session_id}/finish")
    assert finished.status_code == 200
    assert finished.json()["status"] == "finished"
    assert finished.json()["answered_rounds"] == 1
    return session_id


def test_followups_do_not_count_as_rounds(client, db_session, monkeypatch):
    _configure(monkeypatch)
    session_id = _finished_session(client, db_session)

    first = client.post(
        f"/api/interview/{session_id}/followups", json={"content": "第二题我漏了什么？"}
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["answer"]
    # 追问之后轮次一个都没多。
    assert body["session"]["answered_rounds"] == 1
    assert body["session"]["status"] == "finished"

    second = client.post(f"/api/interview/{session_id}/followups", json={"content": "那怎么补？"})
    assert second.status_code == 200
    assert second.json()["session"]["answered_rounds"] == 1


def test_followup_messages_carry_the_followup_phase(client, db_session, monkeypatch):
    _configure(monkeypatch)
    session_id = _finished_session(client, db_session)
    client.post(f"/api/interview/{session_id}/followups", json={"content": "我漏了什么？"})

    detail = client.get(f"/api/interview/{session_id}").json()
    followups = [item for item in detail["messages"] if item["phase"] == MESSAGE_PHASE_FOLLOWUP]
    interview = [item for item in detail["messages"] if item["phase"] == MESSAGE_PHASE_INTERVIEW]
    # 一问一答两条追问；正式问答仍是"面试官一问 + 候选人一答"。
    assert len(followups) == 2
    assert [item["role"] for item in followups] == ["user", "interviewer"]
    # 正式阶段仍是"问 → 答 → 下一问 → 收尾说明"，追问没有混进去。
    assert [item["role"] for item in interview] == ["interviewer", "user", "interviewer", "note"]


def test_rounds_survive_a_refresh_after_followups(client, db_session, monkeypatch):
    """先追问两轮，再"刷新页面"重新拉详情：读数与刚结束时完全一致。"""
    _configure(monkeypatch)
    session_id = _finished_session(client, db_session)
    for content in ("那怎么补？", "还有别的建议吗？"):
        client.post(f"/api/interview/{session_id}/followups", json={"content": content})

    refreshed = client.get(f"/api/interview/{session_id}").json()
    assert refreshed["answered_rounds"] == 1
    assert refreshed["status"] == "finished"
    assert refreshed["report"]["score"] == 78
    # 追问记录还在（刷新之后仍要继续问，不能丢）。
    assert any(item["phase"] == MESSAGE_PHASE_FOLLOWUP for item in refreshed["messages"])

    # 继续追问仍然可用，轮次依旧不变。
    again = client.post(f"/api/interview/{session_id}/followups", json={"content": "再问一个"})
    assert again.status_code == 200
    assert again.json()["session"]["answered_rounds"] == 1


def test_followups_are_rejected_while_the_interview_is_active(client, db_session, monkeypatch):
    _configure(monkeypatch)
    session_id = _start(client, db_session, rounds=3).json()["id"]
    rejected = client.post(f"/api/interview/{session_id}/followups", json={"content": "插一句"})
    assert rejected.status_code == 409


def test_followup_requires_configuration(client, db_session):
    """没有配置模型时追问给的是"去配置"这个前因，而不是 500。

    这里直接写一条已结束的会话（不经过开场）：开场本身也要求模型可用，那条限制
    由 ``test_api_requires_model_configuration`` 覆盖，这里要验的是追问端点自己的顺序
    ——先判"结束了没有"，再判"模型配了没有"。
    """
    from app.models.interview import INTERVIEW_STATUS_FINISHED, InterviewSession

    session = InterviewSession(title="已结束的面试", status=INTERVIEW_STATUS_FINISHED, rounds=3)
    db_session.add(session)
    db_session.commit()
    rejected = client.post(f"/api/interview/{session.id}/followups", json={"content": "在吗"})
    assert rejected.status_code == 400


def test_followup_failure_leaves_no_dangling_question(client, db_session, monkeypatch):
    """模型没答出来时把这句追问撤掉：否则界面上会永远挂着一个没回答的空气泡。"""
    from app.services.llm.base import LLMError

    _configure(monkeypatch)

    async def broken(_provider, _session, **_kwargs):
        raise LLMError("模型超时")

    monkeypatch.setattr("app.api.interview_material_routes.generate_followup", broken)
    session_id = _finished_session(client, db_session)
    failed = client.post(f"/api/interview/{session_id}/followups", json={"content": "在吗"})
    assert failed.status_code == 502

    detail = client.get(f"/api/interview/{session_id}").json()
    assert not [item for item in detail["messages"] if item["phase"] == MESSAGE_PHASE_FOLLOWUP]
    assert detail["answered_rounds"] == 1


def test_followup_does_not_change_the_report_input(client, db_session, monkeypatch):
    """报告只看正式问答：结束后的追问不能掺进评分依据。"""
    from app.services.interview.interview import build_report_messages

    _configure(monkeypatch)
    session_id = _finished_session(client, db_session)
    client.post(f"/api/interview/{session_id}/followups", json={"content": "我是怎么被扣分的？"})

    from app.models.interview import InterviewSession as _Session

    db = db_session
    session = db.get(_Session, session_id)
    assert session is not None
    rendered = json.dumps(build_report_messages(session), ensure_ascii=False)
    assert "我是怎么被扣分的" not in rendered
    assert "我做过 A" in rendered


def _close_without_report(client, db_session, *, rounds: int = 3) -> int:
    """办一场**只收盘、没报告**的面试（自动收尾的新形态）：返回 session_id。

    调用方要先用 ``_configure`` 装好三轮提问的假实现；``rounds`` 取到最小合法值 3。
    """
    session_id = _start(client, db_session, rounds=rounds).json()["id"]
    last = None
    for _ in range(rounds):
        last = client.post(f"/api/interview/{session_id}/answers", json={"content": "我做过 A"})
        assert last.status_code == 200, last.text
    assert last is not None
    body = last.json()
    assert body["finished"] is True
    assert body["needs_report"] is True
    assert body["session"]["status"] == "finished"
    assert body["session"]["report"] == {}, "自动收尾不该顺手把报告生成掉"
    return session_id


def test_followups_before_the_report_are_allowed(client, db_session, monkeypatch):
    """报告生成**之前**就能追问：这是"先问是否追问，再出报告"成立的硬前提。

    追问接口只要求 ``status == FINISHED``，而收盘已经发生、报告还没生成——所以这里必须
    是 200，不是 409。
    """
    _configure(monkeypatch)
    session_id = _close_without_report(client, db_session)

    for index in range(3):
        asked = client.post(
            f"/api/interview/{session_id}/followups", json={"content": f"报告前的第 {index} 问"}
        )
        assert asked.status_code == 200, asked.text
        assert asked.json()["session"]["status"] == "finished"
        assert asked.json()["session"]["report"] == {}
        # 追问不占正式轮次：读完仍是原来的轮数。
        assert asked.json()["session"]["answered_rounds"] == 3


def test_report_after_followups_excludes_every_followup_round(client, db_session, monkeypatch):
    """报告前追问 3 轮，最终报告的转录里**一条追问都不能有**。

    这是本需求的核心安全前提：``build_report_messages`` 只取 ``phase="interview"``。
    一旦有人为了"报告前也有追问了"去放宽那条过滤，评分就会随"用户聊了多少"浮动。
    这里断言的是报告真正拿到的那份提示词（不是自己拼一份）。
    """
    _configure(monkeypatch)
    session_id = _close_without_report(client, db_session)
    follow_ups = ["报告前追问甲", "报告前追问乙", "报告前追问丙"]
    for content in follow_ups:
        asked = client.post(f"/api/interview/{session_id}/followups", json={"content": content})
        assert asked.status_code == 200

    captured: list[list[dict[str, str]]] = []

    async def build_report(_provider, session_):
        from app.services.interview.interview import build_report_messages

        captured.append(build_report_messages(session_))
        return _REPORT

    monkeypatch.setattr("app.api.interview.generate_report", build_report)

    first = client.post(f"/api/interview/{session_id}/finish")
    assert first.status_code == 200
    assert first.json()["report"]["score"] == 78
    rendered = json.dumps(captured[0], ensure_ascii=False)
    for content in follow_ups:
        assert content not in rendered
    # 正式问答仍然在里面：过滤掉的是追问，不是整段转录。
    assert "我做过 A" in rendered

    # 重复点是幂等的：不会再生成第二份报告（也就不会再调一次模型）。
    second = client.post(f"/api/interview/{session_id}/finish")
    assert second.status_code == 200
    assert len(captured) == 1


def test_closing_and_reopening_the_followup_area(client, db_session, monkeypatch):
    """#41：「停止追问」只停"继续发问"，不删记录、不改状态、不动轮次。"""
    _configure(monkeypatch)
    session_id = _finished_session(client, db_session)
    client.post(f"/api/interview/{session_id}/followups", json={"content": "第一问"})

    closed = client.patch(f"/api/interview/{session_id}/followups", json={"closed": True})
    assert closed.status_code == 200, closed.text
    assert closed.json()["follow_up_closed_at"] is not None
    # 收起之后不能再往里写消息。
    rejected = client.post(f"/api/interview/{session_id}/followups", json={"content": "还想问"})
    assert rejected.status_code == 409
    # 已落库的追问一条都没少，轮次也没变。
    detail = client.get(f"/api/interview/{session_id}").json()
    assert (
        len([item for item in detail["messages"] if item["phase"] == MESSAGE_PHASE_FOLLOWUP]) == 2
    )
    assert detail["answered_rounds"] == 1
    assert detail["status"] == "finished"

    reopened = client.patch(f"/api/interview/{session_id}/followups", json={"closed": False})
    assert reopened.status_code == 200
    assert reopened.json()["follow_up_closed_at"] is None
    again = client.post(f"/api/interview/{session_id}/followups", json={"content": "接着问"})
    assert again.status_code == 200
    assert again.json()["session"]["answered_rounds"] == 1


def test_followup_state_is_only_for_finished_interviews(client, db_session, monkeypatch):
    """还在进行的面试没有追问区，PATCH 收起同样是 409（与 POST 同口径）。"""
    _configure(monkeypatch)
    session_id = _start(client, db_session, rounds=3).json()["id"]
    rejected = client.patch(f"/api/interview/{session_id}/followups", json={"closed": True})
    assert rejected.status_code == 409

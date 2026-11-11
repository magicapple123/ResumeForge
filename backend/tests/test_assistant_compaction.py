# SPDX-License-Identifier: Apache-2.0
"""上下文自动压缩 + 用户主动压缩（问题清单 #10，迁移 0011）。

钉住的性质分三层：

1. **纯函数**（``assistant_compaction*``）：什么时候不动 / 只遮蔽 / 摘要到哪一条；
   遮蔽后 ``tool_call_id`` 配对完整（真实 API 会 400 的那条坑）；``covered_until``
   之后新增的消息不重复摘要；摘要结果非法 JSON 时判失败而不是抛。
2. **流内接线**（``compact_before_model``）：摘要失败不阻断发送，只落
   ``compaction_failed`` 标记；成功时把摘要与 ``covered_until`` 写进会话列。
3. **接口**（``/compact``）：dry-run 不写库不调模型；DELETE 清空后 GET 回到未压缩态；
   三个设置项能读能写、越界 422。

夹具里的消息是**手工构造的模型视图**（pin + 历史 + 本轮工具结果），因为跨轮的工具
结果本来就不进历史（``history_snapshot`` 只带 user/assistant），L1 的作用面就在这一轮
的 ``messages`` 里。这一点在证据文件里也写了。
"""

from __future__ import annotations

import json

import pytest
from app.models.assistant import ChatConversation, ChatMessage
from app.services.assistant import assistant_compaction as core
from app.services.assistant import assistant_compaction_store as store
from app.services.assistant.assistant_compaction_plan import CompactionLimits, plan_compaction
from app.services.assistant.assistant_compaction_summary import (
    apply_summary,
    build_summary_prompt,
    merge_summary,
    parse_summary,
    render_summary_block,
)
from test_assistant import _configure_llm, _create_conversation

PIN = {"role": "system", "content": "你是求职助手（pin：系统提示词，永不压缩）。"}
VALID_SUMMARY = json.dumps(
    {
        "goal": "把资料补到 55 条",
        "constraints": ["不要再问已确认的事"],
        "facts": [{"k": "目标岗位", "v": "宠物医院兽医"}],
        "decisions": ["按 A 方案补 55 条资料"],
        "open_questions": ["第 37 条缺工作年限"],
        "next_steps": ["继续补剩余 18 条"],
    },
    ensure_ascii=False,
)


def _history(rounds: int, chars: int = 120) -> list[dict]:
    """带 id 的历史消息：``rounds`` 轮问答，id 从 1 递增（``history_snapshot`` 的形状）。"""
    items: list[dict] = []
    for index in range(rounds):
        items.append(
            {
                "id": len(items) + 1,
                "role": "user",
                "content": f"第 {index + 1} 轮提问：" + "问" * chars,
                "attachments": [],
            }
        )
        items.append(
            {
                "id": len(items) + 1,
                "role": "assistant",
                "content": f"第 {index + 1} 轮回答：" + "答" * chars,
                "attachments": [],
            }
        )
    return items


def _tool_round(index: int, chars: int = 2_000) -> list[dict]:
    """一组工具调用：助手发起 + 工具结果（结果很长，正是会被遮蔽的那种）。"""
    call_id = f"call_{index}"
    return [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": "list_profile_entries", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": call_id, "content": "结" * chars},
    ]


def _view(*, history_rounds: int = 8, tool_rounds: int = 8) -> tuple[list[dict], list[dict]]:
    """返回（模型视图 messages, 带 id 的历史）。历史在前，本轮工具结果在后。"""
    history = _history(history_rounds)
    messages: list[dict] = [PIN]
    messages.extend({"role": item["role"], "content": item["content"]} for item in history)
    for index in range(tool_rounds):
        messages.extend(_tool_round(index))
    return messages, history


# ===== L1 =====


def test_below_mask_threshold_keeps_everything():
    """未到 60% 一律不动：压缩本身要花钱，且会让前缀缓存失效。"""
    messages, history = _view()
    plan = plan_compaction(messages, history, window_tokens=100_000, percent=59.9)
    assert plan.level == "none"
    assert plan.mask_indices == ()
    assert plan.reason == "below_mask_threshold"


def test_between_thresholds_only_masks_and_keeps_last_three_rounds():
    """60–75% 只遮蔽工具结果；最近 3 轮工具结果一条都不动。"""
    messages, history = _view()
    groups = core.tool_call_groups(messages)
    last_group = max(groups.values())
    plan = plan_compaction(
        messages, history, window_tokens=10_000, percent=65.0, limits=CompactionLimits(60, 75)
    )
    assert plan.level == "mask"
    assert plan.mask_indices, "65% 时必须有可遮蔽的旧工具结果"
    # 保留最近 3 组：任何被遮蔽的下标都不许落在最后 3 组里。
    assert all(groups[index] <= last_group - 3 for index in plan.mask_indices)
    # 一次至少释放 10% 窗口才动手（否则前缀缓存白失效）。
    assert plan.released_tokens >= 1_000


def test_mask_release_below_ten_percent_is_skipped():
    """只有一组很小的旧工具结果时不动手：释放不到 10% 窗口是净亏。"""
    history = _history(4)
    messages: list[dict] = [PIN, *({"role": e["role"], "content": e["content"]} for e in history)]
    messages.extend(_tool_round(0, chars=20))
    messages.extend(_tool_round(1, chars=20))
    messages.extend(_tool_round(2, chars=20))
    messages.extend(_tool_round(3, chars=20))
    plan = plan_compaction(messages, history, window_tokens=100_000, percent=61.0)
    assert plan.level == "none"
    assert plan.reason == "release_too_small"


def test_masking_keeps_tool_message_structure_and_pairing():
    """遮蔽只换 content：tool_call_id 与 tool_call 的配对必须完整（否则真实 API 400）。"""
    messages, history = _view()
    plan = plan_compaction(messages, history, window_tokens=10_000, percent=65.0)
    masked = core.mask_tool_results(messages, plan.mask_indices)
    assert len(masked) == len(messages)
    call_ids = {
        str(call.get("id")) for message in masked for call in message.get("tool_calls") or []
    }
    for original, updated in zip(messages, masked, strict=True):
        assert original.get("role") == updated.get("role")
        if updated.get("role") == "tool":
            assert updated.get("tool_call_id") in call_ids, "工具结果必须仍能配对上 tool_call"
            assert str(updated.get("tool_call_id"))
    assert core.content_text(masked[plan.mask_indices[0]]["content"]).startswith(
        core.PLACEHOLDER_PREFIX
    )


def test_masking_is_idempotent():
    """已经遮蔽过的结果不再被当成候选（否则每次请求都会重写一遍占位文本）。"""
    messages, history = _view()
    plan = plan_compaction(messages, history, window_tokens=10_000, percent=65.0)
    masked = core.mask_tool_results(messages, plan.mask_indices)
    again = core.plan_mask(masked, window_tokens=10_000, percent=65.0)
    assert set(again.indices).isdisjoint(set(plan.mask_indices))


# ===== L2 =====


def test_summary_covers_everything_before_the_last_six_rounds():
    """≥75% 摘要到"最近 6 轮之前"，摘要块固定插在 pin 之后。"""
    messages, history = _view(history_rounds=10, tool_rounds=0)
    plan = plan_compaction(
        messages, history, window_tokens=10_000, percent=76.0, history_count=len(history)
    )
    assert plan.level == "summary"
    # 10 轮里最近 6 轮（第 5–10 轮，id 9..20）不动 → 覆盖 id 1..8。
    assert plan.summary_region.message_ids == tuple(range(1, 9))
    assert plan.summary_region.turns == 4
    summary = merge_summary(
        None,
        parse_summary(VALID_SUMMARY) or {},
        message_ids=plan.summary_region.message_ids,
        turns=plan.summary_region.turns,
    )
    shrunk = apply_summary(messages, summary, cut_index=plan.summary_cut_index)
    assert shrunk[0] == PIN
    assert shrunk[1]["role"] == "system"
    assert core.summary_block_present(shrunk)
    # 原文没被删除：剩下的消息仍然按顺序是"第 5 轮"往后。
    assert any("第 5 轮提问" in core.content_text(m.get("content")) for m in shrunk)
    assert not any("第 1 轮提问" in core.content_text(m.get("content")) for m in shrunk[2:])


def test_covered_until_does_not_resummarize_old_rounds():
    """``covered_until`` 之后的区间才算新内容：旧轮次不再进下一次摘要。"""
    history = _history(10)
    region = core.summary_region(history, covered_until_message_id=8)
    assert region.message_ids == ()
    extended = _history(11)
    region = core.summary_region(extended, covered_until_message_id=8)
    # 11 轮里最近 6 轮（第 6–11 轮）不动 → 覆盖 id 1..10，减掉已覆盖的 1..8。
    assert region.message_ids == (9, 10)


def test_invalid_summary_json_is_rejected_not_raised():
    """散文 / 坏 JSON / 缺 goal 一律判非法（调用方据此降级，绝不写进上下文）。"""
    assert parse_summary("抱歉，我无法完成这个请求。") is None
    assert parse_summary('{"goal": "x", "facts": [') is None
    assert parse_summary('{"constraints": ["只保留这一句"]}') is None
    assert parse_summary("") is None
    parsed = parse_summary(f"```json\n{VALID_SUMMARY}\n```")
    assert parsed is not None and parsed["goal"] == "把资料补到 55 条"


def test_merge_summary_is_deterministic_and_never_resummarizes():
    """再次压缩只做确定性合并：事实按键覆盖、列表取并集、轮数相加。"""
    first = parse_summary(VALID_SUMMARY)
    second = parse_summary(
        json.dumps(
            {
                "goal": "改问简历诊断",
                "facts": [{"k": "目标岗位", "v": "宠物医院主治"}],
                "next_steps": ["看诊断结果"],
            },
            ensure_ascii=False,
        )
    )
    assert first is not None and second is not None
    earlier = merge_summary(first, None or {}, message_ids=tuple(range(1, 9)), turns=4)
    merged = merge_summary(earlier, second, message_ids=(9, 10), turns=1)
    assert merged["goal"] == "改问简历诊断"
    assert merged["facts"] == [{"k": "目标岗位", "v": "宠物医院主治"}]
    assert merged["compacted"]["from"] == 1
    assert merged["compacted"]["to"] == 10
    assert merged["compacted"]["turns"] == 5
    block = render_summary_block(merged)
    assert "原文仍在本地" in block and "宠物医院主治" in block


def test_summary_prompt_carries_the_region_only():
    """摘要提示词里只有待压缩区间，没有 pin、没有最近 6 轮。"""
    history = _history(10)
    region = core.summary_region(history)
    prompt = build_summary_prompt(region)
    assert prompt[0]["role"] == "system"
    body = prompt[1]["content"]
    assert "第 1 轮提问" in body
    assert "第 10 轮提问" not in body


def test_hard_limit_trim_keeps_pin_and_last_rounds():
    """兜底硬闸：>90% 且摘要失败时只留 pin + 最近 4 轮。"""
    messages, _history_rows = _view(history_rounds=10, tool_rounds=0)
    trimmed = core.hard_limit_trim(messages)
    assert trimmed[0] == PIN
    assert len(trimmed) == 1 + 8, "pin + 最近 4 轮（每轮一问一答）"
    kept = " ".join(core.content_text(message.get("content")) for message in trimmed[1:])
    assert all(f"第 {number} 轮" in kept for number in (7, 8, 9, 10))
    assert "第 6 轮" not in kept


# ===== 流内接线 =====


class _StubProvider:
    """只实现 ``chat``：摘要路径走它，流式路径不参与。"""

    class _Config:
        model = "summary-model"

    config = _Config()

    def __init__(self, reply: str):
        self.reply = reply
        self.calls: list[list[dict]] = []

    async def chat(self, messages, *, thinking: bool = True):  # noqa: ARG002
        self.calls.append(list(messages))
        return self.reply


async def _conversation_with_history(client, db_session, rounds: int = 12) -> int:
    _configure_llm(client)
    conversation = _create_conversation(client)
    conversation_id = int(conversation["id"])
    for index in range(rounds):
        db_session.add(
            ChatMessage(
                conversation_id=conversation_id,
                role="user",
                content=f"第 {index + 1} 轮提问：" + "问" * 60,
                status="complete",
            )
        )
        db_session.add(
            ChatMessage(
                conversation_id=conversation_id,
                role="assistant",
                content=f"第 {index + 1} 轮回答：" + "答" * 60,
                status="complete",
            )
        )
    db_session.commit()
    return conversation_id


@pytest.mark.asyncio
async def test_summary_failure_degrades_without_raising(client, db_session):
    """摘要返回散文 → 不抛、只置 ``failed``；messages 原样可用（这一轮照样发出去）。"""
    conversation_id = await _conversation_with_history(client, db_session)
    history = [
        {"id": row.id, "role": row.role, "content": row.content}
        for row in db_session.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id)
        .all()
    ]
    messages = [PIN, *({"role": e["role"], "content": e["content"]} for e in history)]
    messages.append({"role": "user", "content": "这一轮的新问题"})
    provider = _StubProvider("抱歉，我无法完成这个请求。")
    from app.database import SessionLocal

    result, flags = await store.compact_before_model(
        messages,
        history=history,
        history_count=len(history),
        factory=SessionLocal,
        conversation_id=conversation_id,
        provider=provider,
        window_tokens=10_000,
        percent=80.0,
    )
    assert flags.get("failed") is True
    assert result == messages, "失败路径不删任何消息（原文原样发出去）"
    assert store.load_compaction(db_session, conversation_id) == {}


@pytest.mark.asyncio
async def test_summary_success_persists_covered_until_and_block(client, db_session):
    """成功路径：摘要块插在 pin 之后，``covered_until`` 落库，原文仍能查回。"""
    conversation_id = await _conversation_with_history(client, db_session)
    history = [
        {"id": row.id, "role": row.role, "content": row.content}
        for row in db_session.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id)
        .all()
    ]
    messages = [PIN, *({"role": e["role"], "content": e["content"]} for e in history)]
    messages.append({"role": "user", "content": "这一轮的新问题"})
    from app.database import SessionLocal

    result, flags = await store.compact_before_model(
        messages,
        history=history,
        history_count=len(history),
        factory=SessionLocal,
        conversation_id=conversation_id,
        provider=_StubProvider(VALID_SUMMARY),
        window_tokens=10_000,
        percent=80.0,
    )
    assert flags.get("compacted") is True and not flags.get("failed")
    assert result[0] == PIN and core.summary_block_present(result)
    db_session.expire_all()
    state = store.load_compaction(db_session, conversation_id)
    assert state["covered_until_message_id"] == 12
    assert state["summary"]["goal"] == "把资料补到 55 条"
    # 原文永不删除：被摘要覆盖的消息还在库里。
    assert db_session.query(ChatMessage).filter_by(conversation_id=conversation_id).count() == 24


# ===== 接口 =====


def test_dry_run_does_not_write_and_delete_restores(client, db_session):
    """dry-run 不写库；DELETE 之后 GET context-usage 回到未压缩态。"""
    conversation_id = None
    _configure_llm(client)
    conversation_id = int(_create_conversation(client)["id"])
    for index in range(8):
        db_session.add(
            ChatMessage(
                conversation_id=conversation_id,
                role="user",
                content=f"第 {index + 1} 轮提问：" + "问" * 60,
                status="complete",
            )
        )
        db_session.add(
            ChatMessage(
                conversation_id=conversation_id,
                role="assistant",
                content=f"第 {index + 1} 轮回答：" + "答" * 60,
                status="complete",
            )
        )
    db_session.commit()

    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/compact", json={"dry_run": True}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert body["turns_covered"] == 2, "8 轮里最近 6 轮不动，只剩最旧 2 轮可压"
    db_session.expire_all()
    assert store.load_compaction(db_session, conversation_id) == {}, "dry-run 不许写库"
    assert (
        client.get(f"/api/assistant/conversations/{conversation_id}/context-usage").json()[
            "compaction"
        ]
        is None
    )

    # 手工放一份压缩状态进去（真跑要调模型，这里不替它花那份钱）。
    store.save_compaction(
        db_session,
        conversation_id,
        {
            "summary": parse_summary(VALID_SUMMARY),
            "covered_until_message_id": 4,
            "tokens_before": 9_000,
            "tokens_after": 2_000,
            "model": "assistant-model",
            "created_at": "2026-11-11T02:10:00Z",
            "last_mask": {"count": 3},
        },
    )
    usage = client.get(f"/api/assistant/conversations/{conversation_id}/context-usage").json()
    assert usage["compaction"]["covered_until_message_id"] == 4
    assert usage["compaction"]["masked_tool_results"] == 3

    assert (
        client.delete(f"/api/assistant/conversations/{conversation_id}/compact").status_code == 204
    )
    db_session.expire_all()
    assert store.load_compaction(db_session, conversation_id) == {}
    assert (
        client.get(f"/api/assistant/conversations/{conversation_id}/context-usage").json()[
            "compaction"
        ]
        is None
    )
    # 原文一条不少。
    assert db_session.query(ChatMessage).filter_by(conversation_id=conversation_id).count() == 16


def test_compact_endpoints_404_for_unknown_conversation(client):
    assert client.post("/api/assistant/conversations/999999/compact", json={}).status_code == 404
    assert client.delete("/api/assistant/conversations/999999/compact").status_code == 404


def test_compaction_settings_round_trip_and_validation(client):
    """三个设置项：默认值可读、写入后读回、越界与倒挂都 422。"""
    assert client.get("/api/settings/assistant-compaction").json() == {
        "model": "",
        "mask_percent": 60,
        "summary_percent": 75,
    }
    payload = {"model": "cheap-model", "mask_percent": 50, "summary_percent": 70}
    assert client.put("/api/settings/assistant-compaction", json=payload).status_code == 200
    assert client.get("/api/settings/assistant-compaction").json() == payload
    assert (
        client.put(
            "/api/settings/assistant-compaction",
            json={"model": "", "mask_percent": 80, "summary_percent": 70},
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/settings/assistant-compaction",
            json={"model": "", "mask_percent": 0, "summary_percent": 75},
        ).status_code
        == 422
    )


def test_compaction_column_is_nullable_in_the_model():
    """迁移 0011 加的列必须可空：绝大多数会话没有压缩状态。"""
    assert ChatConversation.__table__.columns["compaction"].nullable is True

# SPDX-License-Identifier: Apache-2.0
"""求职助手「上下文用量」（需求 #6）：五桶分桶纯函数 + 两条接口口径。

纯函数部分覆盖 ``services/assistant/assistant_context_usage.py``（不碰 DB / 网络，
毫秒级）；接口部分覆盖 ``GET /conversations/{id}/context-usage`` 的两个分支——
新消息原样返回落库的用量，旧消息（没有 ``context_usage`` 字段）如实标 ``partial``。

跨文件复用 ``test_assistant`` 里的假 provider 与配置 helper（见该文件头部的约定：
helper 留在那儿，新文件单向导入）。
"""

from app.models.assistant import ChatMessage
from app.schemas.setting import LLMConfig
from app.services.assistant.assistant_context_usage import (
    BUCKET_KEYS,
    attachment_text,
    build_context_usage,
    connectors_text,
    conversation_text,
    message_text,
    tools_text,
)
from app.services.llm.token_estimate import estimate_tokens
from test_assistant import _create_conversation, _events, _send, _successful_provider

WINDOW = 128_000


def _configure_llm_with_window(client, *, window_tokens: int = WINDOW) -> None:
    """配置一个带了上下文窗口的模型（分母来自这里，没配就只有 0）。"""
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="assistant-secret",
        model="assistant-model",
        context_window_tokens=window_tokens,
    )
    response = client.put("/api/settings/llm", json=config.model_dump())
    assert response.status_code == 200


def _buckets(usage: dict) -> dict[str, dict]:
    return {bucket["key"]: bucket for bucket in usage["buckets"]}


def test_single_bucket_equals_estimate_tokens():
    """某个桶只含对应部件时，它的 tokens 就等于该部件的 estimate_tokens。"""
    text = "系统提示词正文" * 20
    usage = build_context_usage({"system": text}, window_tokens=WINDOW)
    buckets = _buckets(usage)
    assert [bucket["key"] for bucket in usage["buckets"]] == list(BUCKET_KEYS)
    assert buckets["system"]["tokens"] == estimate_tokens(text)
    assert usage["total"] == estimate_tokens(text)
    # 其余四桶是空文本 → 0 token（不是 None、不是缺失）。
    for key in ("tools", "conversation", "connectors", "skills"):
        assert buckets[key]["tokens"] == 0
    assert usage["usage_actual"] is None
    assert usage["partial"] is False


def test_empty_history_only_counts_system():
    """空历史（只有系统提示词）：其余四桶为 0，总和 = system。"""
    system_text = "基础提示与时间注记"
    usage = build_context_usage({"system": system_text}, window_tokens=WINDOW, usage_actual=1234)
    buckets = _buckets(usage)
    other_total = sum(
        buckets[key]["tokens"] for key in ("tools", "conversation", "connectors", "skills")
    )
    assert other_total == 0
    assert usage["total"] == buckets["system"]["tokens"] == estimate_tokens(system_text)
    # 实测值原样透传，不与估算合并、不换算。
    assert usage["usage_actual"] == 1234
    assert usage["percent"] is not None


def test_zero_window_has_no_percentage():
    """窗口 0（用户没填）= 没有分母：percent 是 None 而不是 0，也不显示 0%。"""
    usage = build_context_usage({"system": "提示词"}, window_tokens=0)
    assert usage["window"] == 0
    assert usage["percent"] is None
    assert all(bucket["percent"] is None for bucket in usage["buckets"])
    # tokens 照旧给出：缺的只是分母，不是数据。
    assert usage["total"] == estimate_tokens("提示词")


def test_bucket_percentages_sum_to_total_percentage():
    """五行相加 = 顶部总占比（各桶独立四舍五入，误差 ≤ 0.2）。"""
    parts = {
        "system": "系统" * 700,
        "tools": "工具" * 120,
        "conversation": "对话" * 40,
        "connectors": "连接器" * 9,
        "skills": "技能" * 3,
    }
    usage = build_context_usage(parts, window_tokens=1000)
    bucket_sum = sum(bucket["percent"] for bucket in usage["buckets"])
    assert abs(bucket_sum - usage["percent"]) <= 0.2
    # 窗口小于总量时如实显示 >100%，不夹断。
    assert usage["percent"] is not None and usage["percent"] > 100


def test_bucket_text_builders_split_by_construction():
    """分桶取数按构造来：tool 消息进"工具"桶，user/assistant 进"对话"桶。"""
    messages = [
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "回答"},
        {"role": "tool", "tool_call_id": "c1", "content": "工具结果"},
    ]
    assert conversation_text(messages) == "问题\n\n回答"
    tools_bucket = tools_text([{"type": "function"}], messages)
    assert "工具结果" in tools_bucket
    assert "function" in tools_bucket
    # 内容块列表（带图片的当前用户消息）取出文本块，图片块被跳过。
    assert message_text([{"type": "text", "text": "正文"}, {"type": "image_url"}]) == "正文"
    # 附件文本：没有可读文本时是空串，不产生一个空桶。
    assert attachment_text([{"kind": "image", "data_url": "data:x"}]) == ""
    assert attachment_text([{"kind": "document", "text": "文档正文"}]) == "文档正文"
    # 连接器桶把"界面上下文 + 项目上下文 + 附件"按固定顺序接起来（空部件跳过）。
    assert (
        connectors_text("界面块", ["项目块"], [{"text": "附件正文"}])
        == "界面块\n\n项目块\n\n附件正文"
    )
    assert connectors_text("", [], None) == ""


def test_context_usage_endpoint_returns_stored_usage(client, monkeypatch):
    """有落库的用量：原样返回（五桶齐全、窗口来自当前配置、partial 为假）。"""
    _configure_llm_with_window(client)
    _successful_provider(monkeypatch)
    conversation = _create_conversation(client)
    _send(client, conversation["id"], "帮我看看这个岗位")

    response = client.get(f"/api/assistant/conversations/{conversation['id']}/context-usage")
    assert response.status_code == 200
    body = response.json()
    assert [bucket["key"] for bucket in body["buckets"]] == list(BUCKET_KEYS)
    assert body["partial"] is False
    assert body["window"] == WINDOW
    # 估算口径：五桶都有内容（系统提示词 / 工具 schema / 当前用户消息）。
    buckets = _buckets(body)
    assert buckets["system"]["tokens"] > 0
    assert buckets["tools"]["tokens"] > 0
    assert buckets["conversation"]["tokens"] > 0
    assert body["total"] == sum(bucket["tokens"] for bucket in body["buckets"])
    assert abs(sum(b["percent"] for b in body["buckets"]) - body["percent"]) <= 0.2


def test_context_usage_endpoint_marks_old_messages_partial(client, db_session):
    """旧消息没有 context_usage：只按历史估算系统提示与对话，其余三桶为 0 并标 partial。"""
    _configure_llm_with_window(client)
    conversation = _create_conversation(client)
    db_session.add(
        ChatMessage(
            conversation_id=conversation["id"],
            role="assistant",
            content="这条回答生成时还没有用量面板",
            status="complete",
        )
    )
    db_session.commit()

    response = client.get(f"/api/assistant/conversations/{conversation['id']}/context-usage")
    assert response.status_code == 200
    body = response.json()
    assert body["partial"] is True
    buckets = _buckets(body)
    # 工具、连接器、技能无法回溯——如实记 0，不当成"这轮真的没用工具"的精确结论。
    for key in ("tools", "connectors", "skills"):
        assert buckets[key]["tokens"] == 0
    assert buckets["system"]["tokens"] > 0
    assert buckets["conversation"]["tokens"] == estimate_tokens("这条回答生成时还没有用量面板")
    assert body["usage_actual"] is None
    assert body["window"] == WINDOW


def test_context_usage_endpoint_404_for_missing_conversation(client):
    """会话不存在（或已被删除）是 404，不是一份"全 0"的用量。"""
    _configure_llm_with_window(client)
    assert client.get("/api/assistant/conversations/999/context-usage").status_code == 404


def test_stream_emits_context_usage_event(client, monkeypatch):
    """流式期间每轮下发一次 context_usage，且收尾把它落进消息 context。"""
    _configure_llm_with_window(client)
    _successful_provider(monkeypatch)
    conversation = _create_conversation(client)
    sent = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={"content": "你好"},
    )
    events = _events(sent)
    usage_events = [event for event in events if event["type"] == "context_usage"]
    assert len(usage_events) == 1
    assert [bucket["key"] for bucket in usage_events[0]["usage"]["buckets"]] == list(BUCKET_KEYS)
    assert usage_events[0]["usage"]["window"] == WINDOW
    # 事件在正文之前下发（第一轮拼装完就发），前端因此能立刻显示。
    event_types = [event["type"] for event in events]
    assert event_types[0] == "start"
    # 顺序：start → context_usage → 首个 delta → done。前端靠这条顺序决定
    # 「chip 在开口之前就更新」，只断言"有事件"证明不了它不会晚到收尾之后。
    assert event_types.index("context_usage") < event_types.index("done")
    if "delta" in event_types:
        assert event_types.index("context_usage") < event_types.index("delta")

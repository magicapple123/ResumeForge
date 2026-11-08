# SPDX-License-Identifier: Apache-2.0
"""T11 四档数据权限：档位映射、旧键同步、请求级覆盖（含流式第 2 轮）。

四档 = 一档同时决定读、写两轴（仅查看 / 放宽读取 / 可修改 / 完全权限）。三条性质必须钉住：

1. 四档 → 两轴的映射只有一份实现（参数化四条，正反双射）；
2. 请求级 relaxed_mode 覆盖优先，None 沿用全局设置（旧客户端零改动）；
3. 流式工具循环每轮都按覆盖重算——漏改的话覆盖在真实流式路径里被静默忽略，
   而单测多半走非流式端点，会全绿。
"""

from typing import get_args

import pytest
from app.schemas.assistant import AssistantMessageCreate, AssistantPermissionLevel
from app.schemas.profile import EducationIn, ProfileUpdate
from app.services.llm.base import LLMDelta
from app.services.profile.profile_service import update_profile
from app.services.settings_service import (
    ASSISTANT_PERMISSION_LEVELS,
    get_assistant_permission,
    get_assistant_relaxed_mode,
    permission_axes,
    permission_from_axes,
    reset_runtime_relaxed_override,
    resolve_assistant_relaxed_mode,
    save_assistant_permission,
    save_assistant_relaxed_mode,
    set_runtime_relaxed_override,
)
from test_assistant import (
    _configure_llm,
    _create_conversation,
    _events,
    _ScriptedProvider,
    _tool_call,
)

# 只在放宽（读真实资料）时才下发的工具（RF-01 的可撤销策略）。
_RELAXED_ONLY_TOOLS = {
    "list_web_form_fills",
    "get_web_form_fill",
    "list_chat_conversations",
    "get_chat_conversation",
}

# 四档 → 两轴（与 plan §5 B.5 的表格逐字一致）。
MAPPING = [
    ("read_only", False, False),
    ("read_full", True, False),
    ("write_confirm", False, True),
    ("write_full", True, True),
]

_PROFILE = dict(
    name="李四",
    phone="13900001234",
    email="lisi@example.com",
    city="上海",
    summary="原有总结",
    educations=[EducationIn(school="示例大学", major="软件工程")],
)


def _tool_names(tools) -> set[str]:
    return {item["function"]["name"] for item in tools or []}


def _profile_block_text(messages: list[dict]) -> str:
    """取模型实际收到的本地资料块（脱敏与否都在这里体现）。"""
    blocks = [str(item.get("content") or "") for item in messages]
    return "\n".join(block for block in blocks if "已选个人资料" in block)


def _send(client, conversation_id: int, payload: dict) -> None:
    response = client.post(
        f"/api/assistant/conversations/{conversation_id}/messages",
        json={"content": "我的手机号后四位是多少？", **payload},
    )
    assert response.status_code == 200


def _capturing_provider(monkeypatch) -> _ScriptedProvider:
    provider = _ScriptedProvider([[LLMDelta(text="好的。")]])
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    return provider


# ===== 映射表：唯一口径 =====


@pytest.mark.parametrize(("level", "relaxed", "allow_write"), MAPPING)
def test_four_levels_map_to_the_two_axes(level, relaxed, allow_write):
    assert permission_axes(level) == (relaxed, allow_write)
    # 双射：两轴能唯一还原档位（旧开关反向同步四档依赖它）。
    assert permission_from_axes(relaxed, allow_write) == level


def test_schema_literal_matches_service_levels():
    """Literal 与 service 常量各存一份，这里把它们钉在一起防漂移。"""
    assert set(get_args(AssistantPermissionLevel)) == set(ASSISTANT_PERMISSION_LEVELS)


def test_unknown_level_raises():
    with pytest.raises(ValueError):
        permission_axes("admin")


# ===== 设置端点：新键 + 旧键同步 =====


def test_permission_api_defaults_to_read_only(client):
    assert client.get("/api/assistant/permission").json() == {"permission": "read_only"}


def test_permission_api_rejects_unknown_level(client):
    response = client.put("/api/assistant/permission", json={"permission": "admin"})
    assert response.status_code == 422


@pytest.mark.parametrize(("level", "relaxed", "allow_write"), MAPPING)
def test_saving_new_key_also_syncs_the_legacy_read_axis(
    client, db_session, level, relaxed, allow_write
):
    """写新键时必须同步写旧键 assistant_relaxed_mode（否则旧读点与新四档分叉）。"""
    saved = client.put("/api/assistant/permission", json={"permission": level})
    assert saved.status_code == 200 and saved.json() == {"permission": level}

    db_session.expire_all()
    assert get_assistant_permission(db_session) == level
    assert get_assistant_relaxed_mode(db_session) is relaxed
    # 旧端点读同一个读轴（兼容面不漂移）
    assert client.get("/api/settings/assistant-relaxed-mode").json() == {"enabled": relaxed}


def test_legacy_switch_maps_to_read_axis_when_new_key_is_absent(db_session):
    """老库只有旧开关：True 当年只开了读轴 → 「放宽读取」。"""
    assert get_assistant_permission(db_session) == "read_only"
    save_assistant_relaxed_mode(db_session, True)
    db_session.expire_all()
    assert get_assistant_permission(db_session) == "read_full"


def test_legacy_writer_preserves_the_write_axis(db_session):
    """旧端点写读轴时不能把四档的写轴抹掉。"""
    save_assistant_permission(db_session, "write_confirm")
    save_assistant_relaxed_mode(db_session, True)
    db_session.expire_all()
    assert get_assistant_permission(db_session) == "write_full"


# ===== 请求覆盖：读轴 =====


def test_resolve_prefers_request_override_over_global(db_session):
    assert resolve_assistant_relaxed_mode(db_session, True) is True
    assert resolve_assistant_relaxed_mode(db_session, False) is False
    save_assistant_relaxed_mode(db_session, True)
    # None = 沿用全局（旧客户端）
    assert resolve_assistant_relaxed_mode(db_session, None) is True


def test_old_client_payload_without_override_keeps_legacy_masking(client, monkeypatch):
    """不带 relaxed_mode 的旧客户端：资料仍按全局设置脱敏，行为与改动前一致。"""
    _configure_llm(client)
    provider = _capturing_provider(monkeypatch)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], {})
    legacy_messages = provider.requests[-1]["messages"]
    legacy_tools = provider.requests[-1]["tools"]
    legacy_text = _profile_block_text(legacy_messages)
    assert "13900001234" not in legacy_text
    assert "李四" not in legacy_text

    # 字段级：显式 False 与"省略"解算结果一致（None 只是沿用全局 = False）
    _send(client, conversation["id"], {"relaxed_mode": False})
    assert _profile_block_text(provider.requests[-1]["messages"]) == legacy_text
    assert _tool_names(provider.requests[-1]["tools"]) == _tool_names(legacy_tools)


def test_request_override_turns_on_real_data_reads(client, db_session, monkeypatch):
    """全局「仅查看」时，请求覆盖 relaxed_mode=True 让本次读到真实手机号。"""
    update_profile(db_session, ProfileUpdate(**_PROFILE))
    _configure_llm(client)
    provider = _capturing_provider(monkeypatch)
    conversation = _create_conversation(client)

    # 全局默认仅查看：不覆盖时读不到真实值
    _send(client, conversation["id"], {})
    assert "13900001234" not in _profile_block_text(provider.requests[-1]["messages"])

    # 本次覆盖放宽：真实值进入模型上下文，放宽专用工具也下发
    _send(client, conversation["id"], {"relaxed_mode": True})
    relaxed_text = _profile_block_text(provider.requests[-1]["messages"])
    assert "13900001234" in relaxed_text
    assert _tool_names(provider.requests[-1]["tools"]) >= _RELAXED_ONLY_TOOLS

    # 全局设置没有被请求覆盖改写（覆盖只对这次请求生效）
    db_session.expire_all()
    assert get_assistant_relaxed_mode(db_session) is False


def test_request_override_can_narrow_a_relaxed_global(client, db_session, monkeypatch):
    """全局「放宽读取」时，请求覆盖 relaxed_mode=False 把本次收窄回脱敏。"""
    update_profile(db_session, ProfileUpdate(**_PROFILE))
    save_assistant_relaxed_mode(db_session, True)
    _configure_llm(client)
    provider = _capturing_provider(monkeypatch)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], {"relaxed_mode": False})
    assert "13900001234" not in _profile_block_text(provider.requests[-1]["messages"])
    assert _RELAXED_ONLY_TOOLS.isdisjoint(_tool_names(provider.requests[-1]["tools"]))


# ===== 流式第 2 轮：每轮重算，不能只认全局 =====


def _scripted_two_rounds(monkeypatch) -> _ScriptedProvider:
    provider = _ScriptedProvider(
        [
            [_tool_call("list_jobs", {})],
            [LLMDelta(text="已经有答案了。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    return provider


def test_stream_second_tool_round_honours_relaxed_override(client, monkeypatch):
    """漏改 assistant_stream 每轮重读那行就会红：覆盖会在真实流式路径里被静默忽略。

    全局「仅查看」，请求覆盖 relaxed_mode=True；第 1 轮与第 2 轮的工具下发集合
    都必须按放宽算（第 2 轮是每轮重读的分支，正是最容易漏的那处）。
    """
    _configure_llm(client)
    provider = _scripted_two_rounds(monkeypatch)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], {"relaxed_mode": True})

    assert len(provider.requests) >= 2
    assert _tool_names(provider.requests[0]["tools"]) >= _RELAXED_ONLY_TOOLS
    # 第 2 轮：工具循环重读设置后仍必须按请求覆盖算。
    assert _tool_names(provider.requests[1]["tools"]) >= _RELAXED_ONLY_TOOLS


def test_stream_second_tool_round_honours_narrowing_override(client, db_session, monkeypatch):
    """反向：全局放宽，但本次请求覆盖 False → 第 2 轮不得再下发放宽专用工具。"""
    save_assistant_relaxed_mode(db_session, True)
    _configure_llm(client)
    provider = _scripted_two_rounds(monkeypatch)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], {"relaxed_mode": False})

    assert len(provider.requests) >= 2
    assert _RELAXED_ONLY_TOOLS.isdisjoint(_tool_names(provider.requests[0]["tools"]))
    assert _RELAXED_ONLY_TOOLS.isdisjoint(_tool_names(provider.requests[1]["tools"]))


def test_stream_tool_reads_follow_the_request_override(client, db_session, monkeypatch):
    """流式路径里 get_profile 工具也要按请求覆盖返回未脱敏视图。

    只改上下文（load_local_context）而不改工具执行的话，模型会同时收到"上下文有真实
    手机号"与"工具说没有手机号"两种事实，从而拒绝回答真实资料问题——实机验收发现的
    正是这个矛盾（工具实现只拿得到 db，靠运行时读轴通道传请求覆盖）。
    """
    update_profile(db_session, ProfileUpdate(**_PROFILE))
    _configure_llm(client)
    provider = _ScriptedProvider(
        [
            [_tool_call("get_profile", {})],
            [LLMDelta(text="已经查到了。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], {"relaxed_mode": True})

    tool_messages = [
        str(item.get("content") or "")
        for item in provider.requests[1]["messages"]
        if item.get("role") == "tool"
    ]
    assert tool_messages, "第 2 轮应看到 get_profile 的工具结果"
    assert any("13900001234" in text for text in tool_messages)


def test_stream_tool_reads_respect_narrowing_override(client, db_session, monkeypatch):
    """反向：全局放宽 + 请求覆盖 False 时，工具结果仍必须是脱敏视图。"""
    update_profile(db_session, ProfileUpdate(**_PROFILE))
    save_assistant_relaxed_mode(db_session, True)
    _configure_llm(client)
    provider = _ScriptedProvider(
        [
            [_tool_call("get_profile", {})],
            [LLMDelta(text="已经查到了。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    _send(client, conversation["id"], {"relaxed_mode": False})

    tool_messages = [
        str(item.get("content") or "")
        for item in provider.requests[1]["messages"]
        if item.get("role") == "tool"
    ]
    assert tool_messages
    assert all("13900001234" not in text for text in tool_messages)


def test_runtime_override_is_scoped_and_reset(db_session):
    """运行时覆盖是上下文级的：设了就优先，复位后回到全局设置。"""
    save_assistant_relaxed_mode(db_session, False)
    token = set_runtime_relaxed_override(True)
    try:
        assert get_assistant_relaxed_mode(db_session) is True
    finally:
        reset_runtime_relaxed_override(token)
    assert get_assistant_relaxed_mode(db_session) is False


# ===== 写轴：allow_write 由前端解算后随请求发送 =====


def test_write_axis_executes_directly_without_write_proposal(client, monkeypatch):
    """「可修改」档（relaxed=False + allow_write=True）：写工具直接执行，不再出提案。"""
    _configure_llm(client)
    provider = _ScriptedProvider(
        [
            [_tool_call("create_job", {"title": "示例公司后端实习"})],
            [LLMDelta(text="已经创建好了。")],
        ]
    )
    monkeypatch.setattr("app.api.assistant.create_provider", lambda _config: provider)
    conversation = _create_conversation(client)

    response = client.post(
        f"/api/assistant/conversations/{conversation['id']}/messages",
        json={
            "content": "帮我创建岗位 示例公司后端实习",
            "relaxed_mode": False,
            "allow_write": True,
        },
    )
    events = _events(response)
    assert not any(event["type"] == "write_proposal" for event in events)
    assert client.get("/api/jobs").json()["total"] == 1


def test_payload_without_override_parses_with_legacy_defaults():
    """旧客户端请求体（不带 relaxed_mode）解析后 relaxed_mode=None，其余默认不变。"""
    payload = AssistantMessageCreate(content="你好")
    assert payload.relaxed_mode is None
    assert payload.allow_write is False
    assert payload.web_search is False

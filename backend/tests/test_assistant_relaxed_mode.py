"""求职助手「放宽模式」：设置读写、工具下发门控、脱敏放行与敏感工具。

放宽模式的语义：用户在设置里**知情显式开启**后，助手才能读到敏感信息（身份字段、
网申填表真实值、历史对话）。默认关闭时这些工具不下发、资料脱敏不变——这是隐私
红线，这里的每条测试都在钉它。
"""
import json

from app.models.assistant import ChatConversation, ChatMessage
from app.models.web_form_record import WebFormFillRecord
from app.schemas.profile import EducationIn, ProfileOut, ProfileUpdate
from app.services.assistant_tools import execute_tool, tool_definitions, tool_names
from app.services.profile.profile_service import update_profile
from app.services.settings_service import (
    get_assistant_relaxed_mode,
    save_assistant_relaxed_mode,
)

_RELAXED_TOOL_NAMES = {
    "list_web_form_fills",
    "get_web_form_fill",
    "list_chat_conversations",
    "get_chat_conversation",
}

_PROFILE = dict(
    name="李四",
    phone="13900000000",
    email="lisi@example.com",
    city="上海",
    summary="原有总结",
    educations=[EducationIn(school="示例大学", major="软件工程")],
)


# ===== 设置端点：读写 =====


def test_relaxed_mode_defaults_to_off(client):
    assert client.get("/api/settings/assistant-relaxed-mode").json() == {"enabled": False}


def test_relaxed_mode_round_trips(client):
    saved = client.put("/api/settings/assistant-relaxed-mode", json={"enabled": True})
    assert saved.status_code == 200
    assert saved.json() == {"enabled": True}
    assert client.get("/api/settings/assistant-relaxed-mode").json() == {"enabled": True}

    cleared = client.put("/api/settings/assistant-relaxed-mode", json={"enabled": False})
    assert cleared.json() == {"enabled": False}


def test_service_reads_see_the_persisted_flag(client, db_session):
    save_assistant_relaxed_mode(db_session, True)
    assert get_assistant_relaxed_mode(db_session) is True


# ===== 工具下发门控 =====


def test_relaxed_tools_are_hidden_by_default_and_sent_when_enabled():
    names = set(tool_names())
    assert names >= _RELAXED_TOOL_NAMES  # 注册了，但下发由门控决定

    default_defs = {d["function"]["name"] for d in tool_definitions()}
    assert _RELAXED_TOOL_NAMES & default_defs == set()

    relaxed_defs = {d["function"]["name"] for d in tool_definitions(relaxed=True)}
    assert relaxed_defs >= _RELAXED_TOOL_NAMES


# ===== 资料脱敏的放行边界 =====


def test_get_profile_stays_masked_when_relaxed_off(db_session):
    update_profile(db_session, ProfileUpdate(**_PROFILE))

    text = execute_tool(db_session, "get_profile", {}).text

    assert "李四" not in text
    assert "13900000000" not in text
    assert "lisi@example.com" not in text


def test_get_profile_reveals_identity_fields_when_relaxed_on(db_session):
    update_profile(db_session, ProfileUpdate(**_PROFILE))
    save_assistant_relaxed_mode(db_session, True)

    text = execute_tool(db_session, "get_profile", {}).text

    assert "李四" in text
    assert "13900000000" in text
    assert "lisi@example.com" in text
    # 照片二进制任何模式都不发送
    assert "base64" not in text


def test_profile_out_serialization_is_unchanged_by_the_flag(db_session):
    """放宽模式只影响"发给模型"的上下文，不改动 ProfileOut 本身。"""
    update_profile(db_session, ProfileUpdate(**_PROFILE))
    snapshot = ProfileOut.model_validate(update_profile(db_session, ProfileUpdate(**_PROFILE)))
    assert snapshot.name == "李四"


# ===== 敏感工具：网申填充记录 =====


def _seed_fill(db_session) -> int:
    record = WebFormFillRecord(
        url="https://example.com/apply",
        page_title="示例公司校招报名表",
        items=[{"field": "phone", "value": "13900000000", "status": "filled"}],
        filled=1,
        page_snapshot=[{"label": "手机号", "value": "13900000000", "filled": True}],
        source="batch",
    )
    db_session.add(record)
    db_session.commit()
    return record.id


def test_web_form_fill_tools_list_and_read_values(db_session):
    fill_id = _seed_fill(db_session)

    listed = json.loads(
        execute_tool(db_session, "list_web_form_fills", {}).text
    )
    assert listed["总数"] == 1
    # 摘要不含填写值：值只在 get 里出现
    assert "13900000000" not in listed["填充记录"][0].__str__()

    detail = json.loads(
        execute_tool(db_session, "get_web_form_fill", {"fill_id": fill_id}).text
    )
    assert detail["页面"] == "示例公司校招报名表"
    assert "13900000000" in detail["逐条明细"][0]["value"]


def test_get_web_form_fill_reports_missing_id(db_session):
    import pytest

    with pytest.raises(ValueError, match="不存在"):
        execute_tool(db_session, "get_web_form_fill", {"fill_id": 999})


# ===== 敏感工具：历史对话 =====


def test_chat_history_tools_list_and_read_messages(db_session):
    conversation = ChatConversation(title="之前的聊聊", surface="page")
    db_session.add(conversation)
    db_session.flush()
    db_session.add(
        ChatMessage(
            conversation_id=conversation.id,
            role="user",
            content="帮我把简历里的项目经历润色一下",
            status="complete",
        )
    )
    db_session.commit()

    listed = json.loads(
        execute_tool(db_session, "list_chat_conversations", {}).text
    )
    assert listed["总数"] == 1
    assert listed["对话"][0]["标题"] == "之前的聊聊"

    detail = json.loads(
        execute_tool(db_session, "get_chat_conversation", {"conversation_id": conversation.id}).text
    )
    assert detail["消息"][0]["content"] == "帮我把简历里的项目经历润色一下"


def test_get_chat_conversation_reports_missing_id(db_session):
    import pytest

    with pytest.raises(ValueError, match="不存在"):
        execute_tool(db_session, "get_chat_conversation", {"conversation_id": 999})


# ===== 系统提示的放宽说明 =====


def test_system_prompt_mentions_relaxed_mode_only_when_enabled(db_session):
    from app.api.assistant import _system_prompt

    # 端点把 DB 里的开关作为 relaxed 参数显式传入（send_message 里读取并绑进闭包）。
    # 断言用说明块独有的句子——基础提示词里会提到"放宽模式"这个开关本身。
    default_prompt = _system_prompt(db_session, relaxed=False)
    assert "本次对话允许你读取完整资料" not in default_prompt

    relaxed_prompt = _system_prompt(db_session, relaxed=True)
    assert "本次对话允许你读取完整资料" in relaxed_prompt
    assert "API 密钥" in relaxed_prompt  # 凭据边界写进提示

    # DB 开关本身随设置持久化（端点读取链路由 send_message 使用）
    save_assistant_relaxed_mode(db_session, True)
    assert get_assistant_relaxed_mode(db_session) is True

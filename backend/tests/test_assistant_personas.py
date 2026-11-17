# SPDX-License-Identifier: Apache-2.0
"""18C 多视角 preset：三个角色、一套工具、走技能通道注入系统提示。

钉住四件事：

1. 三个 preset 的 prompt 都带红线（引用简历字段 / JD 原文；禁止空口评价；不编数字分）；
2. 切换视角 = 把内置视角技能挂到对话（build_skill_prompt 拼进 system 段），**工具集不变**；
3. 切换/关闭时只替换"视角"那一条，用户自己导入的其它技能不受影响；
4. prompt 文件升级后下一次切换自动同步（技能 prompt 跟着文件走，不改用户的启用状态）。
"""

from __future__ import annotations

import pytest
from _assistant_breadth_support import (
    ScriptedProvider,
    configure_llm,
    create_conversation,
    patch_provider,
    send,
)
from app.models.assistant import AssistantSkill, ChatConversation
from app.services.assistant import assistant_personas as personas
from app.services.assistant.assistant_skills import (
    create_skill,
    list_conversation_skill_ids,
    list_conversation_skills,
    list_skills,
    set_conversation_skills,
)
from app.services.assistant_tools import tool_names

RED_LINE_PHRASES = ("引用简历字段", "JD 原文", "空口评价")


def _conversation(db_session) -> ChatConversation:
    conversation = ChatConversation(title="视角", surface="page")
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    return conversation


# ===== prompt 与目录 =====


@pytest.mark.parametrize("persona_id", personas.PERSONA_IDS)
def test_every_persona_prompt_has_the_red_line(persona_id):
    prompt = personas.persona_prompt(persona_id)
    assert len(prompt) > 200
    for phrase in RED_LINE_PHRASES:
        assert phrase in prompt, f"{persona_id} 的提示词缺红线短语：{phrase}"
    # 18C 的输出结构必须显式写死，否则模型会自由发挥。
    assert "硬规则" in prompt


def test_persona_catalog_only_exposes_protocol_ids():
    items = personas.persona_catalog()
    assert [item["id"] for item in items] == list(personas.PERSONA_IDS)
    assert all(set(item) == {"id"} for item in items)  # 显示名在前端语言包，不重复维护


def test_unknown_persona_id_is_rejected():
    with pytest.raises(ValueError) as excinfo:
        personas.normalize_persona_id("ceo")
    assert "未知的助手视角" in str(excinfo.value)


# ===== 视角是会话属性（T26：不再走技能通道）=====


def test_apply_persona_writes_the_conversation_column(db_session):
    """切换视角写 `chat_conversation.persona_id`，**不再**往对话挂技能行。"""
    conversation = _conversation(db_session)
    assert personas.apply_persona(db_session, conversation.id, "hr_scan") == "hr_scan"

    db_session.expire_all()
    assert db_session.get(ChatConversation, conversation.id).persona_id == "hr_scan"
    assert personas.current_persona_id(db_session, conversation.id) == "hr_scan"
    # 视角不再是技能：一条关联行都不该产生，也不该新建「视角 · X」技能行。
    assert list_conversation_skills(db_session, conversation.id) == []
    assert db_session.query(AssistantSkill).filter_by(name="视角 · HR 六秒扫描").count() == 0


def test_switching_persona_does_not_touch_user_skills(db_session):
    """用户自己的技能行与视角完全无关：切视角、关视角都不许动它们。"""
    conversation = _conversation(db_session)
    user_skill = create_skill(db_session, name="我的写作规范", prompt="短句优先。")
    set_conversation_skills(db_session, conversation.id, [int(user_skill.id)])
    personas.apply_persona(db_session, conversation.id, "hr_scan")
    personas.apply_persona(db_session, conversation.id, "interviewer")

    assert personas.current_persona_id(db_session, conversation.id) == "interviewer"
    assert list_conversation_skill_ids(db_session, conversation.id) == [int(user_skill.id)]
    assert [skill.name for skill in list_conversation_skills(db_session, conversation.id)] == [
        "我的写作规范"
    ]


def test_clear_persona_keeps_user_skills(db_session):
    conversation = _conversation(db_session)
    user_skill = create_skill(db_session, name="我的写作规范", prompt="短句优先。")
    set_conversation_skills(db_session, conversation.id, [int(user_skill.id)])
    personas.apply_persona(db_session, conversation.id, "headhunter")
    personas.apply_persona(db_session, conversation.id, "")

    assert personas.current_persona_id(db_session, conversation.id) == ""
    assert [skill.name for skill in list_conversation_skills(db_session, conversation.id)] == [
        "我的写作规范"
    ]


def test_persona_prompt_is_read_from_file_every_request(db_session):
    """提示词跟着文件走：库里没有副本，也就没有"旧版提示词"可残留。"""
    conversation = _conversation(db_session)
    personas.apply_persona(db_session, conversation.id, "hr_scan")

    prompt = personas.build_persona_prompt(db_session, conversation.id)
    assert personas.PERSONA_PROMPT_HEADER in prompt
    assert "HR 六秒扫描" in prompt
    # 与直接读文件的结果逐字一致（没有第二份副本需要同步）。
    assert prompt.endswith(personas.persona_prompt("hr_scan"))


def test_persona_is_independent_of_message_skills(db_session):
    """T26 验收③：视角与"这条消息带哪些技能"无关。"""
    conversation = _conversation(db_session)
    personas.apply_persona(db_session, conversation.id, "interviewer")
    user_skill = create_skill(db_session, name="我的写作规范", prompt="短句优先。")
    set_conversation_skills(db_session, conversation.id, [int(user_skill.id)])

    # 清空消息级技能之后，视角提示词仍在。
    set_conversation_skills(db_session, conversation.id, [])
    assert "面试官追问" in personas.build_persona_prompt(db_session, conversation.id)


def test_legacy_skill_link_is_read_once_and_cleared_on_write(db_session):
    """一个版本的回退读取：老会话的视角还挂在技能行上时仍能认出来；写入时清掉。"""
    conversation = _conversation(db_session)
    legacy = create_skill(db_session, name="视角 · 猎头判断", prompt="旧版")
    set_conversation_skills(db_session, conversation.id, [int(legacy.id)])

    # 列是空的 → 回退到关联行。
    db_session.expire_all()
    assert db_session.get(ChatConversation, conversation.id).persona_id == ""
    assert personas.current_persona_id(db_session, conversation.id) == "headhunter"

    # 切回通用：列写空串，同时清掉老的视角关联行，回退逻辑不能把它复活。
    personas.apply_persona(db_session, conversation.id, "")
    assert personas.current_persona_id(db_session, conversation.id) == ""
    assert list_conversation_skill_ids(db_session, conversation.id) == []


def test_skill_list_hides_builtin_personas(db_session):
    """T26 验收④：技能库列表不含「视角 · X」（行还在库里，只是不进列表）。"""
    conversation = _conversation(db_session)
    legacy = create_skill(db_session, name="视角 · 猎头判断", prompt="旧版")
    create_skill(db_session, name="我的写作规范", prompt="短句优先。")
    assert list_conversation_skills(db_session, conversation.id) == []

    visible = [skill.name for skill in list_skills(db_session)]
    assert visible == ["我的写作规范"]
    # 显式要"全部"时仍能取到（迁移/排查用），证明行没被删。
    everything = [skill.name for skill in list_skills(db_session, include_builtin_personas=True)]
    assert "视角 · 猎头判断" in everything
    assert int(legacy.id) > 0


# ===== 系统提示与工具集 =====


def test_persona_reaches_the_system_prompt_and_tools_are_unchanged(client, db_session, monkeypatch):
    """视角只换系统提示（技能段），工具清单一个字都不变。"""
    configure_llm(client)
    provider = ScriptedProvider([[]])
    patch_provider(monkeypatch, provider)
    conversation = create_conversation(client)
    before_tools = tool_names()
    personas.apply_persona(db_session, conversation["id"], "hr_scan")

    send(client, conversation["id"], "帮我用 HR 视角扫一下这份简历")

    system = provider.requests[0]["messages"][0]
    assert system["role"] == "system"
    assert "HR 六秒扫描" in system["content"]
    assert "引用简历字段" in system["content"]
    # 工具集不变：注册表与下发给模型的清单都不因视角而改变。
    assert tool_names() == before_tools
    declared = [item["function"]["name"] for item in provider.requests[0]["tools"] or []]
    # 无写入意图时写工具本来就不下发（T17 行为），视角不改变这条过滤。
    assert declared and set(declared) <= set(before_tools)

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


# ===== 挂到对话（技能通道）=====


def test_apply_persona_attaches_builtin_skill(db_session):
    conversation = _conversation(db_session)
    ids = personas.apply_persona(db_session, conversation.id, "hr_scan")
    skills = list_conversation_skills(db_session, conversation.id)
    assert len(ids) == 1 and len(skills) == 1
    assert skills[0].name == "视角 · HR 六秒扫描"
    assert "HR 六秒扫描" in (skills[0].prompt or "")
    assert personas.current_persona_id(db_session, conversation.id) == "hr_scan"


def test_switch_persona_replaces_only_the_persona_skill(db_session):
    conversation = _conversation(db_session)
    user_skill = create_skill(db_session, name="我的写作规范", prompt="短句优先。")
    set_conversation_skills(db_session, conversation.id, [int(user_skill.id)])
    personas.apply_persona(db_session, conversation.id, "hr_scan")
    personas.apply_persona(db_session, conversation.id, "interviewer")

    skills = list_conversation_skills(db_session, conversation.id)
    names = [skill.name for skill in skills]
    assert "视角 · 面试官追问" in names
    assert "视角 · HR 六秒扫描" not in names
    assert "我的写作规范" in names  # 用户自己的技能不被视角切换清掉
    assert int(user_skill.id) in list_conversation_skill_ids(db_session, conversation.id)
    assert personas.current_persona_id(db_session, conversation.id) == "interviewer"


def test_clear_persona_keeps_user_skills(db_session):
    conversation = _conversation(db_session)
    user_skill = create_skill(db_session, name="我的写作规范", prompt="短句优先。")
    set_conversation_skills(db_session, conversation.id, [int(user_skill.id)])
    personas.apply_persona(db_session, conversation.id, "headhunter")
    personas.apply_persona(db_session, conversation.id, "")

    names = [skill.name for skill in list_conversation_skills(db_session, conversation.id)]
    assert names == ["我的写作规范"]
    assert personas.current_persona_id(db_session, conversation.id) == ""


def test_persona_prompt_resyncs_after_file_upgrade(db_session):
    conversation = _conversation(db_session)
    personas.apply_persona(db_session, conversation.id, "hr_scan")
    skill = db_session.query(AssistantSkill).filter_by(name="视角 · HR 六秒扫描").one()
    skill.prompt = "旧版提示词"
    db_session.commit()

    personas.apply_persona(db_session, conversation.id, "hr_scan")
    db_session.expire_all()
    refreshed = db_session.query(AssistantSkill).filter_by(name="视角 · HR 六秒扫描").one()
    assert "旧版提示词" not in (refreshed.prompt or "")
    assert "HR 六秒扫描" in (refreshed.prompt or "")


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

# SPDX-License-Identifier: Apache-2.0
"""人设与面试官风格**互斥**（问题 06）：只让一个生效。

此前是"叠加"：`interview_system.md` 仍渲染 `你的风格：持续追问`，persona 段落又声称
"优先级高于上面的默认风格"，`behavior_directives_for` 还照样注入 ``BEHAVIOR_BY_STYLE``
对应的行为指令。模型同时收到三份输入，实际是混着执行——前端把风格下拉框灰掉也拦不住，
因为真正生效的是提示词。

现在两端同一口径：``persona`` 非空 → 风格名替换成"（自定义人设优先，见下）"，
``behavior_directives_for`` 的第三参传 ``None``，于是 ``BEHAVIOR_BY_STYLE`` 一条都不注入；
类型与难度的行为指令不受影响（它们与风格无关）。清空人设则完全回到原行为。
"""

from __future__ import annotations

import pytest
from app.models.interview import InterviewSession
from app.services.interview.interview import (
    STYLE_OVERRIDDEN_BY_PERSONA,
    build_closing_messages,
    build_interview_messages,
    persona_and_style,
    style_label_for,
)
from app.services.interview.interview_behavior import (
    BEHAVIOR_BY_DIFFICULTY,
    BEHAVIOR_BY_STYLE,
    BEHAVIOR_BY_TYPE,
)

_PERSONA = "你是某公司业务负责人，喜欢追问具体数字与落地过程。"


def _session(**overrides) -> InterviewSession:
    values = {
        "title": "后端开发 模拟面试",
        "job_title": "后端开发工程师",
        "company": "示例公司",
        "interview_type": "技术面",
        "difficulty": "中级",
        "interviewer_style": "持续追问",
        "rounds": 5,
        "focus": "Go 并发",
        "persona": "",
    }
    values.update(overrides)
    return InterviewSession(**values)


def _system_of(messages: list[dict[str, str]]) -> str:
    return next(item["content"] for item in messages if item["role"] == "system")


def _question_system(session: InterviewSession) -> str:
    """提问轮（index=2，非首轮）的 system 提示词。"""
    return _system_of(build_interview_messages(session, index=2))


def _closing_system(session: InterviewSession) -> str:
    return _system_of(build_closing_messages(session))


def test_persona_and_style_helper_is_exclusive() -> None:
    """判断只写在一处：有 persona 就没有 style，反之保留。"""
    persona, style = persona_and_style(_session(persona=_PERSONA))
    assert persona == _PERSONA
    assert style is None

    persona, style = persona_and_style(_session(persona=""))
    assert persona == ""
    assert style == "持续追问"


def test_style_label_for_names_the_override_only_when_persona_exists() -> None:
    assert style_label_for(_PERSONA, None) == STYLE_OVERRIDDEN_BY_PERSONA
    assert style_label_for("", "持续追问") == "持续追问"


def test_style_directive_is_dropped_when_persona_is_set() -> None:
    """persona 非空：``BEHAVIOR_BY_STYLE`` 一条都不注入，类型与难度仍在。"""
    system = _question_system(_session(persona=_PERSONA))

    for directive in BEHAVIOR_BY_STYLE.values():
        assert directive not in system
    assert BEHAVIOR_BY_TYPE["技术面"] in system
    assert BEHAVIOR_BY_DIFFICULTY["中级"] in system


def test_style_name_is_not_rendered_when_persona_is_set() -> None:
    """风格**名**也不出现：模板里「你的风格」那一行换成"人设优先"的说明。"""
    system = _question_system(_session(persona=_PERSONA))

    assert "你的风格：持续追问" not in system
    assert STYLE_OVERRIDDEN_BY_PERSONA in system
    assert _PERSONA in system


def test_all_three_directives_exist_without_persona() -> None:
    """persona 为空：三条行为指令都在（回到原行为，互斥只在有 persona 时成立）。"""
    system = _question_system(_session(persona=""))

    assert BEHAVIOR_BY_TYPE["技术面"] in system
    assert BEHAVIOR_BY_DIFFICULTY["中级"] in system
    assert BEHAVIOR_BY_STYLE["持续追问"] in system
    assert "你的风格：持续追问" in system
    assert STYLE_OVERRIDDEN_BY_PERSONA not in system


def test_whitespace_only_persona_still_uses_the_style() -> None:
    """只打了空格的人设等于没填：不能因此把风格也一起关掉。"""
    persona, style = persona_and_style(_session(persona="   \n\t  "))
    assert persona == ""
    assert style == "持续追问"

    system = _question_system(_session(persona="   \n\t  "))
    assert BEHAVIOR_BY_STYLE["持续追问"] in system


def test_closing_prompt_also_drops_the_style_name() -> None:
    """收尾那一轮同一口径：否则最后一句话的语气会突然切回风格设定。"""
    with_persona = _closing_system(_session(persona=_PERSONA))

    assert "你的风格：持续追问" not in with_persona
    assert STYLE_OVERRIDDEN_BY_PERSONA in with_persona
    assert _PERSONA in with_persona

    without_persona = _closing_system(_session(persona=""))
    assert "你的风格：持续追问" in without_persona
    assert STYLE_OVERRIDDEN_BY_PERSONA not in without_persona


def test_closing_prompt_keeps_the_persona_section_only_when_filled() -> None:
    """人设为空时整段消失（`{% if persona %}` 条件块），不留空标题。"""
    assert "面试官人设" not in _closing_system(_session(persona=""))
    assert "面试官人设" in _closing_system(_session(persona=_PERSONA))


@pytest.mark.parametrize("style", list(BEHAVIOR_BY_STYLE))
def test_every_style_is_masked_by_a_persona(style: str) -> None:
    """逐个风格验证：互斥不是只对某一个枚举值生效。"""
    system = _question_system(_session(interviewer_style=style, persona=_PERSONA))

    assert BEHAVIOR_BY_STYLE[style] not in system
    assert f"你的风格：{style}" not in system

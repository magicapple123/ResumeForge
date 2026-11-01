# SPDX-License-Identifier: Apache-2.0
"""#43：行为定义表的**枚举覆盖守卫**——schemas 里的每个枚举值都必须有行为定义。

新加一个面试类型/难度/风格而不补行为定义时，这条立刻变红（否则新值静默退回
「只是个标签」，正是 #43 要修的缺陷形态）。
"""

from app.schemas.interview import (
    InterviewDifficulty,
    InterviewerStyle,
    InterviewType,
)
from app.services.interview.interview import build_interview_messages  # noqa: F401
from app.services.interview.interview_behavior import (
    BEHAVIOR_BY_DIFFICULTY,
    BEHAVIOR_BY_STYLE,
    BEHAVIOR_BY_TYPE,
    behavior_directives_for,
)


def _literal_values(literal) -> list[str]:
    return [v for v in literal.__args__ if isinstance(v, str)]


def test_every_type_has_behavior() -> None:
    missing = [v for v in _literal_values(InterviewType) if v not in BEHAVIOR_BY_TYPE]
    assert missing == [], f"这些面试类型缺行为定义：{missing}"


def test_every_difficulty_has_behavior() -> None:
    missing = [v for v in _literal_values(InterviewDifficulty) if v not in BEHAVIOR_BY_DIFFICULTY]
    assert missing == [], f"这些难度缺行为定义：{missing}"


def test_every_style_has_behavior() -> None:
    missing = [v for v in _literal_values(InterviewerStyle) if v not in BEHAVIOR_BY_STYLE]
    assert missing == [], f"这些风格缺行为定义：{missing}"


def test_directives_carry_actionable_differences() -> None:
    """每条指令都要有可执行差异：长度下限 + 至少一个行为动词/具体阈值。"""
    for table in (BEHAVIOR_BY_TYPE, BEHAVIOR_BY_DIFFICULTY, BEHAVIOR_BY_STYLE):
        for value, directive in table.items():
            assert len(directive) >= 40, f"{value} 的指令太短，不像行为定义：{directive!r}"


def test_unknown_values_are_skipped_silently() -> None:
    """未知/空值不炸渲染（旧行记录与坏数据兜底）。"""
    assert behavior_directives_for("不存在的类型", None, "") == ""
    assert "STAR" in behavior_directives_for("行为面（STAR）", None, None)


def test_system_prompt_renders_behavior_section() -> None:
    """端到端：拼 system prompt 时行为约定真的渲染进去（#43 的最终判据）。"""
    from app.services.interview.interview import _load_prompt, _render  # noqa: PLC0415

    system = _render(
        _load_prompt("interview_system.md"),
        {
            "interview_type": "行为面（STAR）",
            "difficulty": "初级",
            "interviewer_style": "温和引导",
            "rounds": 5,
            "rounds_min": "",
            "index": 1,
            "job_title": "后端工程师",
            "company": "",
            "focus": "",
            "persona": "",
            "first_round": "true",
            "behavior_directives": behavior_directives_for("行为面（STAR）", "初级", "温和引导"),
        },
    )
    assert "本场行为约定" in system
    assert "STAR" in system
    assert "题面要短" in system

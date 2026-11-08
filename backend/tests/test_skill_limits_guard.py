# SPDX-License-Identifier: Apache-2.0
"""T14 上限一致性守卫：工具描述里给模型看的数字必须与 schemas/skill.py 一致。

背景：改前 schemas/skill.py 是 200,000 字提示词 / 50 个文件，而工具描述写的是
10 个文件 / 20,000 / 合计 60,000——模型按工具描述的口径调用（一次塞 10 个文件），
保存时按 schema 校验却可能放行或拒绝得不一样；收紧上限时如果只改 schema、忘了工具
描述，模型会继续按旧口径承诺用户。

做法：从 create_skill / update_skill 的**最终 description**（模型实际看到的那份）里
正则抠出四个数字，与 schemas/skill.py 的常量逐个比对；同时校验
assistant_tools/_shared.py 与技能包导入（skill_archive）用的是同一组值——它们是
报错文案与导入校验的数字来源，漂了同样会让用户撞上"前后不一致"。

反证（T14 证据目录里有记录）：把任一常量改坏 → 本文件精确红；逐字节复原 → 复绿。
"""

from __future__ import annotations

import re

import pytest
from app.schemas import skill as skill_schema
from app.services import skill_archive
from app.services.assistant_tools import _shared, get_tool

_TOOL_NAMES = ("create_skill", "update_skill")

_PROMPT_CHARS_RE = re.compile(r"提示词不超过 (\d+) 字符")
_FILES_RE = re.compile(r"最多 (\d+) 个文件")
_FILE_CHARS_RE = re.compile(r"单文件不超过 (\d+) 字符")
_TOTAL_CHARS_RE = re.compile(r"合计不超过 (\d+) 字符")


def _extract(tool_name: str) -> tuple[int, int, int, int]:
    """从工具描述里抠出 (文件数, 单文件字符, 合计字符, 提示词字符)。"""
    tool = get_tool(tool_name)
    assert tool is not None, f"工具 {tool_name} 没有注册，描述守卫无从校验"
    description = tool.description
    numbers: list[int] = []
    for pattern in (_FILES_RE, _FILE_CHARS_RE, _TOTAL_CHARS_RE, _PROMPT_CHARS_RE):
        match = pattern.search(description)
        assert match is not None, (
            f"{tool_name} 的工具描述缺少上限句式 {pattern.pattern!r}；"
            f"模型看不到这个数字就会按自己的旧印象调用。当前描述：{description}"
        )
        numbers.append(int(match.group(1)))
    return numbers[0], numbers[1], numbers[2], numbers[3]


@pytest.mark.parametrize("tool_name", _TOOL_NAMES)
def test_tool_description_limits_match_schema_constants(tool_name: str):
    files, file_chars, total_chars, prompt_chars = _extract(tool_name)

    assert files == skill_schema.MAX_SKILL_FILES, f"{tool_name}: 文件数上限与 schema 不一致"
    assert file_chars == skill_schema.MAX_SKILL_FILE_CHARS, (
        f"{tool_name}: 单文件上限与 schema 不一致"
    )
    assert total_chars == skill_schema.MAX_SKILL_TOTAL_FILE_CHARS, (
        f"{tool_name}: 合计上限与 schema 不一致"
    )
    assert prompt_chars == skill_schema.MAX_SKILL_PROMPT_CHARS, (
        f"{tool_name}: 提示词上限与 schema 不一致"
    )


def test_shared_handler_constants_match_schema():
    """工具 handler 的报错文案用的是 _shared 常量；漂了同样会与 schema 打架。"""
    assert _shared.MAX_ASSISTANT_SKILL_FILES == skill_schema.MAX_SKILL_FILES
    assert _shared.MAX_ASSISTANT_SKILL_FILE_CHARS == skill_schema.MAX_SKILL_FILE_CHARS
    assert _shared.MAX_ASSISTANT_SKILL_TOTAL_CHARS == skill_schema.MAX_SKILL_TOTAL_FILE_CHARS


def test_skill_archive_import_uses_the_same_limits():
    """ZIP / .md 导入是写入技能的另一条入口，必须受同一组上限约束。"""
    assert skill_archive.MAX_SKILL_FILES == skill_schema.MAX_SKILL_FILES
    assert skill_archive.MAX_SKILL_FILE_CHARS == skill_schema.MAX_SKILL_FILE_CHARS
    assert skill_archive.MAX_SKILL_PROMPT_CHARS == skill_schema.MAX_SKILL_PROMPT_CHARS
    assert skill_archive.MAX_SKILL_TOTAL_FILE_CHARS == skill_schema.MAX_SKILL_TOTAL_FILE_CHARS


def test_detail_view_can_always_return_a_legal_skill():
    """详情接口的正文预算必须覆盖合法技能包的总量，否则"能保存却读不全"。"""
    assert skill_schema.MAX_SKILL_DETAIL_FILE_CHARS >= skill_schema.MAX_SKILL_TOTAL_FILE_CHARS


def test_prompt_budget_is_smaller_than_what_can_be_saved():
    """提示词上限（4000）必须小于注入预算（12,000）：否则单个技能就吃掉全部预算。"""
    from app.services.assistant.assistant_skills import MAX_SKILL_PROMPT_CHARS as BUDGET

    assert skill_schema.MAX_SKILL_PROMPT_CHARS < BUDGET

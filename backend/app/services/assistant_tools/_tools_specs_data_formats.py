# SPDX-License-Identifier: Apache-2.0
"""版式（format templates）工具声明：新建 / 修改 / 列出自制版式。

从 ``_tools_specs_data.py`` 按工具域纯搬出（声明体逐字未改）。参数项清单由
``data_tools._format_tool_properties()`` 给出，两个写工具共用同一份。
"""

from __future__ import annotations

from . import previews
from ._types import Tool
from .data_tools import (
    _format_tool_properties,
    _tool_create_format_template,
    _tool_list_format_templates,
    _tool_update_format_template,
)

FORMAT_TEMPLATE_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="create_format_template",
        description=(
            "新建一个「版式」——只调排版参数（强调色/行高/页边距/区块间距/字号系数），不写 HTML。"
            "用户说「版式太挤」「帮我压进一页」「换个强调色」「做一个版式」时用它。"
            "至少设置一项参数。名称限 1-40 个字符、只能含中文/字母/数字/空格/下划线/连字符，"
            "且不能与内置或已有的模板、版式重名；自制模板与版式的总数上限 40 个。"
            "注意：**模板（外观骨架、完整 HTML）这一层不能用工具创建**，那需要用户到「工作台」页操作；"
            "版式这一层可以，本工具就是做这个的。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "版式名称（1-40 字符，中文/字母/数字/空格/下划线/连字符）",
                },
                "description": {"type": "string", "description": "可选，一句话说明用途"},
                **_format_tool_properties(),
            },
            "required": ["name"],
        },
        handler=_tool_create_format_template,
        preview=previews.preview_create_format_template,
        writes=True,
    ),
    Tool(
        name="update_format_template",
        description=(
            "修改一个**自制版式**的排版参数（只传要改的项）。用 template_id 或 template_name "
            "指明目标；只改一项时不会清空其它已设参数。内置版式不能改（它不在自制清单里）；"
            "模板（外观骨架、完整 HTML）也不能改，只能由用户到「工作台」页修改。"
            "但版式这一层的参数是可以新建和修改的，别因为模板改不了就说版式也改不了。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "template_id": {
                    "type": "integer",
                    "description": "版式 id（与 template_name 二选一）",
                },
                "template_name": {
                    "type": "string",
                    "description": "版式名称（与 template_id 二选一）",
                },
                "name": {"type": "string", "description": "可选，改名（不能与已有模板或版式重名）"},
                "description": {"type": "string", "description": "可选，改说明"},
                **_format_tool_properties(),
            },
            "required": [],
        },
        handler=_tool_update_format_template,
        preview=previews.preview_update_format_template,
        writes=True,
    ),
    Tool(
        name="list_format_templates",
        description=(
            "列出用户自制的版式（id、名称、说明、排版参数如强调色/行高/页边距）。"
            "用户问「我有哪些版式」「之前那个版式设了哪些参数」时用它，"
            "也用于在 update_format_template 之前确认要改哪一个。"
            "内置版式与模板（完整 HTML）不在此列，它们只能在「工作台」页查看。"
        ),
        parameters={"type": "object", "properties": {}, "required": []},
        handler=_tool_list_format_templates,
    ),
)

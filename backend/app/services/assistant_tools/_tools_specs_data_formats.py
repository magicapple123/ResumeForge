# SPDX-License-Identifier: Apache-2.0
"""版式（format templates）工具声明：新建 / 修改 / 列出自制版式。

T28 收尾批：create/list 两对迁入 action 契约层（``actions/domains/format_templates.py``）；
``update_format_template`` **保留静态声明**——路由路径参数 ``template_id`` 必须必填，
而旧工具允许只给 ``template_name`` 按名定位，同一份 input_model 无法同时表达（见域模块
docstring 与 T28 汇报的跳过原因）。参数项清单仍由 ``data_tools._format_tool_properties()``
给出。
"""

from __future__ import annotations

from ..actions.domains.format_templates import format_template_actions
from ..actions.tool_adapter import as_tool
from . import previews
from ._types import Tool, ToolPermission
from .data_tools import _format_tool_properties, _tool_update_format_template

_ACTIONS = format_template_actions()

FORMAT_TEMPLATE_TOOLS: tuple[Tool, ...] = (
    as_tool(_ACTIONS["create_format_template"]),
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
        service_entry="resume.resume_template_store.update_user_template",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=previews.preview_update_format_template,
    ),
    as_tool(_ACTIONS["list_format_templates"]),
)

__all__ = ["FORMAT_TEMPLATE_TOOLS"]


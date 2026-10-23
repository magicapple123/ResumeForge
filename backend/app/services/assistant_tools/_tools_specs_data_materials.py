# SPDX-License-Identifier: Apache-2.0
"""资料箱（materials）工具声明：列出 / 读取 / 新建 / 修改一条资料。

从 ``_tools_specs_data.py`` 按工具域纯搬出（声明体逐字未改）；聚合入口仍是
``_tools_specs_data.py``，``_TOOLS`` 的拼接顺序因此在 ``_registry.py`` 里不变。
"""

from __future__ import annotations

from . import previews
from ._types import Tool
from .data_tools import (
    _tool_create_material,
    _tool_get_material,
    _tool_list_materials,
    _tool_update_material,
)

MATERIAL_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_materials",
        description=(
            "列出资料箱里的资料（找工作与面试相关的材料：证书、作品、链接、笔记、"
            "面试总结、实习材料等）。用户提到「我之前存过…」「资料箱里有什么」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，标题/正文/备注里的关键词"},
                "category": {"type": "string", "description": "可选，分类名，如 证书、作品、链接"},
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_materials,
    ),
    Tool(
        name="get_material",
        description="按 id 读取资料箱里某一条资料的完整内容（含附件里提取出的文字）。",
        parameters={
            "type": "object",
            "properties": {"material_id": {"type": "integer", "description": "资料 id"}},
            "required": ["material_id"],
        },
        handler=_tool_get_material,
    ),
    Tool(
        name="create_material",
        description=(
            "把一段资料收进资料箱。只在用户明确要求保存时调用。"
            "适合存的是与找工作/面试相关的东西：证书、作品、面经、公司信息、面试复盘等。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "标题"},
                "category": {"type": "string", "description": "分类，如 证书/作品/链接/笔记/其他"},
                "content": {"type": "string", "description": "正文内容"},
                "url": {"type": "string", "description": "相关链接（可选）"},
                "note": {"type": "string", "description": "备注（可选）"},
            },
            "required": [],
        },
        handler=_tool_create_material,
        preview=previews.preview_create_material,
        writes=True,
    ),
    Tool(
        name="update_material",
        description="修改资料箱里已有的一条资料（只传要改的字段，其余保持不变）。",
        parameters={
            "type": "object",
            "properties": {
                "material_id": {"type": "integer", "description": "资料 id"},
                "title": {"type": "string"},
                "category": {"type": "string"},
                "content": {"type": "string"},
                "url": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": ["material_id"],
        },
        handler=_tool_update_material,
        preview=previews.preview_update_material,
        writes=True,
    ),
)

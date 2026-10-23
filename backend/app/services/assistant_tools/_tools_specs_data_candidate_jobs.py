# SPDX-License-Identifier: Apache-2.0
"""备选岗位（candidate jobs）工具声明：列出 / 读取 / 新建 / 修改 / 导入成正式岗位。

从 ``_tools_specs_data.py`` 按工具域纯搬出（声明体逐字未改）。
"""

from __future__ import annotations

from . import previews
from ._types import Tool
from .data_tools import (
    _tool_create_candidate_job,
    _tool_get_candidate_job,
    _tool_import_candidate_job,
    _tool_list_candidate_jobs,
    _tool_update_candidate_job,
)

CANDIDATE_JOB_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_candidate_jobs",
        description="列出备选岗位（还没导入正式岗位的招聘信息），可按状态或关键词筛选。",
        parameters={
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["pending", "imported"],
                    "description": "可选：pending 待处理，imported 已导入",
                },
                "keyword": {"type": "string", "description": "可选，岗位/公司/原文里的关键词"},
                "limit": {"type": "integer", "description": "可选，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_candidate_jobs,
    ),
    Tool(
        name="get_candidate_job",
        description="按 id 读取一条备选岗位的完整招聘原文。",
        parameters={
            "type": "object",
            "properties": {"candidate_id": {"type": "integer", "description": "备选岗位 id"}},
            "required": ["candidate_id"],
        },
        handler=_tool_get_candidate_job,
    ),
    Tool(
        name="create_candidate_job",
        description=(
            "把还没核对的招聘信息放进备选岗位。用户说「先记下来」「放到备选」时使用；"
            "已在正式岗位里的招聘信息不要再放这里。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "岗位名称（可留空，稍后补）"},
                "company": {"type": "string", "description": "公司名称"},
                "raw_text": {"type": "string", "description": "招聘信息原文"},
                "note": {"type": "string", "description": "备注"},
            },
            "required": [],
        },
        handler=_tool_create_candidate_job,
        preview=previews.preview_create_candidate_job,
        writes=True,
    ),
    Tool(
        name="update_candidate_job",
        description="修改一条备选岗位的内容（只传要改的字段）。",
        parameters={
            "type": "object",
            "properties": {
                "candidate_id": {"type": "integer", "description": "备选岗位 id"},
                "title": {"type": "string"},
                "company": {"type": "string"},
                "raw_text": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": ["candidate_id"],
        },
        handler=_tool_update_candidate_job,
        preview=previews.preview_update_candidate_job,
        writes=True,
    ),
    Tool(
        name="import_candidate_job",
        description=(
            "把备选岗位导入成岗位广场里的正式岗位。用户明确要求导入时调用；"
            "重复调用不会创建第二份，会返回已导入的岗位 id。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "candidate_id": {"type": "integer", "description": "备选岗位 id"},
                "title": {"type": "string", "description": "可选，覆盖导入后的岗位名称"},
                "company": {"type": "string", "description": "可选，覆盖公司名称"},
            },
            "required": ["candidate_id"],
        },
        handler=_tool_import_candidate_job,
        preview=previews.preview_import_candidate_job,
        writes=True,
    ),
)

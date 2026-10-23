# SPDX-License-Identifier: Apache-2.0
"""文件副本库（user files）工具声明：只列元数据，读不到文件内容。

从 ``_tools_specs_data.py`` 按工具域纯搬出（声明体逐字未改）。
"""

from __future__ import annotations

from ._types import Tool
from .data_tools import (
    _tool_list_user_files,
)

USER_FILE_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_user_files",
        description=(
            "列出文件副本库（资料箱「文件副本」页签）里的文件副本：所有存入简历通的文件都会"
            "自动留一份副本（资料箱附件、简历照片、岗位备注图、备选岗位截图、助手消息附件），"
            "同一份内容按指纹去重。用户问「我存过哪些文件」「那张照片/截图还在吗」时用它。"
            "**只返回元数据（文件名、类型、大小、来源）**，你读不了文件内容；"
            "预览、用系统程序打开或删除文件都在资料箱「文件副本」页签操作，助手做不到。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，文件名里的关键词"},
                "source_type": {
                    "type": "string",
                    "enum": [
                        "material",
                        "photo",
                        "job_note",
                        "candidate_image",
                        "chat_attachment",
                    ],
                    "description": (
                        "可选，按来源筛选：material 资料箱附件、photo 简历照片、"
                        "job_note 岗位备注图、candidate_image 备选岗位截图、"
                        "chat_attachment 助手消息附件"
                    ),
                },
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_user_files,
    ),
)

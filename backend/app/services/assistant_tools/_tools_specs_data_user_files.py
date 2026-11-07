# SPDX-License-Identifier: Apache-2.0
"""文件副本库（user files）工具声明：只列元数据，读不到文件内容。

从 ``_tools_specs_data.py`` 按工具域纯搬出（声明体逐字未改）。
"""

from __future__ import annotations

from ..actions.domains.user_files import user_file_actions
from ..actions.tool_adapter import as_tool
from ._types import Tool

USER_FILE_TOOLS: tuple[Tool, ...] = (
    as_tool(user_file_actions()["list_user_files"]),
)

# SPDX-License-Identifier: Apache-2.0
"""求职助手可调用的工具：读项目数据，以及新增/修改。

**边界（用户已确认）**：助手能新增和修改，但**不提供任何删除类工具**。设置里的模型
配置与数据集管理也不在工具里：那两个端点有回环强制校验，工具化等于绕过它。

**权限分级（T17）**：每个工具在注册处显式声明 `ToolPermission` 四级之一（read_only /
reversible_write / irreversible_write / external_side_effect）。当前唯一不可逆的是
`update_skill` 传 files 时整体替换知识文件（旧文件没有版本可恢复），执行前仍需用户
在写入提案上确认；外部副作用级**只有一个** `apply_start`（#15F 用户拍板的唯一例外：
开始投递会真的向招聘平台提交、不可撤销），它永远走提案卡，且不在 write_full 下直接执行。

写工具的参数一律交给现成的 Pydantic schema 校验（`JobCreate` / `JobUpdate` /
`ProfileUpdate`），与 HTTP 接口共用同一套约束，不另写一份。

按职责拆分：``_types``（Tool/ToolResult/联网搜索描述）、``_shared``（跨域 helper 与
常量）、``_registry``（注册表与执行入口）、``job_tools`` / ``data_tools`` /
``report_tools`` / ``search_tools``（按域拆分的 handler）。对外只从这里导入。
"""
from ._registry import (
    _TOOLS,
    execute_tool,
    execute_tool_async,
    get_tool,
    tool_definitions,
    tool_names,
    tool_writes,
)
from ._shared import (  # noqa: F401 - 历史导出，测试经 assistant_tools.X 访问
    MAX_ASSISTANT_SKILL_FILE_CHARS,
    MAX_ASSISTANT_SKILL_FILES,
    MAX_ASSISTANT_SKILL_TOTAL_CHARS,
)
from ._types import Tool, ToolPermission, ToolResult, web_search_description

__all__ = [
    "ToolResult",
    "Tool",
    "ToolPermission",
    "_TOOLS",
    "execute_tool",
    "execute_tool_async",
    "get_tool",
    "tool_definitions",
    "tool_names",
    "tool_writes",
    "web_search_description",
]

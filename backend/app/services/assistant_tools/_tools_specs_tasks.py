# SPDX-License-Identifier: Apache-2.0
"""长任务工具声明（18A）：task_create / task_status / task_cancel。

这三条不是"再来三个领域工具"，而是**能力轴**上的补洞：把跨轮批量活搬出对话回合
（单轮 30 轮上限不变，长活走任务卡）。注册方式与其它域一致——本文件只放声明，由
_registry.py 用 *TASK_TOOLS 追加到注册表末尾（顺序即发给模型的工具列表顺序）。
"""

from __future__ import annotations

from ._types import Tool, ToolPermission
from .task_tools import (
    MAX_JOB_BATCH,
    MAX_TASK_ITEMS,
    _preview_task_cancel,
    _preview_task_create,
    _tool_task_cancel,
    _tool_task_create,
    _tool_task_status,
)

#: 任务类型 → 参数形状。写进工具描述（模型据此知道 params 该给什么），
#: 也与 task_tools._PLANNERS 的键一一对应（守卫测试钉住两处一致）。
_TASK_KIND_HINT = (
    "可选类型与参数："
    "resume_batch_edit（resume_id 简历 id、instruction 改写要求、section 可选的板块 key）；"
    "job_import（url 网页链接、limit 最多抓取条数 1–200）；"
    "match_batch（job_ids 岗位 id 数组，最多 "
    f"{MAX_JOB_BATCH} 个）；"
    "greeting_batch（job_ids 岗位 id 数组，最多 "
    f"{MAX_JOB_BATCH} 个、template 可选话术模板）。"
)

TASK_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="task_create",
        description=(
            "把一个**跨轮批量**的活创建成 Agent 任务卡（多步计划，可在任务卡开始/暂停/取消，"
            "重启后进度仍在）。只用于单轮做不完、预计工具调用超过 20 次的批量操作；"
            "一轮内能完成的事直接做，只改一个字段不要建任务。"
            "创建前先把条数算清楚：提案卡会写明将处理 N 条、预计 M 步。"
            + _TASK_KIND_HINT
            + f"单次任务最多 {MAX_TASK_ITEMS} 条。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": [
                        "resume_batch_edit",
                        "job_import",
                        "match_batch",
                        "greeting_batch",
                    ],
                    "description": "任务类型（决定 params 的形状与步骤计划）",
                },
                "params": {
                    "type": "object",
                    "description": "按 kind 提供的参数；形状见工具描述。",
                },
            },
            "required": ["kind", "params"],
        },
        handler=_tool_task_create,
        service_entry="agent_task_service.create_task",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=_preview_task_create,
    ),
    Tool(
        name="task_status",
        description=(
            "查一个 Agent 任务的进度：整体状态、已完成/总步数、当前这一步。"
            "用户问「那个批量任务跑到哪了」时用它；不要凭记忆编进度。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "minimum": 1, "description": "任务 id"},
            },
            "required": ["task_id"],
        },
        handler=_tool_task_status,
        service_entry="agent_task_service.get_task",
        permission=ToolPermission.READ_ONLY,
    ),
    Tool(
        name="task_cancel",
        description=(
            "取消一个还没结束的 Agent 任务：已完成的步骤保留，未完成的步骤不再执行。"
            "取消是终态、不能恢复为进行中（要接着做就重新建任务）。用户明确要求取消时才用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "task_id": {"type": "integer", "minimum": 1, "description": "任务 id"},
            },
            "required": ["task_id"],
        },
        handler=_tool_task_cancel,
        service_entry="agent_task_service.cancel",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=_preview_task_cancel,
    ),
)

__all__ = ["TASK_TOOLS"]

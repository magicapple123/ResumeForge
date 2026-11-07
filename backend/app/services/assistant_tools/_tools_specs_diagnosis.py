# SPDX-License-Identifier: Apache-2.0
"""只读错误诊断工具声明（T31）：diagnose_recent_errors。

只读（``permission=ToolPermission.READ_ONLY`` / ``writes=False`` / ``preview=None``）：
只聚合本机已有的任务/投递/网申失败枚举与日志白名单字段，不写库、不调模型、不返回日志
原文与任何用户数据。handler 在 ``error_diagnosis.py``。
"""

from __future__ import annotations

from ._types import Tool, ToolPermission
from .error_diagnosis import _tool_diagnose_recent_errors

DIAGNOSIS_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="diagnose_recent_errors",
        description=(
            "只读诊断最近一段时间的异常信号：聚合后台 AI 任务失败/取消、投递失败分类、"
            "网申填充失败与本地后端日志（只取时间/级别/模块名/异常类名/HTTP 状态/路由模板/"
            "请求 id，**不返回日志原文、请求体或任何用户数据**），并按错误类型给出固定中文"
            "说明与建议动作。用户说「刚才那个操作为什么失败」「最近后端有什么错误」时用它；"
            "日志不可用时结果里会如实写「日志不可用」，不要据此编造原因。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "since_minutes": {
                    "type": "integer",
                    "description": "回看最近多少分钟，默认 60，范围 1–10080",
                },
                "scope": {
                    "type": "string",
                    "enum": ["all", "apply", "export", "assistant", "webform"],
                    "description": "限定业务范围，默认 all：apply 投递 / export 导出 / assistant 助手与模型调用 / webform 网申填表",
                },
                "limit": {
                    "type": "integer",
                    "description": "最多返回多少组聚合结果，默认 10，范围 1–50",
                },
            },
            "required": [],
        },
        handler=_tool_diagnose_recent_errors,
        service_entry=None,
        service_reason="只读聚合本机任务/投递/网申信号与日志白名单字段，无 services 收口（T31 只读诊断）",
        permission=ToolPermission.READ_ONLY,
    ),
)

__all__ = ["DIAGNOSIS_TOOLS"]

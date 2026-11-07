# SPDX-License-Identifier: Apache-2.0
"""简历质量工具声明（T29，4 条只读）：质量检测 / ATS 匹配 / 统一检查 / 版本对比。

四条都是 ``permission=ToolPermission.READ_ONLY``、``writes=False``、``preview=None``：
只读本地规则，不写库、不调远端模型。handler 在 ``quality_tools.py``。

注册位置：``_registry._TOOLS`` 末尾追加 ``QUALITY_TOOLS``（在 DOCUMENT 之后）；顺序
会进提示词，所以 ``test_assistant_tool_specs.EXPECTED_TOOL_ORDER`` 同步钉住。
"""

from __future__ import annotations

from ..actions.domains.quality import quality_action_pairs
from ..actions.tool_adapter import as_tool
from ._types import Tool, ToolPermission
from .quality_tools import (
    _tool_get_resume_preflight,
    _tool_run_resume_quality_check,
)

QUALITY_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="run_resume_quality_check",
        description=(
            "对一份简历做**本地规则**质量检测（查重 / 敏感词 / 夸大表述 / 面试深挖风险点 / "
            "合规保密五类），只提示不改正文，**不调用远端模型**。返回各类计数与前 5 条最需要"
            "处理的风险点。用户问「简历有没有问题」「帮我体检一下简历」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id（先用 list_resumes 查）"},
            },
            "required": ["resume_id"],
        },
        handler=_tool_run_resume_quality_check,
        service_entry="resume.resume_risk_rules.scan_local",
        permission=ToolPermission.READ_ONLY,
    ),
    as_tool(quality_action_pairs()["check_ats_match"]),
    Tool(
        name="get_resume_preflight",
        description=(
            "对一份简历跑**统一检查**（内容 / 排版 / 导出产物三层本地确定性规则，不调用模型、"
            "不改正文），返回按「必须解决 / 需核对 / 排版建议」分组的计数与前 5 条问题。用户问"
            "「这份简历能不能导出」「有没有排版问题」「导出会不会缺字」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id（先用 list_resumes 查）"},
            },
            "required": ["resume_id"],
        },
        handler=_tool_get_resume_preflight,
        service_entry="resume.preflight.run_preflight",
        permission=ToolPermission.READ_ONLY,
    ),
    as_tool(quality_action_pairs()["compare_resume_versions"]),
)

__all__ = ["QUALITY_TOOLS"]

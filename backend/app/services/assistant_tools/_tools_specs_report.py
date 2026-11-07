# SPDX-License-Identifier: Apache-2.0
"""报告域工具声明（``_TOOLS`` 中 21 条：面试/深挖/复盘/提醒/投递台/知识库/统计等）。"""
from __future__ import annotations

from ..actions.domains.analytics import analytics_actions
from ..actions.domains.apply import apply_actions
from ..actions.domains.drill import drill_actions
from ..actions.domains.interview import interview_actions
from ..actions.domains.interview_experiences import interview_experience_actions
from ..actions.domains.knowledge import knowledge_actions
from ..actions.domains.question_banks import question_bank_actions
from ..actions.domains.referrals import referral_actions
from ..actions.domains.reminders import reminder_actions
from ..actions.domains.resumes_write import resumes_write_actions
from ..actions.domains.reviews import review_actions
from ..actions.domains.share_packages import share_package_actions
from ..actions.pilots import pilot_actions
from ..actions.tool_adapter import as_tool
from . import previews
from ._types import Tool, ToolPermission
from .job_tools import _tool_update_resume
from .p3_tools import P3_TOOLS

REPORT_TOOLS: tuple[Tool, ...] = (
    # T28 收尾批：interview 域契约层 single source（旧实现委托）。
    as_tool(interview_actions()["list_interview_sessions"]),
    as_tool(interview_actions()["get_interview_report"]),
    # T28 收尾批：drill 域契约层 single source（旧实现委托）。
    as_tool(drill_actions()["list_drill_sessions"]),
    as_tool(drill_actions()["get_drill_report"]),
    # T28 收尾批：resumes_write 域契约层 single source（可逆写，带 preview）。
    as_tool(resumes_write_actions()["update_resume_layout"]),
    # T28 Batch B：reminders 域契约层 single source（参数/权限/描述/profile 由 ActionSpec 生成）。
    as_tool(reminder_actions()["list_reminders"]),
    # T28 收尾批：apply 域契约层 single source（旧实现委托）。
    as_tool(apply_actions()["list_apply_queue"]),
    # T28 Batch B：referrals 域契约层 single source。
    as_tool(referral_actions()["list_referrals"]),
    # T28 Batch B：interview_experiences 域契约层 single source。
    as_tool(interview_experience_actions()["list_interview_experiences"]),
    # T28 收尾批：question_banks 域契约层 single source。
    as_tool(question_bank_actions()["list_question_banks"]),
    # T28 收尾批：reviews 域契约层 single source。
    as_tool(review_actions()["list_reviews"]),
    # T28 Batch B：knowledge 域契约层 single source。
    as_tool(knowledge_actions()["list_knowledge"]),
    as_tool(knowledge_actions()["get_knowledge"]),
    as_tool(knowledge_actions()["create_knowledge"]),
    as_tool(knowledge_actions()["update_knowledge"]),
    # T28 收尾批：analytics 域契约层 single source。
    as_tool(analytics_actions()["get_analytics_overview"]),
    # T28 收尾批：share_packages 域契约层 single source。
    as_tool(share_package_actions()["list_share_packages"]),
    # T27 试点：契约层 single source —— 参数/权限/描述/预览/service_entry 都由 ActionSpec 生成。
    as_tool(pilot_actions()["create_reminder"]),
    # T28 收尾批：apply 域契约层 single source（list_apply_records）。
    as_tool(apply_actions()["list_apply_records"]),
    Tool(
        name="update_resume",
        description=(
            "更新某份简历的收藏状态或备注（只传要改的字段；简历正文与版式不受影响）。"
            "用户说「把这份简历收藏一下」「给这份简历加个备注」时用它。"
            "调整版式请用 update_resume_layout，两者互不替代。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "favorite": {"type": "boolean", "description": "可选，收藏（true）或取消收藏（false）"},
                "note": {"type": "string", "description": "可选，备注（列表悬停可见）"},
            },
            "required": ["resume_id"],
        },
        handler=_tool_update_resume,
        service_entry=None,
        service_reason="内联 ORM 写入，无 services 收口（T27 收口候选）",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=previews.preview_update_resume,
    ),
    as_tool(reminder_actions()["update_reminder"]),
    # P3 工具批（handlers 与声明同住 p3_tools.py，report spec 文件已到行数上限）。
    *P3_TOOLS,
)

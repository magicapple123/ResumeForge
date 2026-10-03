"""报告域工具声明（``_TOOLS`` 中 18 条：面试/深挖/复盘/提醒/投递台/知识库/统计等）。"""
from __future__ import annotations

from .apply_tools import _tool_list_apply_queue
from .data_tools import _tool_get_drill_report, _tool_list_drill_sessions
from .report_tools import (
    _tool_create_knowledge,
    _tool_create_reminder,
    _tool_get_analytics_overview,
    _tool_get_interview_report,
    _tool_get_knowledge,
    _tool_list_interview_experiences,
    _tool_list_interview_sessions,
    _tool_list_knowledge,
    _tool_list_question_banks,
    _tool_list_referrals,
    _tool_list_reminders,
    _tool_list_reviews,
    _tool_list_share_packages,
    _tool_update_knowledge,
    _tool_update_resume_layout,
)
from ..resume.resume_templates import FONT_SCALES, RESUME_TEMPLATES
from ._types import Tool

REPORT_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_interview_sessions",
        description=(
            "列出用户做过的模拟面试（类型、难度、轮数、状态与总分）。"
            "用户问「我之前的面试练得怎么样」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "可选，默认 20"},
                "status": {
                    "type": "string",
                    "enum": ["active", "finished"],
                    "description": "可选：active 进行中，finished 已结束",
                },
            },
            "required": [],
        },
        handler=_tool_list_interview_sessions,
    ),
    Tool(
        name="get_interview_report",
        description=(
            "读取某场模拟面试的问答记录与评分报告（用于复盘、总结薄弱点）。"
            "用户说「帮我看看上次面试哪里答得不好」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "session_id": {"type": "integer", "description": "面试 id（先用 list_interview_sessions 查）"}
            },
            "required": ["session_id"],
        },
        handler=_tool_get_interview_report,
    ),
    Tool(
        name="list_drill_sessions",
        description=(
            "列出按事实台账做的面试深挖记录（一条主张一道题、用证据状态判定讲不讲得清）。"
            "用户说「我练过的那些」「上次深挖练了什么」时用它。注意它与「模拟面试」不同："
            "模拟面试给四维度评分报告，深挖不给分数。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["active", "finished"],
                    "description": "可选：active 进行中，finished 已结束",
                },
                "limit": {"type": "integer", "description": "可选，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_drill_sessions,
    ),
    Tool(
        name="get_drill_report",
        description=(
            "读取某场面试深挖的逐题判定、行动清单与复练队列（用于复盘薄弱点）。"
            "用户的某条主张「讲不讲得清」「该补什么」都在这份记录里。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "session_id": {"type": "integer", "description": "深挖记录 id（先用 list_drill_sessions 查）"}
            },
            "required": ["session_id"],
        },
        handler=_tool_get_drill_report,
    ),
    Tool(
        name="update_resume_layout",
        description=(
            "调整某份简历的版式：模板（classic 经典 / modern 现代 / compact 精简）、"
            "最大页数（1-3）与字号（small 小 / standard 标准 / large 大）。"
            "用户抱怨「内容太多排不下」「字太小」或要求换模板时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "template": {"type": "string", "enum": list(RESUME_TEMPLATES)},
                "page_limit": {"type": "integer", "description": "最大页数 1-3"},
                "font_scale": {"type": "string", "enum": list(FONT_SCALES)},
            },
            "required": ["resume_id"],
        },
        handler=_tool_update_resume_layout,
        writes=True,
    ),
    Tool(
        name="list_reminders",
        description=(
            "列出日历提醒（面试、测评截止、催 HR 回复、其他），可按类型或状态筛选。"
            "用户问「我接下来要做什么」「我有几个提醒」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["interview", "assessment_deadline", "hr_reply", "other"],
                    "description": "可选，提醒类型",
                },
                "status": {
                    "type": "string",
                    "enum": ["pending", "done", "dismissed"],
                    "description": "可选，提醒状态（pending 待办）",
                },
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_reminders,
    ),
    Tool(
        name="list_apply_queue",
        description=(
            "查看「投递台」的队列状态：每个待投递/已投递/失败的岗位、对应简历、"
            "是否支持自动投递以及最近一次匹配结论。用户问「队列里还有什么」「那家公司投出去了吗」时用它。"
            "**助手不代为发起投递**——那一步必须由用户在投递台上点击确认。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_apply_queue,
    ),
    Tool(
        name="list_referrals",
        description=(
            "列出内推记录（公司/岗位/内推人/关系/状态/是否已转化）。"
            "用户问「我有几个内推」「内推进展怎么样」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["active", "submitted", "closed", "invalid"],
                    "description": "可选，内推状态",
                },
                "keyword": {"type": "string", "description": "可选，公司/岗位/内推人关键词"},
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_referrals,
    ),
    Tool(
        name="list_interview_experiences",
        description=(
            "列出真实面经（公司/岗位/来源/难度/被问问题数），可按关键词、公司或来源筛选。"
            "用户问「有没有 XX 公司的面经」「我记过哪些面经」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，标题/岗位/正文里的关键词"},
                "company": {"type": "string", "description": "可选，公司名"},
                "source": {
                    "type": "string",
                    "enum": ["self", "peer", "public"],
                    "description": "可选：self 自己 / peer 同行 / public 公开",
                },
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_interview_experiences,
    ),
    Tool(
        name="list_question_banks",
        description=(
            "列出保存过的题库历史（针对某岗位/简历生成并保存的题目分组）。"
            "用户问「我之前生成过哪些题库」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "可选，默认 20"}},
            "required": [],
        },
        handler=_tool_list_question_banks,
    ),
    Tool(
        name="list_reviews",
        description=(
            "列出保存过的面试复盘历史（真实被问问题清单 + 答题思路 + 反向优化建议）。"
            "用户问「我之前的复盘」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "可选，默认 20"}},
            "required": [],
        },
        handler=_tool_list_reviews,
    ),
    Tool(
        name="list_knowledge",
        description=(
            "列出知识库条目（面经总结/简历技巧/求职策略等成文内容），可按关键词或分类筛选。"
            "用户问「知识库里有什么」「有没有关于 XX 的笔记」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "q": {"type": "string", "description": "可选，标题/正文里的关键词"},
                "category": {"type": "string", "description": "可选，分类，如 面经/简历技巧/求职策略"},
                "limit": {"type": "integer", "description": "可选，最多返回多少条，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_knowledge,
    ),
    Tool(
        name="get_knowledge",
        description="按 id 读取知识库里某一条的完整正文（支持 Markdown）。",
        parameters={
            "type": "object",
            "properties": {"knowledge_id": {"type": "integer", "description": "知识库条目 id"}},
            "required": ["knowledge_id"],
        },
        handler=_tool_get_knowledge,
    ),
    Tool(
        name="create_knowledge",
        description=(
            "把一段成文内容新增进知识库（标题必填，正文支持 Markdown）。"
            "只在用户明确要求保存/记录时调用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "标题，必填"},
                "category": {"type": "string", "description": "分类，如 面经/简历技巧/求职策略/其他"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "标签，可选"},
                "content": {"type": "string", "description": "正文（Markdown），可选"},
                "source": {"type": "string", "description": "来源，默认「助手录入」"},
            },
            "required": ["title"],
        },
        handler=_tool_create_knowledge,
        writes=True,
    ),
    Tool(
        name="update_knowledge",
        description="修改知识库里已有的一条（只传要改的字段，其余保持不变）。",
        parameters={
            "type": "object",
            "properties": {
                "knowledge_id": {"type": "integer", "description": "知识库条目 id"},
                "title": {"type": "string"},
                "category": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "content": {"type": "string"},
                "source": {"type": "string"},
            },
            "required": ["knowledge_id"],
        },
        handler=_tool_update_knowledge,
        writes=True,
    ),
    Tool(
        name="get_analytics_overview",
        description=(
            "查看求职统计看板：投递总量、有效投递、面试率、Offer 数、六阶段漏斗与月度趋势。"
            "用户问「我投了多少」「我的求职数据怎么样」时用它。"
        ),
        parameters={"type": "object", "properties": {}, "required": []},
        handler=_tool_get_analytics_overview,
    ),
    Tool(
        name="list_share_packages",
        description=(
            "列出已生成的离线分享包（脱敏后的简历快照，含标题/权限/文件数/生成时间）。"
            "用户问「我发过哪些分享包」时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "可选，标题关键词"},
                "limit": {"type": "integer", "description": "可选，默认 20"},
            },
            "required": [],
        },
        handler=_tool_list_share_packages,
    ),
    Tool(
        name="create_reminder",
        description=(
            "新增一条日历提醒（面试、测评截止、催 HR 回复等）。"
            "只在用户明确要求「帮我记个提醒」时调用；remind_at 必填，ISO 格式。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "提醒内容，必填"},
                "remind_at": {
                    "type": "string",
                    "description": "提醒时间，ISO 格式，如 2026-09-20T10:00:00，必填",
                },
                "kind": {
                    "type": "string",
                    "enum": ["interview", "assessment_deadline", "hr_reply", "other"],
                    "description": "提醒类型，默认 other",
                },
                "job_id": {"type": "integer", "description": "可选，关联岗位 id"},
                "resume_id": {"type": "integer", "description": "可选，关联简历 id"},
                "track_id": {"type": "integer", "description": "可选，关联求职进度记录 id"},
                "note": {"type": "string", "description": "备注，可选"},
            },
            "required": ["title", "remind_at"],
        },
        handler=_tool_create_reminder,
        writes=True,
    ),
)

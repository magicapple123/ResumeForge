"""P3 工具批：匹配分析记录（只读）+ 面经 / 内推（写入）。

三个工具合住一份文件的先例与 ``reminder_tools.py`` 相同——report 域的 spec 文件已逼近
500 行上限，放不下就开新文件。工具声明（``P3_TOOLS``）与 handler 写在一起，由
``_tools_specs_report.py`` 用 ``*P3_TOOLS`` 追加到 report 段尾，注册顺序不变。

**产品红线（list_match_analyses）**：匹配度只有五类定性结论，界面上也从不显示百分比
评分（见 feature_catalog 的 job_match 条目）。批量分析快照（``JobMatchBatch.items``）
里虽存有 ``reference_score``（0-100 参考分）与按分数排序派生的 ``rank``，但工具返回里
**一律剔除**——匹配分数一旦进入对话上下文，模型就会被引诱着向用户报数字评分，那条
"匹配度 87 分"的口子不能从这里开。剔除是**两层**的：结构化字段（``reference_score``/
``rank``/``top_score``）整体不出现；``advice`` 这类 LLM 自由文本做**文本级剥离**——
「匹配度 87 分」「命中率 90%」这类数字评分表述从句子里删掉，其余建议内容原样保留。
"""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from ._shared import _trim, MAX_PROFILE_RESULT_CHARS
from ._types import Tool, ToolResult

DEFAULT_BATCH_LIMIT = 5
MAX_BATCH_LIMIT = 10

# advice 是 LLM 自由文本，可能夹带数字评分（"匹配度 87 分""命中率 90%"）——与结构化
# 分数同一条红线：透传前做文本级剥离，只删分数表述、建议内容本身不失真。
_SCORE_PHRASE_RE = re.compile(r"\d+(?:\.\d+)?\s*分|\d+(?:\.\d+)?\s*%")
# 剥离后留下的悬空白（"匹配度 ，建议"）收拢到标点前，避免句子破相。
_DANGLING_WHITESPACE_RE = re.compile(r"\s+([，。；、！？,;.!?])")

# ===== 定性结论的中文标签（原始枚举不直接给模型，避免它在回答里复读英文枚举）=====
_HARD_GATE_LABELS = {"met": "已满足", "unmet": "未满足", "unknown": "未明确"}
_ADMISSION_LABELS = {"allow": "可投递", "block": "不建议投递", "needs_confirm": "需确认"}
_MATCH_STATUS_LABELS = {
    "matched": "已匹配",
    "expression_gap": "表达缺口",
    "evidence_insufficient": "证据不足",
    "to_confirm": "待确认",
    "real_gap": "真实缺口",
}


def _condition_breakdown(item: dict) -> str:
    """把三类匹配条件的逐状态条数拼成一句话（条数不是分数，可安全输出）。"""
    counts: dict[str, int] = {}
    for section in ("hard_conditions", "core_abilities", "bonus_items"):
        for condition in item.get("result", {}).get(section) or []:
            key = str(condition.get("status", ""))
            if key in _MATCH_STATUS_LABELS:
                counts[key] = counts.get(key, 0) + 1
    if not counts:
        return ""
    return "、".join(f"{_MATCH_STATUS_LABELS[key]} {count}" for key, count in counts.items())


def _strip_score_phrases(text: str) -> str:
    """从自由文本里剥掉数字评分表述（"87 分""90%"），其余原样保留。"""
    cleaned = _SCORE_PHRASE_RE.sub("", str(text))
    cleaned = _DANGLING_WHITESPACE_RE.sub(r"\1", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _match_item_brief(item: dict) -> dict:
    """单岗位分析的定性摘要：只取结论字段，分数类字段在这里根本不出现。

    其余自由文本字段不剥离：岗位/公司是采集快照、失败原因是本地诊断串，都不承载
    匹配结论；只有 ``advice`` 是模型生成的匹配建议，才需要过一遍分数清洗。
    """
    brief: dict = {
        "岗位": item.get("job_title", ""),
        "公司": item.get("company", ""),
        "状态": item.get("status", ""),
    }
    result = item.get("result") or {}
    if item.get("status") == "completed" and result:
        brief["硬性门槛"] = _HARD_GATE_LABELS.get(result.get("hard_gate", ""), "未明确")
        brief["准入结论"] = _ADMISSION_LABELS.get(result.get("admission", ""), "需确认")
        advice = _strip_score_phrases(result.get("advice", ""))
        if advice:
            brief["建议"] = advice[:300]
        breakdown = _condition_breakdown(item)
        if breakdown:
            brief["匹配概况"] = breakdown
    if item.get("status") == "failed":
        brief["失败原因"] = item.get("error", "")
    return brief


def _tool_list_match_analyses(db: Session, arguments: dict) -> ToolResult:
    """历史批量岗位适配度分析（岗位广场 → 分析记录），只读、无分数。"""
    from ...models.job_match_batch import JobMatchBatch

    limit = min(int(arguments.get("limit") or DEFAULT_BATCH_LIMIT), MAX_BATCH_LIMIT)
    rows = (
        db.query(JobMatchBatch)
        .order_by(JobMatchBatch.created_at.desc(), JobMatchBatch.id.desc())
        .limit(limit)
        .all()
    )
    batches = []
    for row in rows:
        batches.append(
            {
                "批次": row.id,
                "时间": row.created_at.strftime("%Y-%m-%d %H:%M") if row.created_at else "",
                "岗位数": row.requested_count,
                "完成": row.completed_count,
                "失败": row.failed_count,
                "岗位分析": [_match_item_brief(item) for item in (row.items or [])],
            }
        )
    payload = {
        "总批次": len(batches),
        "分析记录": batches,
        "说明": (
            "这是「岗位广场 → 分析记录」的历史批量适配度分析。匹配度只有五类定性结论，"
            "没有分数或百分比——用户问「匹配度多少分」时如实说明这一点。"
        ),
    }
    return ToolResult(
        text=_trim(json.dumps(payload, ensure_ascii=False), MAX_PROFILE_RESULT_CHARS),
        summary=f"查看了 {len(batches)} 份匹配分析记录",
        link="/jobs",
    )


# ===== 写入：面经 / 内推 =====


def _tool_create_interview_experience(db: Session, arguments: dict) -> ToolResult:
    """把用户口述的一条真实面经落进面经知识库（复用 R-15 既有创建服务）。"""
    from ...schemas.interview_experience import InterviewExperienceCreate
    from ..interview.interview_experience_service import create_experience

    questions = [str(q) for q in (arguments.get("questions") or []) if str(q).strip()]
    try:
        payload = InterviewExperienceCreate.model_validate(
            {
                "title": str(arguments.get("title") or ""),
                "company": str(arguments.get("company") or ""),
                "position": str(arguments.get("position") or ""),
                "content": str(arguments.get("content") or ""),
                "questions": questions,
                "tags": arguments.get("tags") or [],
                "source": str(arguments.get("source") or "self"),
                "difficulty": str(arguments.get("difficulty") or ""),
                "round_type": str(arguments.get("round_type") or ""),
                "interview_date": str(arguments.get("interview_date") or ""),
                "job_id": arguments.get("job_id"),
            }
        )
    except ValueError as exc:
        raise ValueError(f"面经没记成：{exc}（至少要有标题、公司、正文或真实问题清单之一）") from None
    experience = create_experience(db, payload)
    return ToolResult(
        text=json.dumps(
            {"id": experience.id, "title": experience.title, "company": experience.company},
            ensure_ascii=False,
        ),
        summary=f"新增了面经「{experience.title or experience.company or experience.id}」",
        link="/interview",
        changed=True,
    )


def _tool_create_referral(db: Session, arguments: dict) -> ToolResult:
    """新增一条内推记录（复用 R-13 既有创建服务），状态缺省为进行中。"""
    from ...models.referral import REFERRAL_STATUS_ACTIVE
    from ...schemas.referral import ReferralCreate
    from ..referral_service import create_referral as create_referral_record

    if not str(arguments.get("company") or "").strip() and not str(
        arguments.get("referrer_name") or ""
    ).strip():
        raise ValueError("至少要提供公司或内推人之一，否则这条内推没法跟别人区分")
    position = str(arguments.get("position") or "")
    try:
        payload = ReferralCreate.model_validate(
            {
                "job_id": arguments.get("job_id"),
                "job_title": position,
                "company": str(arguments.get("company") or ""),
                "referrer_name": str(arguments.get("referrer_name") or ""),
                "referrer_contact": str(arguments.get("referrer_contact") or ""),
                "relation": str(arguments.get("relation") or ""),
                "position": position,
                "channel": str(arguments.get("channel") or ""),
                "status": str(arguments.get("status") or REFERRAL_STATUS_ACTIVE),
                "submitted_at": str(arguments.get("submitted_at") or ""),
                "note": str(arguments.get("note") or ""),
                "referral_code": arguments.get("referral_code"),
            }
        )
    except ValueError as exc:
        raise ValueError(f"内推没记成：{exc}") from None
    referral = create_referral_record(db, payload)
    return ToolResult(
        text=json.dumps(
            {
                "id": referral.id,
                "company": referral.company,
                "position": referral.position or referral.job_title,
                "referrer_name": referral.referrer_name,
                "status": referral.status,
            },
            ensure_ascii=False,
        ),
        summary=f"新增了内推记录（{referral.company or referral.referrer_name}）",
        link="/apply",
        changed=True,
    )


# ===== 工具声明（整段由 _tools_specs_report 用 *P3_TOOLS 追加到 report 段尾）=====

P3_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="list_match_analyses",
        description=(
            "查看历史批量岗位适配度分析记录（岗位/状态/硬性门槛/准入结论/建议要点）。"
            "用户问「之前的匹配分析怎么说」「分析记录里有什么」时用它。"
            "注意：匹配度只有五类定性结论，没有分数或百分比，回答里也不要编数字评分。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "可选，最多看多少个批次（每批含全部岗位），默认 5",
                },
            },
            "required": [],
        },
        handler=_tool_list_match_analyses,
    ),
    Tool(
        name="create_interview_experience",
        description=(
            "把一条真实面经记进面经知识库（公司/岗位/来源/被问到的真实问题/难度/轮次/日期）。"
            "用户说「记个面经」「把这次面试经历存下来」时调用；"
            "至少要有标题、公司、正文或问题清单之一，否则记不成。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "标题，可选"},
                "company": {"type": "string", "description": "公司名"},
                "position": {"type": "string", "description": "岗位名"},
                "content": {"type": "string", "description": "面经正文（过程、体验、怎么答的）"},
                "questions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "被问到的真实问题清单",
                },
                "tags": {"type": "array", "items": {"type": "string"}, "description": "标签，可选"},
                "source": {
                    "type": "string",
                    "enum": ["self", "peer", "public"],
                    "description": "来源：self 自己（默认）/ peer 同行 / public 公开",
                },
                "difficulty": {"type": "string", "description": "难度感受，如 简单/中等/困难"},
                "round_type": {"type": "string", "description": "轮次，如 一面/二面/HR面/笔试"},
                "interview_date": {
                    "type": "string",
                    "description": "面试日期，YYYY-MM-DD，未知留空",
                },
                "job_id": {"type": "integer", "description": "可选，关联岗位 id"},
            },
            "required": [],
        },
        handler=_tool_create_interview_experience,
        writes=True,
    ),
    Tool(
        name="create_referral",
        description=(
            "新增一条内推记录（公司/岗位/内推人/关系/渠道/状态）。"
            "用户说「记一条内推」「XX 帮我内推了」时调用，至少要给公司或内推人之一；"
            "状态默认进行中。内推码与备注图片等完整编辑请在「投递台」页做。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "company": {"type": "string", "description": "公司名"},
                "position": {"type": "string", "description": "内推岗位名"},
                "referrer_name": {"type": "string", "description": "内推人姓名"},
                "referrer_contact": {"type": "string", "description": "内推人联系方式"},
                "relation": {"type": "string", "description": "与内推人的关系，如 前同事/朋友"},
                "channel": {"type": "string", "description": "渠道，如 牛客/脉脉/熟人直推"},
                "status": {
                    "type": "string",
                    "enum": ["active", "submitted", "closed", "invalid"],
                    "description": "状态，默认 active（进行中）",
                },
                "referral_code": {"type": "string", "description": "内推码，可选"},
                "submitted_at": {
                    "type": "string",
                    "description": "内推提交日期，YYYY-MM-DD，未知留空",
                },
                "note": {"type": "string", "description": "备注"},
                "job_id": {"type": "integer", "description": "可选，关联岗位 id（自动回填公司/岗位快照）"},
            },
            "required": [],
        },
        handler=_tool_create_referral,
        writes=True,
    ),
)


__all__ = [
    "P3_TOOLS",
    "_tool_create_interview_experience",
    "_tool_create_referral",
    "_tool_list_match_analyses",
]

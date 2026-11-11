# SPDX-License-Identifier: Apache-2.0
"""#29B 知识回流：从已有业务数据生成知识条目（服务端取源，前端不拼正文）。

三个入口共用这一份实现（问题清单 #29B）：
- interview_report（面试复盘）：InterviewSession 的报告 Markdown + 问题清单；
- apply_failure（投递失败复盘）：ApplyTaskItem 的失败分类/诊断/三段码；
- resume_diagnosis（简历诊断）：服务端重跑本地规则风险扫描，把结论沉淀成经验。

两条硬约束：
1. **服务端取源**：请求只带 source + source_id，正文/标题/分类/关联公司都由服务端从
   业务表生成——前端拼正文早晚会和数据漂移，也无法保证脱敏与字段完整。
2. **重复点击不产生重复条目**：同 source + 同标题 + 正文完全一致时返回已有条目
   （created=False），由前端提示「已存在」；用户编辑过正文后再次沉淀视为新内容。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.apply import ApplyTaskItem
from ..models.claim import ClaimRecord
from ..models.interview import INTERVIEW_STATUS_FINISHED, InterviewSession
from ..models.knowledge_entry import KnowledgeEntry
from ..models.resume import ResumeRecord
from ..schemas.knowledge import (
    MAX_KNOWLEDGE_SUMMARY_CHARS,
    MAX_KNOWLEDGE_TITLE_CHARS,
    KnowledgeCreate,
    KnowledgeSource,
)
from . import trash
from .interview.interview import answered_rounds
from .interview.interview_report_markdown import _report_markdown
from .knowledge_service import create_knowledge
from .resume import document_io
from .resume.resume_risk import scan_resume_risks

SOURCE_INTERVIEW_REPORT: KnowledgeSource = "interview_report"
SOURCE_APPLY_FAILURE: KnowledgeSource = "apply_failure"
SOURCE_RESUME_DIAGNOSIS: KnowledgeSource = "resume_diagnosis"

#: 四类风险分类的中文展示名（只用于知识正文，不影响风险面板的语言包）。
_RISK_CATEGORY_LABELS = {
    "duplicate": "重复表述",
    "sensitive": "敏感信息",
    "exaggeration": "夸大表述",
    "deep_dive": "易被深挖",
    "compliance": "合规",
}
_SEVERITY_LABELS = {"high": "高", "medium": "中", "low": "低"}


class CaptureSourceError(Exception):
    """知识回流源不可用（业务态不满足）；路由层转成可读 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _clip(value: str, limit: int) -> str:
    text = " ".join((value or "").split())
    return text[:limit]


def _markdown_lines(*lines: str) -> str:
    return "\n".join(lines).rstrip() + "\n"


#: 旧版简历诊断正文里的分钟级时间行（现已不写）。查重时剥掉这一行：
#: 修复前沉淀的条目内容带时间，修复后再点一次不该因为这一行多出一条。
_DIAGNOSIS_TIME_LINE = "诊断时间："


def _content_for_dedupe(content: str) -> str:
    """查重口径：去掉旧版诊断时间行后的正文（其余逐字比较）。"""
    kept = [line for line in (content or "").splitlines() if _DIAGNOSIS_TIME_LINE not in line]
    return "\n".join(kept).strip()


# ===== 面试复盘 =====


def _interview_questions(session: InterviewSession) -> list[str]:
    return [
        " ".join((item.content or "").split())
        for item in session.messages
        if item.role == "interviewer" and (item.content or "").strip()
    ]


def _interview_payload(db: Session, session_id: int) -> KnowledgeCreate:
    session = db.get(InterviewSession, session_id)
    if session is None:
        raise CaptureSourceError(404, "面试记录不存在或已被删除")
    if session.status != INTERVIEW_STATUS_FINISHED:
        raise CaptureSourceError(409, "这场面试还没结束，先完成面试并生成报告再存进知识库")
    rounds = answered_rounds(session)
    questions = _interview_questions(session)
    report = session.report or {}
    body = _report_markdown(session)
    if questions:
        body += (
            "\n## 问题清单\n\n"
            + "\n".join(f"{index}. {question}" for index, question in enumerate(questions, start=1))
            + "\n"
        )
    label = session.company or "这次"
    title = (
        (session.company + " · " if session.company else "")
        + (session.job_title or session.title or "模拟面试")
        + " 面经复盘"
    )
    reason = _clip(
        f"{label}{session.interview_type} {rounds} 轮问答的复盘要点",
        120,
    )
    summary = _clip(
        str(report.get("summary") or ""),
        MAX_KNOWLEDGE_SUMMARY_CHARS,
    )
    key_points = [
        _clip(text, 200)
        for text in [*(report.get("strengths") or []), *(report.get("improvements") or [])][:8]
        if str(text).strip()
    ]
    return KnowledgeCreate(
        title=_clip(title, MAX_KNOWLEDGE_TITLE_CHARS),
        category="面经",
        tags=[tag for tag in (session.interview_type, session.difficulty) if tag],
        content=body,
        source="面试复盘",
        reason=reason,
        company=_clip(session.company or "", 128),
        job_id=session.job_id,
        summary=summary,
        key_points=key_points,
    )


# ===== 投递失败复盘 =====


def _apply_failure_payload(db: Session, item_id: int) -> KnowledgeCreate:
    item = db.get(ApplyTaskItem, item_id)
    if item is None or trash.is_deleted(item):
        raise CaptureSourceError(404, "投递记录不存在或已被删除")
    if item.status != "failed":
        raise CaptureSourceError(409, "只有失败的投递记录才能沉淀为经验")
    title = (
        (item.company + " · " if item.company else "")
        + (item.job_title or "岗位")
        + " 投递失败复盘"
    )
    content = _markdown_lines(
        f"# {title}",
        "",
        f"- 岗位：{item.job_title or '未知'}",
        f"- 公司：{item.company or '未知'}",
        "- 结果：投递失败",
        f"- 尝试次数：{item.attempt or 1}",
        f"- 失败分类：{item.failure_category or '未分类'}",
        f"- 失败环节：{item.failure_step or '-'}",
        f"- 失败控件：{item.failure_target or '-'}",
        f"- 失败原因：{item.failure_reason or '-'}",
        "",
        "## 诊断详情",
        "",
        (item.failure_detail or "（没有更多诊断信息）").strip(),
        "",
        "## 下一步",
        "",
        "把这次失败的环境/控件/操作记下来，下次投递前先对照检查。",
    )
    reason = _clip(
        f"{item.company or '这次'}·{item.job_title or '岗位'}投递失败："
        f"{item.failure_category or '未分类'}",
        120,
    )
    return KnowledgeCreate(
        title=_clip(title, MAX_KNOWLEDGE_TITLE_CHARS),
        category="求职策略",
        tags=["投递失败", item.failure_category] if item.failure_category else ["投递失败"],
        content=content,
        source="投递复盘",
        reason=reason,
        company=_clip(item.company or "", 128),
        job_id=item.job_id,
        summary=_clip(item.failure_detail or "", MAX_KNOWLEDGE_SUMMARY_CHARS),
        key_points=[_clip(item.failure_detail, 200)] if item.failure_detail else [],
    )


# ===== 简历诊断 =====


async def _resume_diagnosis_payload(db: Session, resume_id: int) -> KnowledgeCreate:
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record) or bool(record.draft):
        raise CaptureSourceError(404, "简历不存在或尚未保存")
    content = document_io.ensure_document_version(
        record.content or {},
        language=record.language,
        format_config=record.format_config,
    )
    claims = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
    # 只跑本地规则（provider=None）：沉淀不该顺带发一次模型请求，结论也是确定性的。
    scan = await scan_resume_risks(
        content,
        claims,
        provider=None,
        resume_id=resume_id,
        remote_available=False,
    )
    total = len(scan.points)
    high = sum(1 for point in scan.points if point.severity == "high")
    # 正文刻意**不写诊断时间**：它是分钟级快照且每次点击都会变，会让"同一次诊断"的
    # 逐字查重失效（跨分钟重复点击就多出一条）。时间由条目自身的 created_at 记录。
    lines = [
        f"# 简历诊断：{record.title or '未命名简历'}",
        "",
        f"- 命中风险点：{total} 个（高优先级 {high} 个）",
        "",
    ]
    if not total:
        lines.append("本次诊断没有命中风险点。")
    for point in scan.points:
        category = _RISK_CATEGORY_LABELS.get(point.category, point.category)
        severity = _SEVERITY_LABELS.get(point.severity, point.severity)
        lines.extend(
            [
                f"## [{severity}] {category} · {point.location or '全文'}",
                "",
                f"- 命中原文：{point.text[:200] or '（无）'}",
                f"- 建议：{point.suggestion or '（无）'}",
                "",
            ]
        )
    for note in scan.notes:
        lines.append(f"> {note}")
    title = f"简历诊断：{record.title or '未命名简历'}"
    reason = _clip(
        f"简历诊断结论：{total} 个风险点，其中 {high} 个高优先级",
        120,
    )
    return KnowledgeCreate(
        title=_clip(title, MAX_KNOWLEDGE_TITLE_CHARS),
        category="求职策略",
        tags=["简历诊断"] + (["高风险"] if high else []),
        content=_markdown_lines(*lines),
        source="简历诊断",
        reason=reason,
        company=_clip(record.company or "", 128),
        job_id=record.job_id,
        summary=_clip(f"命中 {total} 个风险点，高优先级 {high} 个", MAX_KNOWLEDGE_SUMMARY_CHARS),
        key_points=[
            _clip(
                f"{_SEVERITY_LABELS.get(point.severity, point.severity)}：{point.suggestion}", 200
            )
            for point in scan.points[:8]
            if point.suggestion
        ],
    )


async def create_from_source(
    db: Session, source: KnowledgeSource, source_id: int
) -> tuple[KnowledgeEntry, bool]:
    """从业务数据生成一条知识条目；返回 (entry, created)。

    重复点击（同 source + 同标题 + 同正文）返回已有条目并 created=False；
    用户编辑过正文后再沉淀会生成新条目（正文不再相同），避免把用户的编辑吞掉。
    """
    if source == SOURCE_INTERVIEW_REPORT:
        payload = _interview_payload(db, source_id)
    elif source == SOURCE_APPLY_FAILURE:
        payload = _apply_failure_payload(db, source_id)
    elif source == SOURCE_RESUME_DIAGNOSIS:
        payload = await _resume_diagnosis_payload(db, source_id)
    else:  # pragma: no cover - schema Literal 已挡住未知 source
        raise CaptureSourceError(422, "不支持的知识回流来源")
    existing = (
        db.query(KnowledgeEntry)
        .filter(
            trash.live_only(KnowledgeEntry),
            KnowledgeEntry.source == payload.source,
            KnowledgeEntry.title == payload.title,
        )
        .order_by(KnowledgeEntry.id.desc())
        .first()
    )
    if existing is not None and _content_for_dedupe(existing.content or "") == _content_for_dedupe(
        payload.content
    ):
        return existing, False
    return create_knowledge(db, payload), True


__all__ = [
    "SOURCE_APPLY_FAILURE",
    "SOURCE_INTERVIEW_REPORT",
    "SOURCE_RESUME_DIAGNOSIS",
    "CaptureSourceError",
    "create_from_source",
]

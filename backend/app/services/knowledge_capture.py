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

from dataclasses import dataclass

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
from ..schemas.resume_risk import RiskScanOut
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


@dataclass(frozen=True)
class DiagnosisMaterial:
    """简历诊断的准备段产物：读库读出来的纯数据（会话随后即归还）。

    ``claims`` 与 ``content`` 是本地规则扫描（:func:`scan_resume_risks`）的全部输入，
    它们都是已加载的普通值/已物化的行，扫描本身不再碰会话。
    """

    resume_id: int
    title: str
    company: str
    job_id: int | None
    content: dict
    claims: list[ClaimRecord]


@dataclass(frozen=True)
class CapturePlan:
    """知识回流的准备段产物：``payload`` 已就绪，或 ``diagnosis`` 等规则扫描补完。"""

    payload: KnowledgeCreate | None = None
    diagnosis: DiagnosisMaterial | None = None


@dataclass(frozen=True)
class CaptureOutcome:
    """落库段的产物：只带响应需要的字段，不回传 ORM 实例。"""

    knowledge_id: int
    title: str
    category: str
    source: str
    created: bool


def _resume_diagnosis_material(db: Session, resume_id: int) -> DiagnosisMaterial:
    """同步读库段：简历记录 + 事实台账（扫描要用的两份输入）。"""
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record) or bool(record.draft):
        raise CaptureSourceError(404, "简历不存在或尚未保存")
    content = document_io.ensure_document_version(
        record.content or {},
        language=record.language,
        format_config=record.format_config,
    )
    claims = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
    return DiagnosisMaterial(
        resume_id=resume_id,
        title=record.title or "未命名简历",
        company=record.company or "",
        job_id=record.job_id,
        content=content,
        claims=list(claims),
    )


def _diagnosis_payload(material: DiagnosisMaterial, scan: RiskScanOut) -> KnowledgeCreate:
    """把本地规则扫描结果拼成知识条目正文（纯函数，不读库）。"""
    points = list(scan.points)
    total = len(points)
    high = sum(1 for point in points if point.severity == "high")
    # 正文刻意**不写诊断时间**：它是分钟级快照且每次点击都会变，会让"同一次诊断"的
    # 逐字查重失效（跨分钟重复点击就多出一条）。时间由条目自身的 created_at 记录。
    lines = [
        f"# 简历诊断：{material.title}",
        "",
        f"- 命中风险点：{total} 个（高优先级 {high} 个）",
        "",
    ]
    if not total:
        lines.append("本次诊断没有命中风险点。")
    for point in points:
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
    title = f"简历诊断：{material.title}"
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
        company=_clip(material.company, 128),
        job_id=material.job_id,
        summary=_clip(f"命中 {total} 个风险点，高优先级 {high} 个", MAX_KNOWLEDGE_SUMMARY_CHARS),
        key_points=[
            _clip(
                f"{_SEVERITY_LABELS.get(point.severity, point.severity)}：{point.suggestion}",
                200,
            )
            for point in points[:8]
            if point.suggestion
        ],
    )


def prepare_capture(db: Session, source: KnowledgeSource, source_id: int) -> CapturePlan:
    """同步准备段：把源业务数据读成纯数据，然后归还请求连接。

    面试复盘 / 投递失败两条来源在读完就拿到了完整 payload；简历诊断要再跑一遍
    **本地规则**扫描（零模型调用、零 IO），所以只带回扫描输入。
    """
    try:
        if source == SOURCE_INTERVIEW_REPORT:
            return CapturePlan(payload=_interview_payload(db, source_id))
        if source == SOURCE_APPLY_FAILURE:
            return CapturePlan(payload=_apply_failure_payload(db, source_id))
        if source == SOURCE_RESUME_DIAGNOSIS:
            return CapturePlan(diagnosis=_resume_diagnosis_material(db, source_id))
    finally:
        db.close()
    # pragma: no cover - schema Literal 已挡住未知 source
    raise CaptureSourceError(422, "不支持的知识回流来源")


async def capture_payload(plan: CapturePlan) -> KnowledgeCreate:
    """中间段：把计划补成完整 payload（只有简历诊断需要一次本地规则扫描）。"""
    if plan.payload is not None:
        return plan.payload
    material = plan.diagnosis
    if material is None:  # pragma: no cover - 类型收窄兜底
        raise CaptureSourceError(422, "不支持的知识回流来源")
    # 只跑本地规则（provider=None）：沉淀不该顺带发一次模型请求，结论也是确定性的。
    scan = await scan_resume_risks(
        material.content,
        material.claims,
        provider=None,
        resume_id=material.resume_id,
        remote_available=False,
    )
    return _diagnosis_payload(material, scan)


def persist_capture(db: Session, payload: KnowledgeCreate) -> CaptureOutcome:
    """同步落库段：同内容条目复用，否则新建（重复点击不产生重复条目）。"""
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
        return CaptureOutcome(
            knowledge_id=int(existing.id),
            title=existing.title,
            category=existing.category,
            source=existing.source,
            created=False,
        )
    entry = create_knowledge(db, payload)
    return CaptureOutcome(
        knowledge_id=int(entry.id),
        title=entry.title,
        category=entry.category,
        source=entry.source,
        created=True,
    )


async def create_from_source(
    db: Session, source: KnowledgeSource, source_id: int
) -> CaptureOutcome:
    """从业务数据生成一条知识条目（带请求会话的完整编排）。

    HTTP 路由不走这里（它显式拆成三段，否则判据看不出同步段有没有搬出去）；
    保留它是为了让"取源 → 扫描 → 落库"这条链路有一个可离线调用的完整入口。
    """
    plan = prepare_capture(db, source, source_id)
    payload = await capture_payload(plan)
    return persist_capture(db, payload)


__all__ = [
    "SOURCE_APPLY_FAILURE",
    "SOURCE_INTERVIEW_REPORT",
    "SOURCE_RESUME_DIAGNOSIS",
    "CaptureOutcome",
    "CapturePlan",
    "CaptureSourceError",
    "DiagnosisMaterial",
    "capture_payload",
    "create_from_source",
    "persist_capture",
    "prepare_capture",
]

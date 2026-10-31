# SPDX-License-Identifier: Apache-2.0
"""简历风险扫描的本地确定性规则（从 :mod:`app.services.resume.resume_risk` 纯搬迁拆出）。

**只提示、绝不改写**：这里的每条规则都是「读 + 报告」，不回写 ``ResumeContent``。
覆盖查重（含预算三重上限）、敏感词、夸大、深挖风险点（正文强主张 + 台账联动）与
合规（NDA）五类；入口是 :func:`scan_local`。

敏感模式名单集中在 ``services/privacy.py``（与 R-17 隐私脱敏共用一份）；出站最小化
脱敏与远端响应规范化在 ``resume_risk_outbound.py``，编排入口留在 ``resume_risk.py``。
"""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher

from ...models.claim import (
    STRONG_RESPONSIBILITY_LEVELS,
    VERIFICATION_REJECTED,
    ClaimRecord,
)
from ...schemas.resume import ResumeContent
from ...schemas.resume_risk import RiskPoint
from ..privacy import (
    COMPLIANCE_KEYWORDS,
    SENSITIVE_KEYWORDS,
    SENSITIVE_PATTERNS,
)

# ===== 本地查重预算：长简历不放大成无界 O(n²)，超限截断并在 notes 里注明 =====
SIMILAR_RATIO = 0.92
# 相似比较的候选条数上限（唯一规范化文本）。
MAX_SIMILARITY_CANDIDATES = 200
# 相似比较的比较次数上限（防御性第二道闸，正常被候选上限挡在更前面）。
MAX_PAIR_COMPARISONS = 20_000
# 查重告警条数上限。
MAX_DUPLICATE_RISKS = 50

# 绝对化 / 夸大的高置信度表述。宁可漏检也不扩大名单（误判只会徒增噪音）。
EXAGGERATION_PHRASES: tuple[str, ...] = (
    "精通",
    "专家",
    "顶尖",
    "顶级",
    "绝顶",
    "全球第一",
    "行业第一",
    "业内第一",
    "全国第一",
    "世界一流",
    "无人能及",
    "无可匹敌",
    "完美",
    "百分之百",
    "100%",
    "零缺陷",
    "从零到一",
)

# 面试时大概率被追问的强主张措辞（本地规则部分；台账联动在 _deep_dive_risks 里单独处理）。
STRONG_CLAIM_PHRASES: tuple[str, ...] = (
    "主导",
    "全面负责",
    "独立完成",
    "独立负责",
    "牵头",
    "从0到1",
    "从零到一",
    "全权负责",
    "统筹",
    "一人负责",
)

# ≥100% 的量化表述：可能成立，但面试被追问时必须能拿出依据，所以提示核对。
_HIGH_PERCENT_RE = re.compile(r"\d{3,}%")

_SECTIONS = ("education", "experience", "campus_experience", "projects")
_FIELDS = ("achievements", "description", "highlights")
_SECTION_LABELS = {
    "education": "教育经历",
    "experience": "实习/工作",
    "campus_experience": "校园经历",
    "projects": "项目经历",
}


def _section_title(item: object, section: str) -> str:
    """取某个区块条目的可读标题：学校 / 公司 / 组织 / 项目名。"""
    key = {
        "education": "school",
        "experience": "company",
        "campus_experience": "organization",
        "projects": "name",
    }.get(section, "")
    value = getattr(item, key, "") if key else ""
    return str(value or "未命名").strip()


def _descriptive_points(resume: ResumeContent | dict) -> list[tuple[str, str]]:
    """收集会被写进简历的描述性文本，返回 (位置, 文本) 列表，顺序稳定。"""
    if isinstance(resume, dict):
        from .document_analysis import body_points

        return body_points(resume)
    points: list[tuple[str, str]] = []
    if resume.summary and resume.summary.strip():
        points.append(("个人总结", resume.summary.strip()))
    for section in _SECTIONS:
        label = _SECTION_LABELS[section]
        for item in getattr(resume, section, []) or []:
            title = _section_title(item, section)
            for field in _FIELDS:
                for value in getattr(item, field, None) or []:
                    text = str(value).strip()
                    if text:
                        points.append((f"{label}「{title}」", text))
    return points


def _resume_full_text(resume: ResumeContent | dict) -> str:
    """把简历序列化成可全文检索的文本；排除 photo（base64 会制造假命中）。

    **只限本地使用**（敏感词/夸大/合规扫描与台账关联匹配都要完整文本）；
    远端增强的出站输入一律走 :func:`resume_risk_outbound._outbound_resume_text`
    的最小化脱敏口径。
    """
    if isinstance(resume, dict):
        from .document_view import document_text

        return document_text(resume)
    return json.dumps(resume.model_dump(exclude={"photo"}), ensure_ascii=False)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _duplicate_risks(resume: ResumeContent | dict, notes: list[str] | None = None) -> list[RiskPoint]:
    """查重：完全相同的要点只报一次；相似比较只在精确去重后的唯一文本间做。

    预算三重上限（超限截断并写入 ``notes`` 注明）：候选条数、比较次数、告警条数。
    这样长简历不会把本地扫描放大成无界 O(n²)（它运行在 async 路由里）。
    """

    def _note(message: str) -> None:
        if notes is not None:
            notes.append(message)

    points = _descriptive_points(resume)
    risks: list[RiskPoint] = []

    # ① 规范化文本精确去重：完全相同的文本只报一次。
    seen: dict[str, list[tuple[str, str]]] = {}
    for location, text in points:
        key = _normalize(text)
        if len(key) < 4:
            continue
        seen.setdefault(key, []).append((location, text))
    exact_keys = {key for key, hits in seen.items() if len(hits) > 1}
    for key, hits in seen.items():
        if key not in exact_keys:
            continue
        risks.append(
            RiskPoint(
                category="duplicate",
                severity="low",
                text=hits[0][1],
                location="、".join(location for location, _ in hits),
                suggestion="同一要点重复出现，建议合并或只保留一处，避免浪费篇幅",
            )
        )

    # ② 相似比较候选：排除精确重复成员（它们已报过，不再进相似告警），文本按
    #    规范化键天然唯一；候选条数超上限先截断。
    candidates: list[tuple[str, str, str]] = []
    for location, text in points:
        key = _normalize(text)
        if len(key) < 6 or key in exact_keys:
            continue
        candidates.append((location, text, key))
    if len(candidates) > MAX_SIMILARITY_CANDIDATES:
        candidates = candidates[:MAX_SIMILARITY_CANDIDATES]
        _note(f"要点过多，相似查重仅比较前 {MAX_SIMILARITY_CANDIDATES} 条唯一要点")

    comparisons = 0
    budget_exceeded = False
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            comparisons += 1
            if comparisons > MAX_PAIR_COMPARISONS:
                budget_exceeded = True
                break
            left = candidates[i][2]
            right = candidates[j][2]
            lo, hi = sorted((len(left), len(right)))
            # 廉价预过滤：ratio ≤ 2*min/(l+r)，比例差太大不可能达标，
            # 直接跳过昂贵的 SequenceMatcher。
            if hi == 0 or 2 * lo / (lo + hi) < SIMILAR_RATIO:
                continue
            if SequenceMatcher(None, left, right).ratio() < SIMILAR_RATIO:
                continue
            risks.append(
                RiskPoint(
                    category="duplicate",
                    severity="low",
                    text=candidates[i][1],
                    location=f"{candidates[i][0]} 与 {candidates[j][0]}",
                    suggestion="两条要点高度相似，建议合并后只保留信息量更大的一条",
                )
            )
        if budget_exceeded:
            break
    if budget_exceeded:
        _note("要点过多，相似查重的比较次数达到预算上限，已提前截断")
    if len(risks) > MAX_DUPLICATE_RISKS:
        risks = risks[:MAX_DUPLICATE_RISKS]
        _note(f"查重告警条数达到 {MAX_DUPLICATE_RISKS} 条上限，已截断")
    return risks


def _sensitive_risks(resume: ResumeContent | dict) -> list[RiskPoint]:
    """敏感词：数字规律类（身份证/银行卡/出生日期）与关键词类（住址/薪资等）。"""
    text = _resume_full_text(resume)
    risks: list[RiskPoint] = []
    seen_snippets: set[str] = set()
    for label, pattern in SENSITIVE_PATTERNS:
        for match in re.compile(pattern).finditer(text):
            snippet = match.group(0)
            # 身份证号同时满足银行卡号的数字规律，按片段去重只报一次。
            if snippet in seen_snippets:
                continue
            seen_snippets.add(snippet)
            risks.append(
                RiskPoint(
                    category="sensitive",
                    severity="high",
                    text=snippet,
                    location=label,
                    suggestion=f"简历中出现疑似{label}「{snippet}」，属于敏感信息，建议删除",
                )
            )
    for label, keyword in SENSITIVE_KEYWORDS:
        if keyword in text:
            risks.append(
                RiskPoint(
                    category="sensitive",
                    severity="medium",
                    text=keyword,
                    location=label,
                    suggestion=f"简历中出现「{label}」，属于敏感信息，建议删除或避免外发",
                )
            )
    return risks


def _exaggeration_risks(resume: ResumeContent | dict) -> list[RiskPoint]:
    """夸大：绝对化表述与 ≥100% 的量化。"""
    text = _resume_full_text(resume)
    risks: list[RiskPoint] = []
    for phrase in EXAGGERATION_PHRASES:
        if phrase in text:
            risks.append(
                RiskPoint(
                    category="exaggeration",
                    severity="medium",
                    text=phrase,
                    location="正文",
                    suggestion=f"「{phrase}」属于绝对化表述，建议改为可核验的具体说法",
                )
            )
    for match in _HIGH_PERCENT_RE.finditer(text):
        risks.append(
            RiskPoint(
                category="exaggeration",
                severity="low",
                text=match.group(0),
                location="正文",
                suggestion="出现了 ≥100% 的量化，请确认有据可查，避免被追问时说不清",
            )
        )
    return risks


def _claim_follow_up(claim: ClaimRecord) -> list[str]:
    """把台账里的边界 / 风险备注 / 面试细节整理成「会被追问什么」清单。"""
    items: list[str] = []
    if claim.boundary:
        items.append(f"个人边界：{claim.boundary}")
    for note in claim.risk_notes or []:
        items.append(f"风险备注：{note}")
    details = claim.interview_details or {}
    for key, label in (
        ("decisions", "关键决策"),
        ("difficulties", "难点"),
        ("verification", "如何验证"),
    ):
        for entry in details.get(key) or []:
            items.append(f"{label}：{entry}")
    result = details.get("result")
    if result:
        items.append(f"结果：{result}")
    return items


def _deep_dive_risks(resume: ResumeContent | dict, claims: list[ClaimRecord]) -> list[RiskPoint]:
    """深挖风险点：正文强主张措辞 + 事实台账 LED/OWNER 强主张联动（只读不写）。"""
    risks: list[RiskPoint] = []
    for location, text in _descriptive_points(resume):
        for phrase in STRONG_CLAIM_PHRASES:
            if phrase in text:
                risks.append(
                    RiskPoint(
                        category="deep_dive",
                        severity="medium",
                        text=text,
                        location=location,
                        suggestion=(
                            f"「{phrase}」是强主张，面试时大概率会被追问，请准备个人边界与量化依据"
                        ),
                        follow_up=[f"请能说清：这条「{phrase}」里你本人做了什么、团队做了什么"],
                    )
                )
                break

    for claim in claims:
        if claim.responsibility_level not in STRONG_RESPONSIBILITY_LEVELS:
            continue
        if claim.verification_status == VERIFICATION_REJECTED:
            continue
        risks.append(
            RiskPoint(
                category="deep_dive",
                severity="high" if not claim.boundary else "medium",
                text=claim.candidate_wording or claim.source_fact or claim.title,
                location=f"事实台账「{claim.title or claim.subject or '未命名'}」",
                suggestion="这条强主张会被追问，建议按个人边界与面试细节准备好答案",
                claim_id=claim.id,
                follow_up=_claim_follow_up(claim),
            )
        )
    return risks


def _compliance_risks(resume: ResumeContent | dict) -> list[RiskPoint]:
    """合规：保密 / 未公开 / 涉密等 NDA 相关表述。"""
    text = _resume_full_text(resume)
    risks: list[RiskPoint] = []
    for keyword in COMPLIANCE_KEYWORDS:
        if keyword in text:
            risks.append(
                RiskPoint(
                    category="compliance",
                    severity="high",
                    text=keyword,
                    location="正文",
                    suggestion=(
                        f"出现「{keyword}」，可能涉及保密 / 未公开信息，投递前请确认是否可对外披露"
                    ),
                )
            )
    return risks


def scan_local(
    resume: ResumeContent | dict,
    claims: list[ClaimRecord],
    *,
    notes: list[str] | None = None,
) -> list[RiskPoint]:
    """本地确定性规则：不依赖模型，始终返回完整风险点列表。

    ``notes`` 可选传入收集列表，用于带回查重预算截断等提示（调用方不关心时为 None，
    截断静默发生）。
    """
    points: list[RiskPoint] = []
    points.extend(_duplicate_risks(resume, notes))
    points.extend(_sensitive_risks(resume))
    points.extend(_exaggeration_risks(resume))
    points.extend(_deep_dive_risks(resume, claims))
    points.extend(_compliance_risks(resume))
    return points

# SPDX-License-Identifier: Apache-2.0
"""统一检查的**内容层**规则（W11 / P0-04）：待补标记、ATS 本地规则、可选风险扫描。

**只编排，不重写判据**：`find_incomplete` / `check_ats` / `scan_local` 都是既有实现，
本模块只把它们的结果映射进统一问题模型（严重度映射表见 wave2 契约 §4.2）。

三条口径：
1. 待补标记 = **blocker**：导出闸门本来就会 409（`export_routes._export_record`），
   检查面板必须与出口同口径，否则用户会看到"检查通过但导不出来"。
2. ATS 是本地启发式，**不代表真实 ATS**：high → verify，medium/low → suggestion。
3. 事实风险本地规则只在 `include_risk=True` 时跑（用户显式加层）；没配置模型不会
   让这一层变成"通过"——响应另由 `model_not_configured` 说明（见 orchestrator）。
"""

from __future__ import annotations

from ...models.claim import ClaimRecord
from ...schemas.preflight import CheckFix, CheckIssue, CheckLocator
from ...schemas.resume import ResumeContent
from ..ats_check import check_ats
from .resume_completeness import find_incomplete
from .resume_risk_rules import scan_local
from .resume_visibility import is_hidden_entry

# 中文说明（find_incomplete 的 message）→ 板块键：只做前缀映射，匹配不到就按 document。
_SECTION_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("个人总结", "summary"),
    ("求职意向", "job_intent"),
    ("教育经历", "education"),
    ("实习/工作经历", "experience"),
    ("校园经历", "campus_experience"),
    ("项目经历", "projects"),
    ("专业技能", "skills"),
    ("荣誉奖项", "awards"),
)


def _section_for(message: str) -> str | None:
    for prefix, key in _SECTION_BY_PREFIX:
        if message.startswith(prefix):
            return key
    return None


def _incomplete_issues(content: ResumeContent) -> list[CheckIssue]:
    issues: list[CheckIssue] = []
    for message in find_incomplete(content):
        section = _section_for(message)
        issues.append(
            CheckIssue(
                id="",
                layer="content",
                severity="blocker",
                code="incomplete_marker",
                title_key="preflight.issue.incomplete_marker",
                detail=message,
                impact="导出会被拦下；即使强行导出，占位符也会出现在纸面上",
                locator=CheckLocator(scope="section" if section else "document", section=section),
                fix=CheckFix(
                    action="focus_field",
                    payload={"section": section or ""},
                    label_key="preflight.fix.incomplete_marker",
                ),
            )
        )
    return issues


# ATS 严重度 → 统一严重度。
_ATS_SEVERITY = {"high": "verify", "medium": "suggestion", "low": "suggestion"}

_ATS_TITLE_KEY = {
    "format": "preflight.issue.ats_format",
    "keyword": "preflight.issue.ats_keyword",
    "position": "preflight.issue.ats_position",
}


def _ats_issues(content: ResumeContent, jd_text: str) -> list[CheckIssue]:
    if not jd_text.strip():
        return []
    report = check_ats(content, jd_text)
    issues: list[CheckIssue] = []
    for issue in report.issues[:30]:
        issues.append(
            CheckIssue(
                id="",
                layer="content",
                severity=_ATS_SEVERITY.get(issue.severity, "suggestion"),
                code=f"ats_{issue.category}",
                title_key=_ATS_TITLE_KEY.get(issue.category, "preflight.issue.ats_format"),
                detail=issue.detail or issue.title,
                impact="本地规则估计，不代表真实 ATS 解析结果",
                locator=CheckLocator(scope="document"),
                fix=CheckFix(
                    action="open_preflight", payload={"ats": True}, label_key="preflight.fix.ats"
                ),
                evidence=issue.evidence[:20],
            )
        )
    return issues


# 本地风险规则严重度（RiskPoint.severity 是 high/medium/low）→ 统一严重度。
_RISK_SEVERITY = {"high": "verify", "medium": "suggestion", "low": "suggestion"}


def _risk_issues(content: ResumeContent, claims: list[ClaimRecord]) -> list[CheckIssue]:
    points = scan_local(content, claims)
    issues: list[CheckIssue] = []
    for point in points[:30]:
        issues.append(
            CheckIssue(
                id="",
                layer="content",
                severity=_RISK_SEVERITY.get(point.severity, "suggestion"),
                code=f"risk_{point.category}",
                title_key="preflight.issue.risk",
                detail="；".join(part for part in (point.text, point.suggestion) if part)[:2000],
                impact="需要人工核对；本地规则不改写正文",
                locator=CheckLocator(scope="section"),
                fix=CheckFix(
                    action="open_preflight", payload={"risk": True}, label_key="preflight.fix.risk"
                ),
                evidence=[point.location][:20] if point.location else [],
            )
        )
    return issues


def content_issues(
    content: ResumeContent,
    *,
    jd_text: str = "",
    claims: list[ClaimRecord] | None = None,
    include_risk: bool = False,
) -> list[CheckIssue]:
    """内容层全部问题（顺序：blocker 类在前，便于前端默认展开）。"""
    # 隐藏条目（W06）不进入检查：它们不会出现在任何正式产物里，为它们报待补/风险
    # 等于让用户为一个明确隐藏掉的段子白改一次。
    visible = content.model_copy(
        update={
            "education": [item for item in content.education if not is_hidden_entry(item)],
            "experience": [item for item in content.experience if not is_hidden_entry(item)],
            "campus_experience": [
                item for item in content.campus_experience if not is_hidden_entry(item)
            ],
            "projects": [item for item in content.projects if not is_hidden_entry(item)],
            "skills": [item for item in content.skills if not is_hidden_entry(item)],
            "awards": [item for item in content.awards if not is_hidden_entry(item)],
        }
    )
    issues = _incomplete_issues(visible)
    issues.extend(_ats_issues(visible, jd_text))
    if include_risk:
        issues.extend(_risk_issues(visible, claims or []))
    return issues


__all__ = ["content_issues"]

# SPDX-License-Identifier: Apache-2.0
"""统一检查的**排版层**规则（W11 / P0-04、D08）：版面诊断映射 + 缺字/粗体可用性。

诊断本身不在这里重写——`diagnose()` 与 `font_coverage` 是各自唯一实现，本模块只做
"结论 → 统一问题模型"的映射（严重度映射见 wave2 契约 §4.2）：

* 溢出 = **blocker**（PDF 会按上限截断，尾部内容不会出现在下载文件里）；
* dense / sparse / too_sparse / 建议 = **suggestion**（审美类，plan 明确不得当硬失败）；
* 缺字 = **blocker**（纸面上真的少字）；粗体不可用 = **verify**（回退字形，不算错）。
"""

from __future__ import annotations

from ...schemas.preflight import CheckFix, CheckIssue, CheckLocator
from ...schemas.resume import ResumeContent
from .font_coverage import coverage
from .product_text import expected_lines
from .resume_layout import (
    STATUS_DENSE,
    STATUS_OVERFLOW,
    STATUS_SPARSE,
    STATUS_TOO_SPARSE,
    Diagnosis,
    diagnose,
)

# 诊断状态 → (code, 是否 blocker)。未知状态不在这里（单独 verify 说明）。
_STATUS_CODE: dict[str, tuple[str, bool]] = {
    STATUS_OVERFLOW: ("layout_overflow", True),
    STATUS_DENSE: ("layout_dense", False),
    STATUS_SPARSE: ("layout_sparse", False),
    STATUS_TOO_SPARSE: ("layout_too_sparse", False),
}

_SEVERITY_TITLE = {
    "layout_overflow": "preflight.issue.layout_overflow",
    "layout_dense": "preflight.issue.layout_dense",
    "layout_sparse": "preflight.issue.layout_sparse",
    "layout_too_sparse": "preflight.issue.layout_too_sparse",
}


def _diagnosis_issues(diagnosis: Diagnosis) -> list[CheckIssue]:
    issues: list[CheckIssue] = []
    mapped = _STATUS_CODE.get(diagnosis.status)
    if mapped is not None:
        code, is_blocker = mapped
        issues.append(
            CheckIssue(
                id="",
                layer="layout",
                severity="blocker" if is_blocker else "suggestion",
                code=code,
                title_key=_SEVERITY_TITLE[code],
                detail=diagnosis.summary,
                impact=(
                    "PDF 会按页数上限截断，超出部分不会出现在下载文件里"
                    if is_blocker
                    else "不影响内容完整性；是否调整由你决定"
                ),
                locator=CheckLocator(scope="document"),
                fix=CheckFix(
                    action="open_layout_analyze",
                    payload={"pages_needed": diagnosis.pages_needed},
                    label_key="preflight.fix.layout",
                ),
            )
        )
    # 诊断给出的具体建议（收紧行距/边距等）逐条附加，保留原始措辞。
    for suggestion in diagnosis.suggestions[:5]:
        issues.append(
            CheckIssue(
                id="",
                layer="layout",
                severity="suggestion",
                code="layout_suggestion",
                title_key="preflight.issue.layout_suggestion",
                detail=f"{suggestion.title}：{suggestion.detail}",
                impact="只影响版面观感，不是内容错误",
                locator=CheckLocator(scope="document"),
                fix=CheckFix(
                    action="open_layout_analyze",
                    payload={"kind": suggestion.kind},
                    label_key="preflight.fix.layout",
                ),
            )
        )
    return issues


def _font_issues(font_coverage: dict) -> list[CheckIssue]:
    if not font_coverage.get("checked"):
        return []
    issues: list[CheckIssue] = []
    missing = font_coverage.get("missing") or {}
    for role, chars in missing.items():
        if not chars:
            continue
        issues.append(
            CheckIssue(
                id="",
                layer="layout",
                severity="blocker",
                code="font_missing_glyphs",
                title_key="preflight.issue.font_missing",
                detail=f"当前字体缺少这些字符（{role}）：{''.join(chars)}",
                impact="纸面上这些字会变成空白；换成系统字体或改掉这些字符",
                locator=CheckLocator(scope="document"),
                fix=CheckFix(
                    action="open_settings", payload={}, label_key="preflight.fix.font_settings"
                ),
                evidence=["".join(chars)],
            )
        )
    if font_coverage.get("bold_available") is False:
        issues.append(
            CheckIssue(
                id="",
                layer="layout",
                severity="verify",
                code="font_bold_missing",
                title_key="preflight.issue.font_bold",
                detail="当前字体没有独立粗体文件，加粗会用合成/回退字形",
                impact="纸面上仍能看出强调，但字重可能与预览不同",
                locator=CheckLocator(scope="document"),
                fix=CheckFix(
                    action="open_settings", payload={}, label_key="preflight.fix.font_settings"
                ),
            )
        )
    return issues


def layout_issues(
    content: ResumeContent,
    *,
    page_limit: int,
    measure: dict | None,
    font_name: str | None,
) -> tuple[list[CheckIssue], dict]:
    """排版层问题 + 缺字结论（后者原样回给前端 D08 卡片）。"""
    text = "\n".join(expected_lines(content))
    font_coverage = coverage(font_name, text)
    issues = _font_issues(font_coverage)
    if measure:
        diagnosis = diagnose(
            used_height=float(measure["used_height"]),
            page_content_height=float(measure["page_content_height"]),
            page_limit=page_limit,
        )
        issues.extend(_diagnosis_issues(diagnosis))
    else:
        # 没有浏览器实测尺寸时**不猜**：用户从 API 直接调用只需知道"排版层没量"。
        issues.append(
            CheckIssue(
                id="",
                layer="layout",
                severity="verify",
                code="layout_no_measure",
                title_key="preflight.issue.layout_no_measure",
                detail="没有提供版面实测尺寸，本次只检查了缺字与内容层",
                impact="在制作台里检查会带上浏览器实测尺寸；直接调用接口时需要传 measure",
                locator=CheckLocator(scope="document"),
                fix=CheckFix(
                    action="open_layout_analyze", payload={}, label_key="preflight.fix.layout"
                ),
            )
        )
    return issues, font_coverage


__all__ = ["layout_issues"]

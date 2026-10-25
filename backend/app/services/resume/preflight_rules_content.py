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

import re
from typing import Any
from urllib.parse import urlsplit

from ...models.claim import ClaimRecord
from ...schemas.preflight import CheckFix, CheckIssue, CheckLocator
from ...schemas.resume import ResumeContent
from ..ats_check import check_ats
from .document_identity import ENTRY_FIELDS
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
    purpose: str = "edit",
    redact: bool = False,
) -> list[CheckIssue]:
    """内容层全部问题（顺序：blocker 类在前，便于前端默认展开）。

    purpose / redact 是 R03 的关键：只有导出视角（purpose=export）才提示
    "联系方式脱敏未开启"，编辑时天天弹一条 verify 会变成噪音。
    """
    # 隐藏条目（W06）不进入检查：它们不会出现在任何正式产物里，为它们报待补/风险
    # 等于让用户为一个明确隐藏掉的段子白改一次。
    visible = content.model_copy(
        update={
            field: [
                item
                for item in (getattr(content, field, None) or [])
                if not is_hidden_entry(item)
            ]
            for field in ENTRY_FIELDS
        }
    )
    issues = _incomplete_issues(visible)
    issues.extend(_ats_issues(visible, jd_text))
    # R03 ①：关键链接失效（blocker）——格式/协议白名单，不联网。
    issues.extend(_link_issues(visible))
    # R03 ②：联系方式脱敏状态（verify，仅导出视角，不阻断）。
    if purpose == "export":
        issues.extend(_contact_masking_issue(visible, redact=redact))
    if include_risk:
        issues.extend(_risk_issues(visible, claims or []))
    return issues


# ===== R03 ①：关键链接失效（blocker） =====
#
# "关键链接"= 简历里指向个人主页 / GitHub / 项目的网址。它们一旦失效，招聘方点不开、
# 也拿不到作品，属于必须解决类问题（R03 口径：必须解决）。判据只做**格式与协议白名单**
# 的确定性检查，不发网络请求（离线、可复现；链接"能不能打开"本身服务端也验证不了）。
#
# 协议白名单 = http / https / mailto：
# - 只允许三种协议，javascript: / file: / ftp: 这类一律拦下（前者是注入风险，
#   后两者在纸面上点不开）；
# - 缺协议头的裸链接（github.com/me）判为格式非法，修复入口提示补 https://；
# - 只扫**带协议或 www. 开头的 token**，不把正文里普通英文域名当链接（如 Node.js），
#   宁可少报也不误报——blocker 误报会挡用户导出。

_ALLOWED_LINK_SCHEMES = frozenset({"http", "https", "mailto"})
_LINK_TOKEN_RE = re.compile(
    r"(?i)(?:[a-z][a-z0-9+.\-]*://[^\s<>\"'，。；、）】]+|mailto:[^\s<>\"'，。；、）】]+"
    r"|www\.[^\s<>\"'，。；、）】]+)"
)
_BARE_DOMAIN_RE = re.compile(r"(?i)^(?:[a-z0-9\-]+\.)+[a-z]{2,}(?:[/:?#].*)?$")
# 没有 // 的危险协议（javascript:/data:/file:/vbscript:/ftp:）：正文里也要能识别。
# 只列这几个已知前缀，避免把英文句子的 "Note:" 误判成协议。
_DANGEROUS_SCHEME_RE = re.compile(
    r"(?i)\b(?:javascript|data|file|vbscript|ftp):[^\s<>\"'，。；、）】]+"
)
_SCHEME_WORD_RE = re.compile(r"(?i)^[a-z][a-z0-9+\-]*$")
_MAX_LINK_ISSUES = 20


def _invalid_link_reason(value: str) -> tuple[str, str] | None:
    """返回 (问题代码, 人类可读原因)；链接合法返回 None。

    代码只有两个稳定值（前端按 code 做标题映射）：
    - link_scheme_unsupported：有协议但不在白名单；
    - link_invalid：格式非法（缺协议头 / 无有效域名 / mailto 缺地址 / 含空白）。
    """
    text = value.strip()
    if not text:
        return None
    if any(ch.isspace() for ch in text):
        return "link_invalid", "链接里包含空白字符，复制或点击时会断开"
    scheme = ""
    if "://" in text:
        scheme = text.split("://", 1)[0].strip().lower()
    elif text.lower().startswith("mailto:"):
        scheme = "mailto"
    if scheme:
        if scheme not in _ALLOWED_LINK_SCHEMES:
            return "link_scheme_unsupported", f"协议 {scheme}: 不在 http/https/mailto 白名单"
        if scheme == "mailto":
            address = text.split(":", 1)[1].strip()
            local, _, domain = address.rpartition("@")
            if not local or "." not in domain:
                return "link_invalid", "mailto 链接缺少有效的邮箱地址"
            return None
        parsed = urlsplit(text)
        host = (parsed.hostname or "").strip()
        if not host or "." not in host:
            return "link_invalid", "链接缺少有效域名（例如 https://example.com/me）"
        return None
    # 没有 // 的协议写法（javascript:alert(1) / ftp:example.com）：协议名必须是
    # 单个英文单词，避免把 "github.com:8080" 这种主机名误判成协议。
    if ":" in text:
        head = text.split(":", 1)[0].strip().lower()
        if _SCHEME_WORD_RE.match(head) and head not in _ALLOWED_LINK_SCHEMES:
            return "link_scheme_unsupported", f"协议 {head}: 不在 http/https/mailto 白名单"
    # 没有协议头：www. 或裸域名都是"格式非法但可修"，明确告诉用户补什么。
    if text.lower().startswith("www.") or _BARE_DOMAIN_RE.match(text):
        return "link_invalid", "链接缺少 http:// 或 https:// 协议头"
    return "link_invalid", "不是可识别的网址格式"


_LINK_TITLE_KEY = {
    "link_invalid": "preflight.issue.link_invalid",
    "link_scheme_unsupported": "preflight.issue.link_scheme_unsupported",
}


def _entry_text_slots(entry: Any, section: str, index: int) -> list[tuple[str, Any, str, str | None]]:
    """一条条目里所有可能含链接的文本位：字段、值、路径、要点 id。

    只取字符串与字符串数组（链接只会出现在这些形态里）；排除身份/锁字段，避免把
    id 当链接扫。要点数组按 point_ids 映射要点 id，前端据此定位到具体一行。
    """
    # content 里两类形态都会出现：已校验的 pydantic 条目（编排层传进来）与原始 dict
    # （未来可能的内容 JSON 检查）。统一转成 dict 再扫，两处遍历才能拿到同一结果。
    if hasattr(entry, "model_dump"):
        entry = entry.model_dump()
    if not isinstance(entry, dict):
        return []
    point_ids = entry.get("point_ids") if isinstance(entry.get("point_ids"), dict) else {}
    slots: list[tuple[str, Any, str, str | None]] = []
    for field, value in entry.items():
        if field in {"id", "point_ids", "hidden", "lock_content", "lock_layout"}:
            continue
        if isinstance(value, str):
            slots.append((field, value, f"{section}.{index}.{field}", None))
        elif isinstance(value, list):
            ids = point_ids.get(field) or []
            for item_index, item in enumerate(value):
                if isinstance(item, str):
                    point_id = ids[item_index] if item_index < len(ids) else None
                    slots.append(
                        (
                            field,
                            item,
                            f"{section}.{index}.{field}.{item_index}",
                            point_id if isinstance(point_id, str) else None,
                        )
                    )
    return slots


def _link_issues(content: ResumeContent) -> list[CheckIssue]:
    """关键链接失效（blocker）：专属字段 + 条目文本里的链接 token。"""
    issues: list[CheckIssue] = []

    # 1) 专属链接字段：整值是链接，直接按完整值校验。
    for field in ("personal_website", "github"):
        value = str(getattr(content, field, "") or "")
        reason = _invalid_link_reason(value)
        if reason is None:
            continue
        code, detail = reason
        issues.append(
            CheckIssue(
                id="",
                layer="content",
                severity="blocker",
                code=code,
                title_key=_LINK_TITLE_KEY[code],
                detail=f"{field} 字段：{detail}",
                impact="招聘方点不开或复制后打不开，作品与主页信息等于丢失",
                locator=CheckLocator(scope="field", field=field),
                fix=CheckFix(
                    action="focus_field",
                    payload={"field": field},
                    label_key="preflight.fix.focus_field",
                ),
            )
        )
        if len(issues) >= _MAX_LINK_ISSUES:
            return issues

    # 2) 条目正文里的链接 token（项目链接常写在描述里）。
    for section in ENTRY_FIELDS:
        for index, raw_entry in enumerate(getattr(content, section, None) or []):
            if is_hidden_entry(raw_entry):
                continue
            entry = raw_entry.model_dump() if hasattr(raw_entry, "model_dump") else raw_entry
            object_id = entry.get("id") if isinstance(entry, dict) else None
            for field, value, path, point_id in _entry_text_slots(entry, section, index):
                tokens = _LINK_TOKEN_RE.findall(value)
                tokens.extend(_DANGEROUS_SCHEME_RE.findall(value))
                for token in dict.fromkeys(tokens):
                    reason = _invalid_link_reason(token)
                    if reason is None:
                        continue
                    code, detail = reason
                    issues.append(
                        CheckIssue(
                            id="",
                            layer="content",
                            severity="blocker",
                            code=code,
                            title_key=_LINK_TITLE_KEY[code],
                            detail=f"正文里的链接 {token[:120]}：{detail}",
                            impact="招聘方点不开或复制后打不开，作品与主页信息等于丢失",
                            locator=CheckLocator(
                                scope="point" if point_id else "object",
                                section=section,
                                object_id=object_id,
                                point_id=point_id,
                                field=field,
                                path=path,
                            ),
                            fix=CheckFix(
                                action="focus_field",
                                payload={"section": section, "path": path},
                                label_key="preflight.fix.focus_field",
                            ),
                        )
                    )
                    if len(issues) >= _MAX_LINK_ISSUES:
                        return issues
    return issues


# ===== R03 ②：联系方式脱敏状态（verify，只提示不阻断） =====
#
# 导出（purpose=export）且未开启脱敏时，如果正文里能找到手机号/邮箱，就提示核对：
# 对外投递的简历可能暴露联系方式。**只提示**：用户可能就是要在简历上留联系方式，
# 所以 verify 级、不阻断导出。

_PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_MAX_CONTACT_EVIDENCE = 5


def _iter_visible_text(content: ResumeContent) -> list[tuple[str, str]]:
    """可见正文里的 (位置, 文本)：用于联系方式的"正文里有没有"判断。"""
    slots: list[tuple[str, str]] = [
        ("summary", content.summary or ""),
        ("job_intent", content.job_intent or ""),
    ]
    for section in ENTRY_FIELDS:
        for index, raw_entry in enumerate(getattr(content, section, None) or []):
            if is_hidden_entry(raw_entry):
                continue
            entry = raw_entry.model_dump() if hasattr(raw_entry, "model_dump") else raw_entry
            for _field, value, path, _point_id in _entry_text_slots(entry, section, index):
                slots.append((path, value))
    return slots


def _contact_evidence(content: ResumeContent) -> list[str]:
    """能找到联系方式的证据位置（最多 5 条）：先看专属字段，再看正文正则。"""
    evidence: list[str] = []
    if (content.phone or "").strip():
        evidence.append("phone")
    if (content.email or "").strip():
        evidence.append("email")
    for location, text in _iter_visible_text(content):
        if len(evidence) >= _MAX_CONTACT_EVIDENCE:
            break
        if not text:
            continue
        if _PHONE_RE.search(text) or _EMAIL_RE.search(text):
            evidence.append(location)
    return evidence[:_MAX_CONTACT_EVIDENCE]


def _contact_masking_issue(content: ResumeContent, *, redact: bool) -> list[CheckIssue]:
    """purpose=export 且未开启脱敏时，提示核对联系方式。**不阻断导出**（verify）。"""
    if redact:
        return []
    evidence = _contact_evidence(content)
    if not evidence:
        return []
    return [
        CheckIssue(
            id="",
            layer="content",
            severity="verify",
            code="contact_masking_off",
            title_key="preflight.issue.contact_masking_off",
            detail="这次导出没有开启脱敏，正文里能找到手机号或邮箱，对外发送前请核对",
            impact="投给外部时联系方式会原样出现在产物里；只想让对方看到作品时建议开启脱敏",
            locator=CheckLocator(scope="document"),
            fix=CheckFix(
                action="open_settings",
                payload={"section": "privacy"},
                label_key="preflight.fix.open_settings",
            ),
            evidence=evidence,
        )
    ]


__all__ = ["content_issues"]

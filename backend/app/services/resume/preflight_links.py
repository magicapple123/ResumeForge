# SPDX-License-Identifier: Apache-2.0
"""Shared deterministic link validation for preflight text slots."""

import re
from urllib.parse import urlsplit

from ...schemas.preflight import CheckFix, CheckIssue, CheckLocator

_ALLOWED_LINK_SCHEMES = frozenset({"http", "https", "mailto"})


_LINK_TOKEN_RE = re.compile(
    r"(?i)(?:[a-z][a-z0-9+.\-]*://[^\s<>\"'，。；、）】]+|mailto:[^\s<>\"'，。；、）】]+"
    r"|www\.[^\s<>\"'，。；、）】]+)"
)


_BARE_DOMAIN_RE = re.compile(r"(?i)^(?:[a-z0-9\-]+\.)+[a-z]{2,}(?:[/:?#].*)?$")


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


def link_issues(
    dedicated: list[tuple[str, str, CheckLocator]],
    prose: list[tuple[str, str, CheckLocator]],
) -> list[CheckIssue]:
    issues: list[CheckIssue] = []
    for direct, slots in ((True, dedicated), (False, prose)):
        for field, value, locator in slots:
            tokens = (
                [value]
                if direct
                else list(
                    dict.fromkeys(
                        [*_LINK_TOKEN_RE.findall(value), *_DANGEROUS_SCHEME_RE.findall(value)]
                    )
                )
            )
            for token in tokens:
                reason = _invalid_link_reason(token)
                if reason is None:
                    continue
                code, detail = reason
                payload = (
                    {"section": locator.section, "path": locator.path}
                    if locator.section
                    else {"field": field}
                )
                issues.append(
                    CheckIssue(
                        id="",
                        layer="content",
                        severity="blocker",
                        code=code,
                        title_key=_LINK_TITLE_KEY[code],
                        detail=f"{field} 字段：{detail}"
                        if direct
                        else f"正文里的链接 {token[:120]}：{detail}",
                        impact="招聘方点不开或复制后打不开，作品与主页信息等于丢失",
                        locator=locator,
                        fix=CheckFix(
                            action="focus_field",
                            payload=payload,
                            label_key="preflight.fix.focus_field",
                        ),
                    )
                )
                if len(issues) >= _MAX_LINK_ISSUES:
                    return issues
    return issues

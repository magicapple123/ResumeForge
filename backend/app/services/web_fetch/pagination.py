# SPDX-License-Identifier: Apache-2.0
"""翻页发现（#16 分页）：只认页面自己给出的「下一页」，**不猜 URL 模板**。

口径（收尾工单任务 2）：

1. 优先 `<link rel="next">`，其次 `<a>`：
   - `rel` 含 next；
   - 文案是「下一页 / 下页 / Next / Next page / › / » / →」；
   - class/id 命中常见分页容器（pagination-next / page-next / next-page / next 等）；
   - aria-label / title 含「下一页 / next」。
2. JSON 页面（XHR 接口直出）读显式 next 字段（next / next_url / nextPage …）；
3. 都找不到 → 返回空串，调用方只抓当前页并如实报告 `stop_reason=no_next`。

刻意不做的事：不拼 `?page=N`、不遍历站内其他链接、不跟随「最后一页」以外的猜测。
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin, urlsplit

#: 常见「下一页」文案（小写比较，允许前后空白）。
_NEXT_TEXTS = {
    "下一页",
    "下页",
    "下一頁",
    "next",
    "nextpage",
    "next page",
    "›",
    "»",
    "→",
}
#: 常见分页容器 class/id 片段。
_NEXT_ATTR_RE = re.compile(
    r"(?:^|[\s_-])(?:next|page-next|pagination-next|next-page|nextpage)(?:$|[\s_-])",
    re.I,
)
#: JSON 里显式的下一页字段名（只认这些；不做「按页码拼 URL」的推断）。
_NEXT_JSON_KEYS = {
    "next",
    "next_url",
    "nexturl",
    "next_page",
    "nextpage",
    "next_href",
    "next_link",
    "nextlink",
}
_ANCHOR_RE = re.compile(r"<a\b([^>]*)>(.{0,200}?)</a>", re.I | re.S)
_LINK_RE = re.compile(r"<link\b([^>]*)>", re.I)
_ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_MAX_JSON_NODES = 5000


def _attrs(raw: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for match in _ATTR_RE.finditer(raw or ""):
        name = match.group(1).lower()
        value = (
            match.group(2)
            if match.group(2) is not None
            else (match.group(3) if match.group(3) is not None else (match.group(4) or ""))
        )
        parsed.setdefault(name, value)
    return parsed


def _absolute(url: str, *, base_url: str) -> str:
    """把候选 href 补全成 http(s) 绝对地址；不合法/非 http 返回空串。"""
    raw = (url or "").strip()
    if not raw or raw.startswith(("#", "javascript:", "mailto:", "tel:")):
        return ""
    absolute = urljoin(base_url, raw)
    try:
        parts = urlsplit(absolute)
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ""
    return absolute


def _is_next_anchor(attrs: dict[str, str], text: str) -> bool:
    rel = attrs.get("rel", "").lower().split()
    if "next" in rel:
        return True
    haystack = f"{attrs.get('class', '')} {attrs.get('id', '')}".strip()
    if haystack and _NEXT_ATTR_RE.search(haystack):
        return True
    label = (text or "").strip().lower()
    if label in _NEXT_TEXTS:
        return True
    if re.match(r"^(下一页|下页|下一頁|next\b|next page|›|»|→)", label):
        return True
    for attr in ("aria-label", "title"):
        hint = (attrs.get(attr) or "").strip().lower()
        if hint and (hint in _NEXT_TEXTS or "下一页" in hint or hint.startswith("next")):
            return True
    return False


def _from_html(html: str, *, base_url: str) -> str:
    for match in _LINK_RE.finditer(html or ""):
        attrs = _attrs(match.group(1))
        rel = attrs.get("rel", "").lower().split()
        if "next" in rel:
            found = _absolute(attrs.get("href", ""), base_url=base_url)
            if found:
                return found
    for match in _ANCHOR_RE.finditer(html or ""):
        attrs = _attrs(match.group(1))
        text = re.sub(r"<[^>]+>", "", match.group(2) or "")
        if not _is_next_anchor(attrs, text):
            continue
        found = _absolute(attrs.get("href", ""), base_url=base_url)
        if found:
            return found
    return ""


def _from_json(payload: Any, *, base_url: str) -> str:
    """在 JSON 里找显式的下一页地址；只认字符串 URL，不拼模板。"""
    stack: list[Any] = [payload]
    visited = 0
    while stack and visited < _MAX_JSON_NODES:
        visited += 1
        current = stack.pop()
        if isinstance(current, dict):
            for key, value in current.items():
                if str(key).strip().lower() in _NEXT_JSON_KEYS and isinstance(value, str):
                    candidate = value.strip()
                    if not candidate or "{" in candidate or "}" in candidate:
                        continue
                    found = _absolute(candidate, base_url=base_url)
                    if found:
                        return found
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(item for item in current if isinstance(item, (dict, list)))
    return ""


def find_next_page_url(page: Any) -> str:
    """返回页面声明的下一页 URL；找不到返回空串（调用方据此 stop_reason=no_next）。"""
    base_url = str(getattr(page, "url", "") or "")
    if not base_url:
        return ""
    html = str(getattr(page, "html", "") or "")
    if html:
        found = _from_html(html, base_url=base_url)
        if found:
            return found
    for payload in getattr(page, "json_payloads", ()) or ():
        found = _from_json(payload, base_url=base_url)
        if found:
            return found
    return ""


def same_site_host(left: str, right: str) -> bool:
    """两个 URL 是否同主机（跨站 next 不做静默跟随；由调用方如实停止）。"""
    try:
        return (urlsplit(left).hostname or "").lower() == (urlsplit(right).hostname or "").lower()
    except ValueError:
        return False


__all__ = ["find_next_page_url", "same_site_host"]

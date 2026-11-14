# SPDX-License-Identifier: Apache-2.0
"""主流招聘平台的**详情页**适配器（R-15 B：多平台采集）。

## 为什么需要这一层

通用规则层按"标题/薪资/城市 + 重复容器"猜结构，在三种 ATS（Greenhouse / Lever /
Workday）上会掉进同一个坑：**JD 正文是平台自己的容器**，而页面导航、相似岗位、
申请按钮也在同一片 DOM 里，通用规则会把它们混进 `description`。平台适配器的职责很窄：

1. 用**站点特征**认出是哪家 ATS（host 或稳定的 DOM 标记，不猜 URL 模板）；
2. 只在平台自己的 JD 容器里取正文，取不到就返回空——**不**退回"整页文字"，
   让上层继续走通用规则/模型兜底；
3. 平台特有的字段（如 Workday 的 `jobPostingHeader`）一并取回，避免通用规则把
   公司名读成岗位名。

## 边界（刻意不做的事）

* 不做登录、不点"申请"、不读投递状态——那是 R-15 C 的范围；
* 不维护"每个客户公司一个适配器"：三家 ATS 的容器是平台级的，客户换皮不影响；
* 认不出平台时返回 `None`，调用方完全按老路径走，行为逐字节不变。

## 可验证性

三家都用**本地 HTML fixture**（tests/test_web_fetch_platforms.py）验，真实站点列为
「未验证项」：容器选择器来自各平台公开的页面结构，登录/反爬差异不在本层处理。
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

#: 平台标识（写进 `DetailResult.platform`；未知为空串）。
GREENHOUSE = "greenhouse"
LEVER = "lever"
WORKDAY = "workday"

#: host 特征 → 平台。只认明确域名，不做模糊猜测。
_HOST_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(^|\.)greenhouse\.io$|(^|\.)gh_jid=", re.I), GREENHOUSE),
    (re.compile(r"(^|\.)lever\.co$", re.I), LEVER),
    (re.compile(r"(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$", re.I), WORKDAY),
)

#: DOM 特征：host 认不出时（客户自定义域名）再按稳定标记认一次。
_MARKERS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'id=["\']app_body["\']|class=["\'][^"\']*job__description', re.I), GREENHOUSE),
    (re.compile(r'class=["\'][^"\']*posting-page|class=["\'][^"\']*posting-header', re.I), LEVER),
    (
        re.compile(
            r'data-automation-id=["\']jobPosting(Description|Header)["\']'
            r'|data-automation-id=["\']jobDetailsPage',
            re.I,
        ),
        WORKDAY,
    ),
)

_TAG_RE = re.compile(r"<[^>]+>")
#: 一行里至少要有一个字母/数字/汉字才算正文（滤掉切标签时带进来的 `">` 之类）。
_TEXT_RE = re.compile(r"[\w\u4e00-\u9fa5]")
_BLOCK_BREAK_RE = re.compile(r"</(?:p|div|li|h[1-6]|section|tr)>|<br\s*/?>", re.I)
_SPACE_RE = re.compile(r"[ \t\u00a0]+")


def html_to_lines(html: str) -> list[str]:
    """HTML → 纯文本行（保留段落边界，压缩行内空白）。

    只在本模块用：通用层有自己的 `html_to_text`，但那个会把整页导航一起留下，
    而这里要的正是"容器内的正文"。
    """
    if not html:
        return []
    body = _BLOCK_BREAK_RE.sub("\n", html)
    text = _TAG_RE.sub("", body)
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">")):
        text = text.replace(entity, char)
    lines = [_SPACE_RE.sub(" ", line).strip() for line in text.splitlines()]
    # 切容器时会把起始标签的尾巴（`">`）带进来：只留真正有文字的行使之消失。
    return [line for line in lines if line and _TEXT_RE.search(line)]


def detect_platform(url: str | None, html: str | None) -> str:
    """认平台：host 优先，其次 DOM 标记；认不出返回空串（调用方走通用路径）。"""
    host = (urlsplit(url or "").hostname or "").lower()
    if "gh_jid=" in (url or ""):
        return GREENHOUSE
    for pattern, name in _HOST_RULES:
        if host and pattern.search(host):
            return name
    source = html or ""
    for pattern, name in _MARKERS:
        if pattern.search(source):
            return name
    return ""


def _container_lines(html: str, patterns: tuple[str, ...]) -> list[str]:
    """取第一个命中容器的文本行；容器用"起始标记 → 结束标记"的宽松切法。

    不用完整 HTML 解析器：三个平台的容器都是扁平的 `div`，正则切一段足够，也不会
    把依赖带进服务层（通用层已经有一套 DOM 工具，但那套面向"列表容器"）。
    """
    for open_pattern, close_tag in patterns:
        match = re.search(open_pattern, html, re.I)
        if not match:
            continue
        tail = html[match.end() :]
        end = re.search(rf"</{close_tag}>", tail, re.I)
        chunk = tail[: end.start()] if end else tail
        lines = html_to_lines(chunk)
        if lines:
            return lines
    return []


def _first_value(lines: list[str], keys: tuple[str, ...]) -> str:
    for line in lines:
        for key in keys:
            if line.startswith(key) and len(line) <= len(key) + 40:
                return line[len(key) :].strip(" :：|")
    return ""


def _split_sections(lines: list[str]) -> dict[str, str]:
    """按常见小标题把 JD 切成 description / requirements / additional_info。"""
    buckets = {"description": [], "requirements": [], "additional_info": []}
    current = "description"
    for line in lines:
        lowered = line.lower()
        if any(
            token in lowered for token in ("requirement", "qualification", "任职要求", "岗位要求")
        ):
            current = "requirements"
            continue
        if any(token in lowered for token in ("benefit", "perks", "加分", "福利", "其他要求")):
            current = "additional_info"
            continue
        if any(
            token in lowered
            for token in ("responsibilit", "about the role", "岗位职责", "工作内容")
        ):
            current = "description"
            continue
        buckets[current].append(line)
    return {key: "\n".join(value).strip() for key, value in buckets.items() if value}


_GREENHOUSE_CONTAINERS = (
    (r'<div[^>]+id=["\']app_body["\']', "div"),
    (r'<div[^>]+class=["\'][^"\']*job__description', "div"),
    (r'<section[^>]+class=["\'][^"\']*job-post', "section"),
)
_LEVER_CONTAINERS = (
    (r'<div[^>]+class=["\'][^"\']*content-wrapper', "div"),
    (r'<div[^>]+class=["\'][^"\']*posting-page', "div"),
    (r'<section[^>]+class=["\'][^"\']*section', "section"),
)
_WORKDAY_CONTAINERS = (
    (r'<div[^>]+data-automation-id=["\']jobPostingDescription["\']', "div"),
    (r'<section[^>]+data-automation-id=["\']jobPostingDescription["\']', "section"),
)


def platform_detail_fields(url: str | None, html: str | None) -> tuple[str, dict[str, str]]:
    """平台详情页 → `(平台, 字段)`；认不出或容器为空时返回 `("" , {})`。

    返回的字段只包含**页面上真有**的项：`description` 必须非空，否则整份作废，
    让上层继续走通用规则（宁可走通用层，也不要拿半页导航当 JD）。
    """
    platform = detect_platform(url, html)
    if not platform or not html:
        return "", {}
    containers = {
        GREENHOUSE: _GREENHOUSE_CONTAINERS,
        LEVER: _LEVER_CONTAINERS,
        WORKDAY: _WORKDAY_CONTAINERS,
    }[platform]
    lines = _container_lines(html, containers)
    if not lines:
        return platform, {}
    sections = _split_sections(lines)
    description = sections.get("description", "")
    if len(description) < 80:  # noqa: PLR2004 - 少于这个长度基本是"导航残留"，不算 JD
        return platform, {}
    fields: dict[str, str] = {"description": description}
    if sections.get("requirements"):
        fields["requirements"] = sections["requirements"]
    if sections.get("additional_info"):
        fields["additional_info"] = sections["additional_info"]
    # 头部字段（公司/地点/标题）取正文开头几行：三家平台的头部容器嵌套层级不一致，
    # 按 `</div>` 切会只切到第一层，反而漏字段；开头几行的噪声在 `_first_value` 里被过滤。
    meta_source = html_to_lines(html)[:12]
    for key, keys in (
        ("company", ("Company", "公司")),
        ("location", ("Location", "地点", "工作地点")),
        ("title", ("Job Title", "职位名称")),
    ):
        value = _first_value(meta_source, keys)
        if value:
            fields[key] = value
    return platform, fields


__all__ = [
    "GREENHOUSE",
    "LEVER",
    "WORKDAY",
    "detect_platform",
    "html_to_lines",
    "platform_detail_fields",
]

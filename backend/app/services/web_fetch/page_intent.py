# SPDX-License-Identifier: Apache-2.0
"""判断"这一页是岗位详情还是岗位列表"，以及锚点兜底结果是不是导航噪音。

为什么不能只看 URL：校招站大量用同一个路径形态既做详情又做列表（``/positions/123`` 和
``/positions``），也有反向的（列表页带 ``?jobId=``）。所以先按路径/查询串取"形态"
（``_detail_shape``），再看**页面上有多少条同形态链接**：≥3 条说明这一页在列同类岗位，
是列表页；详情页只会引用"相关职位"之外的少量链接。

拿不到结构证据时按内容兜底：H1 或"工作职责/任职资格/职位描述"这类 JD 标记 → 详情，
否则**判成列表**（列表是更保守的默认：多抓一页不会漏岗位，把列表误当详情会只导入一条）。

``navigation_only`` 是最后一道质量闸：锚点兜底抓出来的行里，如果 80% 以上连公司/地点/
薪资都没有，那抓到的是导航链接，不是岗位卡片——这类结果宁可报"没识别到"，不塞进岗位库。
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .extract_rules import job_href
from .html_utils import html_to_text, list_containers

_DETAIL_PATH = re.compile(
    r"/(?:positions?|jobs?|vacancies|p|job[-_]?detail|position[-_]?detail)/"
    r"(?:detail/)?(?:\d+|[a-f\d-]{8,})(?:/|$)",
    re.I,
)
_DETAIL_MARKERS = ("工作职责", "任职资格", "岗位职责", "职位描述", "Responsibilities")


def page_heading(page: Any) -> str:
    match = re.search(r"<h1\b[^>]*>(.*?)</h1>", str(getattr(page, "html", "") or ""), re.I | re.S)
    return html_to_text(match.group(1)).strip()[:128] if match else ""


def _detail_shape(url: str) -> str:
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    match = _DETAIL_PATH.search(parts.path)
    if match:
        return parts.path[: match.end()].rstrip("/").rsplit("/", 1)[0].lower()
    query = parse_qs(parts.query)
    return (
        parts.path.lower()
        if any(
            key.lower() in {"jobid", "positionid", "job_id", "position_id"} and values[0]
            for key, values in query.items()
            if values
        )
        else ""
    )


def classify_page_intent(page: Any) -> str:
    url = str(getattr(page, "url", "") or "")
    shape = _detail_shape(url)
    # 形态都取不到（既不是详情路径也没有 jobId 查询）→ 只可能是列表。
    if not shape:
        return "job_list"
    _containers, anchors = list_containers(str(getattr(page, "html", "") or ""))
    host = urlsplit(url).netloc.lower()
    same_shape = {
        absolute
        for href, _label in anchors
        if (absolute := job_href(href, base_url=url))
        and urlsplit(absolute).netloc.lower() == host
        and _detail_shape(absolute) == shape
    }
    if len(same_shape) >= 3:
        return "job_list"
    text = str(getattr(page, "text", "") or "")
    evidence = page_heading(page) or any(
        marker.lower() in text.lower() for marker in _DETAIL_MARKERS
    )
    return "job_detail" if evidence else "job_list"


def navigation_only(rows: list[dict[str, Any]]) -> bool:
    if not rows or not any(row.get("anchor_fallback") for row in rows):
        return False
    empty = sum(
        not any(
            str((row.get("data") or {}).get(key) or "").strip()
            for key in ("company", "location", "salary")
        )
        for row in rows
    )
    return empty / len(rows) >= 0.8

# SPDX-License-Identifier: Apache-2.0
"""规则层抽取（#16B）：零模型成本，优先命中 JSON / JSON-LD / 重复列表容器。

判定顺序：

1. 页面内嵌 JSON（__NEXT_DATA__ / __NUXT__ / JSON-LD）：找「含 title/name + salary/city」
   的对象数组；JSON-LD 的 JobPosting 直接按 schema.org 字段映射；
2. JSON 响应体（browser 引擎抓到的 XHR/fetch 响应）：同上；
3. HTML：找带 job/position/list 类名的重复容器，容器里必须有链接与岗位名；
   容器命中不了时退回「链接文本 + 岗位形状 href」这一路；
4. 以上都没命中 → 规则层返回空，由模型层兜底（extractor.extract_rows）。

规则层只做「照抄」：字段值必须来自页面文本，找不到就留空；职位类型/状态/发布时间的
归一在 field_rules 里做，不在这里各写一份。
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin, urlsplit

from .extract_keys import (
    _ADD_KEYS,
    _COMPANY_KEYS,
    _DESC_KEYS,
    _LOCATION_KEYS,
    _POSTED_KEYS,
    _REQ_KEYS,
    _SALARY_KEYS,
    _TITLE_KEYS,
    _TYPE_KEYS,
    _URL_KEYS,
)
from .field_rules import clean_text, split_jd_sections, summary_of
from .html_utils import embedded_json_payloads, html_to_text, list_containers

_JOB_HREF_RE = re.compile(r"(job|position|career|detail|offercampus|vacanc|/jobs?/|/p/\d+)", re.I)
_BAD_TITLE_RE = re.compile(
    r"^(首页|登录|注册|搜索|查看更多|更多|详情|投递|申请|立即申请|职位搜索|全部职位|上一页|下一页)$"
)
_SALARY_RE = re.compile(r"\d+(?:\.\d+)?\s*[-~—至]\s*\d+(?:\.\d+)?\s*[kK千万]?|面议|薪资面议")
_LOCATION_RE = re.compile(
    r"(北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|苏州|天津|重庆|长沙|郑州|合肥|厦门|福州|济南|青岛|大连|沈阳|哈尔滨|昆明|南昌|贵阳|南宁|海口|兰州|太原|石家庄|乌鲁木齐|呼和浩特|银川|西宁|拉萨|香港|澳门|台北|[\u4e00-\u9fa5]{2,}市|[\u4e00-\u9fa5]{2,}区)"
)
_COMPANY_RE = re.compile(
    r"(公司|集团|科技|有限|银行|研究院|实验室|事务所|工作室|中心|大学|医院|证券|基金|保险|网络|信息|软件|数据)"
)
_POSTED_AT_RE = re.compile(r"(?:发布时间|发布日期|更新时间|上线时间)[:：]?\s*([^\n]{1,32})")
_RELATIVE_DATE_RE = re.compile(r"\d{1,3}\s*(?:天|周|个月)前|刚刚|今天|昨天|本周")
_JOB_TYPE_TEXT = ("校招", "校园招聘", "应届", "实习", "社招", "社会招聘")

#: 列表容器里出现这些行时跳过（导航/页脚噪声）。
_NOISE_RE = re.compile(r"^(首页|登录|注册|搜索|查看更多|更多|下一页|上一页|收藏|分享|举报)$")


def _first(item: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ""


def _text_of(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return _text_of(value.get("name") or value.get("text") or "")
    if isinstance(value, list):
        return "、".join(_text_of(item) for item in value if _text_of(item))
    return ""


def job_href(value: str, *, base_url: str) -> str:
    """把相对详情链接补全成绝对地址；非 http(s) 或空的返回空串。"""
    raw = (value or "").strip()
    if not raw:
        return ""
    absolute = urljoin(base_url, raw)
    try:
        parts = urlsplit(absolute)
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ""
    return absolute


def looks_like_job_href(href: str) -> bool:
    return bool(_JOB_HREF_RE.search(href or ""))


def _looks_like_job_item(item: dict[str, Any]) -> bool:
    """对象是否像一条岗位：有职位名，且至少还有一个岗位特征字段。"""
    title = _first(item, _TITLE_KEYS)
    if not (2 <= len(title) <= 128) or _BAD_TITLE_RE.match(title):
        return False
    has_salary = bool(_first(item, _SALARY_KEYS))
    has_city = bool(_first(item, _LOCATION_KEYS))
    has_url = any(_first(item, (key,)) for key in _URL_KEYS)
    has_company = bool(_first(item, _COMPANY_KEYS))
    return has_salary or has_city or has_url or has_company


def _walk_json(payload: Any, out: list[dict[str, Any]], *, depth: int = 0) -> None:
    if depth > 12 or len(out) >= 500:
        return
    if isinstance(payload, dict):
        if _looks_like_job_item(payload):
            out.append(payload)
            return
        for value in payload.values():
            _walk_json(value, out, depth=depth + 1)
    elif isinstance(payload, list):
        for item in payload:
            _walk_json(item, out, depth=depth + 1)


def _evidence_for(source: str, value: str) -> str:
    """在原文里找值的出处，返回带上下文的片段；找不到就返回值本身。"""
    text = clean_text(source)
    needle = clean_text(value)
    if not needle:
        return ""
    index = text.find(needle)
    if index < 0:
        return needle[:140]
    start = max(0, index - 30)
    end = min(len(text), index + len(needle) + 30)
    return text[start:end].replace("\n", " ")[:160]


def _row_from_json_item(
    item: dict[str, Any], *, page_url: str, page_text: str
) -> dict[str, Any] | None:
    title = _first(item, _TITLE_KEYS)
    if not title:
        return None
    detail_url = job_href(_first(item, _URL_KEYS), base_url=page_url)
    data: dict[str, str] = {
        "title": title,
        "company": _first(item, _COMPANY_KEYS),
        "location": _first(item, _LOCATION_KEYS),
        "salary": _first(item, _SALARY_KEYS),
        "job_type": _first(item, _TYPE_KEYS),
        "posted_at": _first(item, _POSTED_KEYS),
        "description": _text_of(item.get("description") or "").strip(),
        "requirements": _text_of(item.get("requirements") or "").strip(),
        "additional_info": _text_of(item.get("additionalInfo") or "").strip(),
    }
    if not data["description"]:
        data["description"] = clean_text(_first(item, _DESC_KEYS))
    if not data["requirements"]:
        data["requirements"] = clean_text(_first(item, _REQ_KEYS))
    if not data["additional_info"]:
        data["additional_info"] = clean_text(_first(item, _ADD_KEYS))
    if data["description"]:
        split = split_jd_sections(data["description"])
        data["description"] = str(split["description"])
        if not data["requirements"]:
            data["requirements"] = str(split["requirements"])
        if not data["additional_info"]:
            data["additional_info"] = str(split["additional_info"])
    source_blob = " ".join(value for value in data.values() if value) or page_text
    evidence = {
        field: _evidence_for(source_blob, value)
        for field, value in data.items()
        if value and field not in {"description", "requirements", "additional_info"}
    }
    return {
        "data": data,
        "detail_url": detail_url,
        "evidence": evidence,
        "summary": summary_of(
            " ".join(
                filter(
                    None,
                    (
                        title,
                        data.get("company", ""),
                        data.get("location", ""),
                        data.get("salary", ""),
                    ),
                )
            )
        ),
    }


def rows_from_json(payload: Any, *, page_url: str, page_text: str) -> list[dict[str, Any]]:
    """从一个 JSON 结构里找岗位对象数组，映射成原始行。"""
    items: list[dict[str, Any]] = []
    _walk_json(payload, items)
    rows = []
    for item in items:
        row = _row_from_json_item(item, page_url=page_url, page_text=page_text)
        if row is not None:
            rows.append(row)
    return rows


def _json_ld_job(item: dict[str, Any], *, page_url: str, page_text: str) -> dict[str, Any] | None:
    types = item.get("@type")
    kinds = types if isinstance(types, list) else [types]
    if not any(str(kind).lower() == "jobposting" for kind in kinds):
        return None
    title = _text_of(item.get("title") or item.get("name"))
    if not title:
        return None
    organization = item.get("hiringOrganization")
    company = _text_of(organization) if isinstance(organization, (dict, str)) else ""
    location = item.get("jobLocation")
    location_text = ""
    if isinstance(location, dict):
        address = location.get("address")
        if isinstance(address, dict):
            parts = [
                address.get(key) for key in ("addressRegion", "addressLocality", "streetAddress")
            ]
            location_text = "·".join(str(part) for part in parts if part)[:64]
        else:
            location_text = _text_of(location)[:64]
    elif isinstance(location, list) and location:
        location_text = _text_of(location[0])[:64]
    description_html = _text_of(item.get("description"))
    description_text = (
        html_to_text(description_html) if "<" in description_html else description_html
    )
    split = split_jd_sections(description_text)
    employment = _text_of(item.get("employmentType")).upper()
    job_type = "实习" if "INTERN" in employment else ""
    data = {
        "title": title,
        "company": company,
        "location": location_text,
        "job_type": job_type,
        "posted_at": _text_of(item.get("datePosted")),
        "description": str(split["description"]),
        "requirements": str(split["requirements"]),
        "additional_info": str(split["additional_info"]),
    }
    return {
        "data": data,
        "detail_url": job_href(_text_of(item.get("url")), base_url=page_url),
        "evidence": {},
        "summary": summary_of(" ".join(filter(None, (title, company, location_text)))),
        "jd_split": bool(split["split"]),
    }


def rows_from_json_payloads(
    payloads: list[Any], *, page_url: str, page_text: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for payload in payloads:
        if isinstance(payload, dict):
            json_ld = _json_ld_job(payload, page_url=page_url, page_text=page_text)
            if json_ld is not None:
                rows.append(json_ld)
                continue
        rows.extend(rows_from_json(payload, page_url=page_url, page_text=page_text))
    return rows


def _clean_lines(lines: list[str]) -> list[str]:
    cleaned: list[str] = []
    for line in lines:
        text = clean_text(line)
        if not text or _NOISE_RE.match(text):
            continue
        if text not in cleaned:
            cleaned.append(text)
    return cleaned


def _title_from_anchor(container_text: str, anchors: list[tuple[str, str]]) -> tuple[str, str]:
    """容器里找「看起来是岗位名」的链接；返回 (标题, 详情链接)。

    优先选**链接文字真的出现在这个容器里**的那个 anchor：嵌套容器（列表容器套卡片容器）
    的文本会包含多条岗位，只按 href 形状取第一个会把所有卡片都映射到第一条链接。
    """
    fallback: tuple[str, str] = ("", "")
    for href, label in anchors:
        if not href or not label or _BAD_TITLE_RE.match(label):
            continue
        if not (2 <= len(label) <= 60):
            continue
        if label in container_text:
            return label, href
        if not fallback[0] and looks_like_job_href(href):
            fallback = (label, href)
    return fallback


def rows_from_html_containers(html: str, *, page_url: str, page_text: str) -> list[dict[str, Any]]:
    """找带 job/position/list 类名的重复容器，容器内必须能定位到岗位名与链接。"""
    containers, anchors = list_containers(html)
    usable_anchors = [
        (job_href(href, base_url=page_url), label)
        for href, label in anchors
        if job_href(href, base_url=page_url)
    ]
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for lines in containers:
        cleaned = _clean_lines(lines)
        if len(cleaned) < 2:
            continue
        text = "\n".join(cleaned)
        title, href = _title_from_anchor(text, usable_anchors)
        if not title:
            title = cleaned[0]
        if not title or _BAD_TITLE_RE.match(title) or len(title) > 128:
            continue
        key = href or title
        if key in seen:
            continue
        seen.add(key)
        detail_url = href or page_url
        location = next(
            (line for line in cleaned[1:] if _LOCATION_RE.search(line) and len(line) <= 32), ""
        )
        salary_match = _SALARY_RE.search(text)
        company = next(
            (
                line
                for line in cleaned[1:]
                if line != location and _COMPANY_RE.search(line) and len(line) <= 40
            ),
            "",
        )
        container_text = "\n".join(cleaned)
        posted_match = _POSTED_AT_RE.search(container_text) or _RELATIVE_DATE_RE.search(
            container_text
        )
        posted_at = ""
        if posted_match:
            posted_at = (
                posted_match.group(1) if posted_match.re is _POSTED_AT_RE else posted_match.group(0)
            ).strip()
        job_type = next((word for word in _JOB_TYPE_TEXT if word in container_text), "")
        rows.append(
            {
                "data": {
                    "title": title,
                    "company": company,
                    "location": location,
                    "salary": salary_match.group(0) if salary_match else "",
                    "posted_at": posted_at,
                    "job_type": job_type,
                    "source_url": detail_url,
                },
                "detail_url": detail_url,
                "evidence": {
                    "title": _evidence_for(container_text, title),
                    "location": _evidence_for(container_text, location) if location else "",
                    "salary": salary_match.group(0) if salary_match else "",
                },
                "summary": summary_of(container_text),
            }
        )
    return rows


def rows_from_html_anchors(html: str, *, page_url: str, page_text: str) -> list[dict[str, Any]]:
    """兜底：页面没有可识别容器时，按「岗位形状的链接 + 链接文本」抽行。"""
    containers, anchors = list_containers(html)
    del containers
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for href, label in anchors:
        absolute = job_href(href, base_url=page_url)
        if not absolute or absolute in seen:
            continue
        if not looks_like_job_href(absolute):
            continue
        title = label.strip()
        if not (2 <= len(title) <= 60) or _BAD_TITLE_RE.match(title):
            continue
        seen.add(absolute)
        rows.append(
            {
                "data": {"title": title, "source_url": absolute},
                "anchor_fallback": True,
                "detail_url": absolute,
                "evidence": {"title": title},
                "summary": title,
            }
        )
    return rows


def extract_rules(page: Any) -> list[dict[str, Any]]:
    """规则层入口：返回原始行 dict 列表（空列表 = 没命中，交给模型层）。"""
    page_url = str(getattr(page, "url", "") or "")
    page_text = str(getattr(page, "text", "") or "")
    html = str(getattr(page, "html", "") or "")
    payloads = list(getattr(page, "json_payloads", []) or [])
    rows: list[dict[str, Any]] = []
    if payloads:
        rows.extend(rows_from_json_payloads(payloads, page_url=page_url, page_text=page_text))
    if html:
        rows.extend(
            rows_from_json_payloads(
                embedded_json_payloads(html), page_url=page_url, page_text=page_text
            )
        )
        if not rows:
            rows.extend(rows_from_html_containers(html, page_url=page_url, page_text=page_text))
        if not rows:
            rows.extend(rows_from_html_anchors(html, page_url=page_url, page_text=page_text))
    return _dedupe(rows)


def _dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for row in rows:
        data = row.get("data") or {}
        key = row.get("detail_url") or f"{data.get('title', '')}|{data.get('company', '')}"
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


__all__ = [
    "extract_rules",
    "job_href",
    "looks_like_job_href",
    "rows_from_html_anchors",
    "rows_from_html_containers",
    "rows_from_json",
    "rows_from_json_payloads",
]

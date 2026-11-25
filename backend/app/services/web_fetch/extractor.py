# SPDX-License-Identifier: Apache-2.0
"""抽取编排：规则层优先、模型层兜底，统一产出 ExtractedRow（#16B / #17A-E）。

两阶段导入的两个入口都收在这里：

- extract_rows：列表页 → 多行（8 个列表字段 + 详情链接 + 四态），供预览勾选；
- extract_detail：详情页 → description / requirements / additional_info / status（17A 阶段二），
  逐条调用、单条失败由调用方标 fetch_failed，不影响整批。

本地规则与模型兜底的分工：规则层先从 JSON / JSON-LD / 重复容器里抽；一条都没有且配了
模型时才调模型（输入裁剪 30k、字段必须有原文依据）。模型不可用（未配置/失败）时**如实
降级为规则结果**并在 warnings 里说明，不假装抓到。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .errors import WebExtractError
from .extract_rules import extract_rules, job_href, looks_like_job_href, looks_like_nav_label
from .extractor_model import model_extract_detail, model_extract_list
from .field_rules import (
    FILLED,
    heading_kind,
    infer_job_type,
    infer_status,
)
from .jd_sections import (  # DetailResult / trim_detail_text 为历史导入路径再导出
    LABELED_RE,
    DetailResult,
    jd_total_len,
    local_detail,
    split_lines,
    title_neighborhood,
    trim_detail_text,
)
from .page_intent import classify_page_intent, navigation_only, page_heading
from .platform_adapters import platform_detail_fields
from .row import ExtractedRow

#: 列表页一次最多接受多少条（16E 硬上限 200）。
MAX_ROWS = 200
NAVIGATION_ONLY_WARNING = "页面仅识别到导航链接，未找到岗位信息；可按单条详情重新抓取"
#: 只有一条「无详情链接 + 四个字段全空」的行：抓到的是站点配置/导航对象，不是岗位。
#: 宁可报没识别到，也不能把假行塞进岗位库（CR-30）。
DETAIL_ONLY_WARNING = "这一页像岗位详情，但没有识别到岗位信息；可点「按单条详情重新抓取」"
#: 详情页正文短于此长度时，本地规则不敢当 JD，交给模型兜底（或如实留空）。
MIN_DETAIL_CHARS = 200
#: 结构证据：class 含 title / position_name 的元素文本（美团是 ``.postion_name .title``，
#: 站点自己的拼写，别改）。
_STRUCTURAL_TITLE_RE = re.compile(
    r"""class=["'][^"']*(?:job[-_]?title|position[-_]?name|postion[-_]?name|job[-_]?name|title)"""
    r"""[^"']*["'][^>]*>\s*([^<>]{2,128}?)\s*<""",
    re.I,
)
#: 详情页元信息标签：标题元素总在它们上面，用它们定位「标题区」的右边界。
_META_LABEL_RE = re.compile(r"工作地点|更新时间|发布时间|职位描述|岗位职责|任职要求")
#: 判断「假行」用的四个字段（有任何一个就说明确实读到了岗位信息）。
_GATE_FIELDS = ("company", "location", "salary", "posted_at")
#: 站点/频道名被当成岗位标题时的兜底（与岗位标题词表分开：真岗位不会叫「招聘官网」）。
_SITE_LABEL_RE = re.compile(r"^(?:招聘官网|官网|人才招聘|校园招聘|社会招聘|职位列表|岗位列表)$")
_DATE_SUFFIX_RE = re.compile(r"招聘|官网|校园|社会|职位|岗位|首页|网申|_+.*$")


@dataclass
class ExtractionResult:
    """一次抽取的结果与如实说明。"""

    rows: list[ExtractedRow] = field(default_factory=list)
    #: rules / model / none：本次结果来自哪一层（证据与用户提示都要如实说明）。
    method: str = "none"
    warnings: list[str] = field(default_factory=list)


def _fetched_on(page: Any) -> str:
    value = str(getattr(page, "fetched_on", "") or "").strip()
    try:
        date.fromisoformat(value)
    except ValueError:
        return date.today().isoformat()
    return value


def _page_url(page: Any) -> str:
    return str(getattr(page, "url", "") or "")


def _page_text(page: Any) -> str:
    return str(getattr(page, "text", "") or "")


def _build_row(raw: dict[str, Any], *, page: Any) -> ExtractedRow | None:
    data = {
        key: str(value or "")
        for key, value in (raw.get("data") or {}).items()
        if isinstance(value, str)
    }
    title = (data.get("title") or "").strip()
    if not title:
        return None
    page_url = _page_url(page)
    candidate_detail = str(raw.get("detail_url") or "").strip()
    if not candidate_detail:
        source_url = (data.get("source_url") or "").strip()
        if source_url:
            candidate_detail = job_href(source_url, base_url=page_url)
    # 列表页自身不是详情页：只有「看起来像岗位详情」的链接才作为 detail_url，
    # 否则详情阶段会把列表页当详情页抓一遍。
    if candidate_detail and (
        candidate_detail == page_url or not looks_like_job_href(candidate_detail)
    ):
        candidate_detail = ""
    row = ExtractedRow.build(
        data,
        page_url=page_url,
        page_text=_page_text(page),
        fetched_on=_fetched_on(page),
        detail_url=candidate_detail,
        evidence={
            key: str(value)[:160] for key, value in (raw.get("evidence") or {}).items() if value
        },
        summary=str(raw.get("summary") or ""),
        posted_at_raw=str(raw.get("posted_at_raw") or data.get("posted_at") or ""),
        require_detail=bool(candidate_detail) and bool(raw.get("require_detail", True)),
    )
    if raw.get("job_type_inferred") is not None:
        row.job_type_inferred = bool(raw.get("job_type_inferred"))
    return row


def _structural_title(html: str) -> str:
    """从详情页结构里取岗位名：只看「元信息标签之前」那一段里最近的标题元素。

    只看元信息之前，是为了避开页脚/推荐位里的 ``class="title"``；从后往前取，是因为
    离「工作地点：」最近的标题元素才是岗位名（更上面的通常是站点名/频道名）。
    没有元信息标签时退回整页前 6000 字符——总比拿导航第一项当标题好。
    """
    text = str(html or "")
    if not text:
        return ""
    marker = _META_LABEL_RE.search(text)
    window = text[max(0, marker.start() - 6000) : marker.start()] if marker else text[:6000]
    candidates = [match.group(1).strip() for match in _STRUCTURAL_TITLE_RE.finditer(window)]
    for candidate in reversed(candidates):
        if len(candidate) > 128 or looks_like_nav_label(candidate):
            continue
        return candidate
    return ""


def _title_from_page(page: Any, *, fallback: str = "") -> str:
    """详情页兜底标题：h1 → 结构证据 → 标签文本 → URL 末段。"""
    heading = page_heading(page)
    if heading:
        return heading
    structured = _structural_title(str(getattr(page, "html", "") or ""))
    if structured:
        return structured
    text = _page_text(page)
    lines = split_lines(text)
    for index, line in enumerate(lines[:40]):
        labeled = re.match(r"(?:职位名称|岗位名称)\s*[:：]\s*(.+)", line)
        if labeled:
            return labeled.group(1).strip()[:128]
        if index and LABELED_RE["location"].match(line):
            candidate = lines[index - 1].strip()
            if (
                2 <= len(candidate) <= 128
                and not re.search(r"[:：]", candidate)
                and not looks_like_nav_label(candidate)
                and candidate not in {"职位列表", "岗位列表", "职位详情", "岗位详情"}
            ):
                return candidate
    if fallback:
        return fallback
    for line in lines[:8]:
        candidate = line.strip()
        if (
            2 <= len(candidate) <= 128
            and not re.search(r"[:：]$", candidate)
            and not looks_like_nav_label(candidate)
        ):
            return candidate
    path = _page_url(page).rstrip("/").rsplit("/", 1)[-1]
    cleaned = _DATE_SUFFIX_RE.sub("", path).replace("-", " ").replace("_", " ").strip()
    return cleaned[:128]


def _title_neighborhood(page: Any, title: str) -> str:
    """页面文本 → 标题邻域证据（纯文本实现见 ``jd_sections.title_neighborhood``）。"""
    return title_neighborhood(_page_text(page), title)


def _single_row_without_evidence(rows: list[ExtractedRow]) -> bool:
    """只有一行、四个字段全空，且没有详情链接（或标题就是站点名）——不是岗位。

    真实岗位至少会带一个（地点/公司/薪资/发布时间），或者带一条详情链接；
    两者都没有的单行不可能是岗位，宁可判「没识别到」。
    """
    if len(rows) != 1:
        return False
    row = rows[0]
    if any(str(row.data.get(key) or "").strip() for key in _GATE_FIELDS):
        return False
    return not row.detail_url or bool(_SITE_LABEL_RE.match(row.title))


def extract_rules_result(page: Any, *, limit: int = MAX_ROWS) -> ExtractionResult:
    """同步的规则层抽取（工具提案预览用：写入预览是同步回调，不能 await 模型）。

    只做规则层，不调用模型——提案卡上的"将导入 N 条 + 标题"必须快速返回，不能为了
    预览先跑一次模型。
    """
    result = ExtractionResult()
    capped_limit = max(1, min(int(limit or MAX_ROWS), MAX_ROWS))
    raw_rows = extract_rules(page)
    if navigation_only(raw_rows):
        result.warnings.append(NAVIGATION_ONLY_WARNING)
        return result
    if raw_rows:
        result.method = "rules"
    rows: list[ExtractedRow] = []
    for raw in raw_rows[:capped_limit]:
        row = _build_row(raw, page=page)
        if row is not None:
            rows.append(row)
    if len(raw_rows) > capped_limit:
        result.warnings.append(f"这一页共 {len(raw_rows)} 条，本次最多导入 {capped_limit} 条")
    gated = _single_row_without_evidence(rows)
    if gated:
        rows = []
        result.method = "none"
        result.warnings.append(DETAIL_ONLY_WARNING)
    if not rows and not gated:
        result.warnings.append("没有从这一页识别出岗位列表")
        result.method = "none"
    result.rows = rows
    return result


async def extract_rows(
    page: Any,
    *,
    provider: Any = None,
    intent: str = "auto",
    limit: int = MAX_ROWS,
) -> ExtractionResult:
    """抽取一页岗位；intent 决定按列表还是单条详情处理。"""
    result = ExtractionResult()
    capped_limit = max(1, min(int(limit or MAX_ROWS), MAX_ROWS))
    raw_rows = extract_rules(page)
    if raw_rows:
        result.method = "rules"
    effective_intent = classify_page_intent(page) if intent == "auto" else intent
    if effective_intent == "job_detail":
        return await _extract_single_detail(page, raw_rows, provider=provider, result=result)
    if navigation_only(raw_rows):
        result.method = "none"
        result.warnings.append(NAVIGATION_ONLY_WARNING)
        return result
    if not raw_rows and provider is not None:
        try:
            raw_rows = await model_extract_list(provider, page)
            result.method = "model"
        except WebExtractError as exc:
            result.warnings.append(str(exc))
    rows: list[ExtractedRow] = []
    for raw in raw_rows[:capped_limit]:
        row = _build_row(raw, page=page)
        if row is not None:
            rows.append(row)
    if len(raw_rows) > capped_limit:
        result.warnings.append(f"这一页共 {len(raw_rows)} 条，本次最多导入 {capped_limit} 条")
    gated = _single_row_without_evidence(rows)
    if gated:
        rows = []
        result.method = "none"
        result.warnings.append(DETAIL_ONLY_WARNING)
    if not rows and not gated:
        result.warnings.append(
            "没有从这一页识别出岗位列表；如果页面需要登录或由脚本渲染，可改用浏览器引擎再试"
        )
        result.method = "none"
    result.rows = rows
    return result


async def _extract_single_detail(
    page: Any, raw_rows: list[dict[str, Any]], *, provider: Any, result: ExtractionResult
) -> ExtractionResult:
    """单条详情页：规则行优先，否则用页面自身构造一条（标题 + 页面 URL）。"""
    base: ExtractedRow | None = None
    page_url = _page_url(page)
    candidates = [
        raw
        for raw in raw_rows
        if str(raw.get("detail_url") or (raw.get("data") or {}).get("source_url") or "") == page_url
    ]
    for raw in candidates[:1]:
        base = _build_row(raw, page=page)
        if base is not None:
            break
    if base is None:
        page_url = _page_url(page)
        base = ExtractedRow.build(
            {"title": _title_from_page(page), "source_url": page_url},
            page_url=page_url,
            page_text=_page_text(page),
            fetched_on=_fetched_on(page),
            detail_url=page_url,
            require_detail=False,
        )
        result.method = result.method if raw_rows else "none"
    # A same-URL anchor can still be a navigation label; structural title evidence wins.
    base.data["title"] = _title_from_page(page, fallback=base.title)
    # CR-39：岗位类型按「页面明确标签（标题附近行）> URL 频道 > 其他」推断。页面证据存在
    # 时不算「推断」；列表页不经过这里，行为不变（回归见 test_web_import_detail_job_type）。
    current_type = (base.data.get("job_type") or "").strip()
    if not current_type or current_type == "其他" or base.job_type_inferred:
        job_type, job_type_inferred = infer_job_type(
            page_url=_page_url(page), text=_title_neighborhood(page, base.title)
        )
        base.data["job_type"] = job_type
        base.job_type_inferred = job_type_inferred
    detail = await extract_detail(page, provider=provider)
    base.apply_detail(
        detail.fields,
        page_url=_page_url(page),
        page_text=_page_text(page),
        fetched_on=_fetched_on(page),
        evidence=detail.evidence,
        jd_split=detail.jd_split,
    )
    if detail.fields.get("status"):
        base.field_states["status"] = FILLED
    result.rows = [base]
    if result.method == "none" and detail.fields.get("description"):
        result.method = "rules"
    result.warnings.extend(detail.warnings)
    return result


async def extract_detail(page: Any, *, provider: Any = None) -> DetailResult:
    """抽一条详情：本地规则优先；正文太短/没有小标题且配了模型时用模型兜底。"""
    text = _page_text(page)
    local, has_heading = local_detail(text)
    # R-15 B：平台详情页优先用平台容器取正文（通用规则会把导航/相似岗位混进来）。
    platform, platform_fields = platform_detail_fields(
        getattr(page, "url", ""), getattr(page, "html", "")
    )
    if platform_fields.get("description"):
        merged = {**local.fields, **platform_fields}
        local.fields = merged
        local.platform = platform
        local.evidence["description"] = "平台适配器"
        return local
    needs_model = provider is not None and (
        jd_total_len(local.fields) < MIN_DETAIL_CHARS and not has_heading
    )
    if needs_model:
        try:
            fields, evidence = await model_extract_detail(provider, page)
        except WebExtractError as exc:
            local.warnings.append(str(exc))
            return local
        merged = dict(local.fields)
        merged.update(fields)
        if not merged.get("description"):
            merged["description"] = local.fields.get("description", "")
        merged["status"] = merged.get("status") or infer_status(text)
        local.fields = merged
        local.evidence.update(evidence)
        local.jd_split = bool(
            local.jd_split or any(heading_kind(line) for line in split_lines(text))
        )
        return local
    if jd_total_len(local.fields) < MIN_DETAIL_CHARS and provider is None:
        local.warnings.append("页面正文没有识别出完整的岗位描述，可改用模型抽取或手动补全")
    return local


__all__ = [
    "DetailResult",
    "ExtractionResult",
    "MAX_ROWS",
    "MIN_DETAIL_CHARS",
    "extract_detail",
    "extract_rows",
    "extract_rules_result",
    "trim_detail_text",
]

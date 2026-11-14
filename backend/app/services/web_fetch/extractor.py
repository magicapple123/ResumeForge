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
from .extract_rules import extract_rules, job_href, looks_like_job_href
from .extractor_model import model_extract_detail, model_extract_list
from .field_rules import (
    FILLED,
    clip_field,
    heading_kind,
    infer_status,
    split_jd_sections,
)
from .page_intent import classify_page_intent, navigation_only, page_heading
from .platform_adapters import platform_detail_fields
from .row import ExtractedRow

#: 列表页一次最多接受多少条（16E 硬上限 200）。
MAX_ROWS = 200
NAVIGATION_ONLY_WARNING = "页面仅识别到导航链接，未找到岗位信息；可按单条详情重新抓取"
#: 详情页正文短于此长度时，本地规则不敢当 JD，交给模型兜底（或如实留空）。
MIN_DETAIL_CHARS = 200
#: 详情页正文里的「正文结束」标记：命中后不再往下读（相关推荐/页脚噪声）。
_DETAIL_STOP_MARKERS = (
    "相似职位",
    "相关推荐",
    "推荐职位",
    "热门职位",
    "猜你喜欢",
    "看过该职位的人还看了",
    "投递该职位",
    "立即投递",
    "申请职位",
    "分享到",
    "举报该职位",
    "公司信息",
    "工商信息",
    "注册协议",
    "隐私协议",
    "Copyright ©",
    "ICP备",
)
_LABELED_FIELDS = {
    "company": r"(?:公司名称|公司全称|企业名称|公司)\s*[:：]\s*([^\n]{1,64})",
    "location": r"(?:工作地点|工作城市|办公地点|职位地点|地点)\s*[:：]\s*([^\n]{1,64})",
    "salary": r"(?:薪资范围|薪酬范围|薪资|月薪|年薪)\s*[:：]\s*([^\n]{1,64})",
    "posted_at": r"(?:发布时间|发布日期|更新时间|上线时间)\s*[:：]\s*([^\n]{1,64})",
}
_LABELED_RE = {field: re.compile(pattern) for field, pattern in _LABELED_FIELDS.items()}
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


def _title_from_page(page: Any, *, fallback: str = "") -> str:
    """详情页兜底标题：优先页面第一行像岗位名的文本，其次 URL 末段。"""
    heading = page_heading(page)
    if heading:
        return heading
    text = _page_text(page)
    lines = split_lines(text)
    for index, line in enumerate(lines[:40]):
        labeled = re.match(r"(?:职位名称|岗位名称)\s*[:：]\s*(.+)", line)
        if labeled:
            return labeled.group(1).strip()[:128]
        if index and _LABELED_RE["location"].match(line):
            candidate = lines[index - 1].strip()
            if (
                2 <= len(candidate) <= 128
                and not re.search(r"[:：]", candidate)
                and candidate not in {"职位列表", "岗位列表", "职位详情", "岗位详情"}
            ):
                return candidate
    if fallback:
        return fallback
    for line in lines[:8]:
        candidate = line.strip()
        if 2 <= len(candidate) <= 128 and not re.search(r"[:：]$", candidate):
            return candidate
    path = _page_url(page).rstrip("/").rsplit("/", 1)[-1]
    cleaned = _DATE_SUFFIX_RE.sub("", path).replace("-", " ").replace("_", " ").strip()
    return cleaned[:128]


def split_lines(text: str) -> list[str]:
    return [line for line in (text or "").splitlines() if line.strip()]


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
    if not rows:
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
    if not rows:
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


@dataclass
class DetailResult:
    fields: dict[str, str] = field(default_factory=dict)
    evidence: dict[str, str] = field(default_factory=dict)
    jd_split: bool = False
    warnings: list[str] = field(default_factory=list)
    #: 平台适配器认出来的 ATS 名（R-15 B：greenhouse / lever / workday）；空串 = 通用路径。
    platform: str = ""


def trim_detail_text(text: str) -> str:
    """截出详情页的「正文部分」：从第一个 JD 小标题附近开始，遇到相关推荐/页脚截止。"""
    lines = split_lines(text)
    if not lines:
        return ""
    start = 0
    for index, line in enumerate(lines):
        if heading_kind(line):
            start = max(0, index - 4)
            break
    end = len(lines)
    for index in range(start, len(lines)):
        if any(marker in lines[index] for marker in _DETAIL_STOP_MARKERS):
            end = index
            break
    return "\n".join(lines[start:end]).strip()


def _labeled_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for name, pattern in _LABELED_RE.items():
        match = pattern.search(text or "")
        if match:
            values[name] = clip_field(name, match.group(1).strip())
    return values


def _local_detail(text: str) -> tuple[DetailResult, bool]:
    """本地规则抽详情：切分 JD + 标签字段 + 状态。返回 (结果, 是否找到小标题)。"""
    content = trim_detail_text(text)
    result = DetailResult()
    if not content:
        return result, False
    split = split_jd_sections(content)
    has_heading = bool(split["split"]) or any(heading_kind(line) for line in split_lines(content))
    # 四个详情字段永远有键：空字符串 = 页面未提供（17B 的 not_on_page），
    # 不用「键缺失」表达缺失，避免调用方把没抓到当没这个字段。
    fields: dict[str, str] = {
        "description": str(split["description"]).strip(),
        "requirements": str(split["requirements"]).strip(),
        "additional_info": str(split["additional_info"]).strip(),
        "status": infer_status(text),
    }
    fields.update(_labeled_values(text))
    result.fields = fields
    result.jd_split = bool(split["split"])
    result.evidence = {name: value[:160] for name, value in fields.items() if value}
    return result, has_heading


async def extract_detail(page: Any, *, provider: Any = None) -> DetailResult:
    """抽一条详情：本地规则优先；正文太短/没有小标题且配了模型时用模型兜底。"""
    text = _page_text(page)
    local, has_heading = _local_detail(text)
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
        len(str(local.fields.get("description", ""))) < MIN_DETAIL_CHARS and not has_heading
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
    if len(str(local.fields.get("description", ""))) < MIN_DETAIL_CHARS and provider is None:
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

# SPDX-License-Identifier: Apache-2.0
"""链接抓取助手工具（#16D）：web_extract 只读 + import_jobs_from_url 写（走提案卡）。

工具描述里写死了三条（否则模型会继续用搜索结果猜）：

1. 抓不到就如实说抓不到，**禁止**退回「搜索结果推测」；
2. 不得编造页面上没有的岗位、薪资、届别；
3. 结果默认进岗位广场，不自动投递、不入队。

行为边界：只读取用户明确给出的那一个 URL，不自作主张遍历站内其他页面；抓取失败把
原因作为工具结果回给模型（它应当如实转述），不抛异常中断整轮对话。

写工具只做「列表 1 次 + 落库」：详情补全在产品里是岗位广场的两阶段导入（#17A），
一次工具调用里再补 N 次详情会让模型等待几十秒；超过 20 条也超出一次调用的合理范围。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from ..web_fetch.errors import WebExtractError, WebFetchError
from ..web_fetch.fetcher import FetchConfig, JobFetcher
from ..web_fetch.import_service import (
    MAX_LIST_PAGES,
    MAX_PREVIEW_ROWS,
    commit_rows,
    preview_from_url,
    preview_rules_from_url,
)
from ..web_fetch.url_policy import UrlRejected
from ._types import ToolResult
from .authorization import FieldChange, WritePreview

logger = logging.getLogger(__name__)

#: 助手一次最多导入多少条（16E：>20 条转后台任务，工具内不做）。
MAX_TOOL_IMPORT_ROWS = 20
#: web_extract 返回给模型的原文摘要长度（条数多时不至于撑爆上下文）。
EXTRACT_SUMMARY_CHARS = 120
#: 只读工具对 company/page 意图返回的正文长度。
RAW_TEXT_PREVIEW_CHARS = 2_000
#: 提案卡最多列出多少条明细（其余折叠成一句）。
PROPOSAL_DETAIL_ROWS = 10

_FETCH_FAILED_HINT = (
    "抓不到这个链接的内容。请如实告诉用户「抓不到」并说明原因，"
    "禁止改用搜索结果推测页面上的岗位、薪资或届别。"
)


def _parse_url(arguments: dict[str, Any]) -> str:
    url = str(arguments.get("url") or "").strip()
    if not url:
        raise ValueError("需要提供要抓取的链接 url")
    return url


def _parse_pages(arguments: dict[str, Any], *, default: int = 1) -> int:
    """解析模型给的 pages：缺省/非法值按 1 页；范围夹在 1–MAX_LIST_PAGES。"""
    raw = arguments.get("pages")
    if raw is None or isinstance(raw, bool):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, MAX_LIST_PAGES))


def _pagination_note(preview: dict[str, Any]) -> str:
    """把 pages_fetched/truncated/stop_reason 转成给模型/用户看的一句如实说明。"""
    fetched = int(preview.get("pages_fetched") or 1)
    requested = int(preview.get("pages_requested") or 1)
    stop_reason = str(preview.get("stop_reason") or "no_next")
    if stop_reason == "no_next":
        if requested > 1 and fetched <= 1:
            return "页面没有「下一页」链接，只抓了当前页"
        return f"共抓取 {fetched} 页（页面没有更多下一页）"
    if stop_reason == "limit":
        return f"已抓取 {fetched}/{requested} 页；达到页数上限，后面还有页面未抓取"
    if stop_reason == "http_error":
        return f"抓取中途失败，已保留前 {fetched} 页（未抓取后续页）"
    if stop_reason == "rejected":
        return f"下一页未通过安全校验，已保留前 {fetched} 页并停止翻页"
    return f"共抓取 {fetched} 页"


def _parse_limit(arguments: dict[str, Any], *, default: int) -> int:
    raw = arguments.get("limit")
    if raw is None or isinstance(raw, bool):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, MAX_PREVIEW_ROWS))


def _filters_of(arguments: dict[str, Any]) -> dict[str, str]:
    raw = arguments.get("filters")
    if not isinstance(raw, dict):
        return {}
    return {str(key): str(value).strip() for key, value in raw.items() if str(value or "").strip()}


def _row_matches(row: dict[str, Any], filters: dict[str, str]) -> bool:
    """过滤（filters）只做「页面已抓到的行内匹配」，不把筛选维度拼成职位名。"""
    data = row.get("data") or {}
    haystack = " ".join(str(value) for value in data.values())
    return all(value in haystack for value in filters.values())


def _row_line(row: dict[str, Any], *, index: int) -> str:
    data = row.get("data") or {}
    parts = [str(data.get(key) or "").strip() for key in ("title", "company", "location", "salary")]
    detail = row.get("detail_url") or data.get("source_url") or ""
    summary = str(row.get("summary") or "")[:EXTRACT_SUMMARY_CHARS]
    tail = f"｜摘要：{summary}" if summary else ""
    return f"{index}. " + " | ".join(part for part in parts if part) + f"｜{detail}{tail}"


def _clip_text(value: str, *, limit: int = 160) -> str:
    """把说明文本折成单行并截断（提案卡一行放不下整段抓取告警）。"""
    return " ".join(str(value or "").split())[:limit]


def _rows_text(rows: list[dict[str, Any]], *, limit: int = MAX_TOOL_IMPORT_ROWS) -> str:
    lines = [_row_line(row, index=index + 1) for index, row in enumerate(rows[:limit])]
    if len(rows) > limit:
        lines.append(f"……其余 {len(rows) - limit} 条未列出")
    return "\n".join(lines)


async def _tool_web_extract(db: Session, arguments: dict[str, Any]) -> ToolResult:
    """只读抓取：返回内容 + 条数 + 原文摘要，不写库。"""
    url = _parse_url(arguments)
    intent = str(arguments.get("intent") or "job_list")
    if intent not in {"job_list", "job_detail", "company", "page"}:
        intent = "job_list"
    limit = _parse_limit(arguments, default=MAX_TOOL_IMPORT_ROWS)
    pages = _parse_pages(arguments)
    try:
        if intent in {"company", "page"}:
            # 公司主页/任意网页：只读正文，不做岗位抽取（16G 的后两类）。
            fetcher = JobFetcher(db, config=FetchConfig(engine="auto"))
            page = fetcher.fetch(url)
            snippet = (page.text or "")[:RAW_TEXT_PREVIEW_CHARS]
            return ToolResult(
                text=(
                    f"页面已读取（{page.engine} 引擎，{page.content_type}，抓取日 {page.fetched_on}）。"
                    f"正文前 {len(snippet)} 字如下，仅供阅读，未写入任何数据：\n{snippet}"
                ),
                summary=f"读取网页正文（{page.engine} 引擎）",
                link=page.url,
            )
        preview = await preview_from_url(db, url, limit=limit, intent=intent, pages=pages)
    except (UrlRejected, WebFetchError) as exc:
        return ToolResult(text=f"{_FETCH_FAILED_HINT}\n原因：{exc}", summary="链接抓取失败")
    except WebExtractError as exc:
        return ToolResult(text=f"页面抓到了，但内容无法解析：{exc}", summary="链接内容无法解析")
    keys = {
        "job_list": ["title", "company", "location", "salary", "posted_at"],
        "job_detail": ["title", "company", "location", "salary", "posted_at", "status"],
    }.get(intent, [])
    data = ((preview.get("rows") or [{}])[0] or {}).get("data") or {}
    if intent == "job_detail" and data:
        detail_lines = "\n".join(
            f"{key}：{data[key]}" for key in keys if str(data.get(key) or "").strip()
        )
        body = str(data.get("description") or "")[:2_000]
        return ToolResult(
            text=(
                f"已读取 1 条岗位详情（{preview.get('engine')} 引擎，抓取日 {preview.get('fetched_on')}）：\n"
                f"{detail_lines}\n岗位描述：{body}"
            ),
            summary="读取了一条岗位详情",
            link=str(preview.get("url") or url),
        )
    rows = list(preview.get("rows") or [])
    if not rows:
        return ToolResult(
            text=(
                "页面抓到了，但没有识别出岗位列表。请如实告诉用户：这一页可能不是岗位列表，"
                "或需要登录/由脚本渲染（可让用户改用岗位广场的「从链接导入」并选浏览器引擎）。"
            ),
            summary="没有识别出岗位列表",
        )
    header = (
        f"这次共抓取 {preview.get('pages_fetched')} 页、约 {len(rows)} 条岗位"
        f"（{preview.get('engine')} 引擎，抽取方式：{preview.get('method')}，"
        f"抓取日 {preview.get('fetched_on')}）。{_pagination_note(preview)}。"
        f"前 {min(len(rows), MAX_TOOL_IMPORT_ROWS)} 条如下："
    )
    warnings = "；".join(preview.get("warnings") or [])
    tail = f"\n注意：{warnings}" if warnings else ""
    return ToolResult(
        text=header + "\n" + _rows_text(rows) + tail,
        summary=f"读取链接：{len(rows)} 条岗位",
        link=str(preview.get("url") or url),
    )


def _filter_rows(rows: list[dict[str, Any]], filters: dict[str, str]) -> list[dict[str, Any]]:
    if not filters:
        return rows
    return [row for row in rows if _row_matches(row, filters)]


async def _tool_import_jobs_from_url(db: Session, arguments: dict[str, Any]) -> ToolResult:
    """写工具（提案批准后执行）：抓列表 → 抽取 → 落库（去重交给 find_job_by_identity）。"""
    url = _parse_url(arguments)
    limit = _parse_limit(arguments, default=MAX_TOOL_IMPORT_ROWS)
    pages = _parse_pages(arguments)
    filters = _filters_of(arguments)
    if limit > MAX_TOOL_IMPORT_ROWS:
        return ToolResult(
            text=(
                f"一次最多导入 {MAX_TOOL_IMPORT_ROWS} 条。超过 {MAX_TOOL_IMPORT_ROWS} 条请分批导入，"
                "或让用户使用岗位广场的「从链接导入」（支持两阶段补详情与分批进度）。"
            ),
            summary="导入条数超过单次上限",
        )
    try:
        preview = await preview_from_url(db, url, limit=limit, pages=pages)
    except (UrlRejected, WebFetchError) as exc:
        return ToolResult(text=f"{_FETCH_FAILED_HINT}\n原因：{exc}", summary="链接抓取失败")
    except WebExtractError as exc:
        return ToolResult(text=f"页面抓到了，但内容无法解析：{exc}", summary="链接内容无法解析")
    rows = _filter_rows(list(preview.get("rows") or []), filters)
    if not rows:
        return ToolResult(
            text="页面抓到了，但没有可导入的岗位（或没有符合筛选条件的岗位）。请如实告诉用户。",
            summary="没有可导入的岗位",
        )
    outcome = commit_rows(db, rows)
    imported = int(outcome.get("imported") or 0)
    skipped = len(outcome.get("skipped") or [])
    failed = len(outcome.get("failed") or [])
    detail = f"导入 {imported} 条，跳过 {skipped} 条（已在库），失败 {failed} 条。"
    pagination = _pagination_note(preview)
    return ToolResult(
        text=(
            f"已从链接导入到岗位广场：{detail}本次{pagination}。"
            "岗位只进入岗位广场，没有自动投递、也没有入队；详情字段可在岗位广场的"
            "「从链接导入」里补全。"
        ),
        summary=f"从链接导入 {imported} 条岗位",
        link=str(preview.get("url") or url),
        changed=imported > 0,
    )


def preview_import_jobs_from_url(db: Session, arguments: dict[str, Any]) -> WritePreview:
    """写工具提案卡：抓列表并列出「将导入 N 条 + 每条标题/公司/摘要」。

    预览只走规则层（同步、不跑模型），保证提案卡快速返回；异常由执行层转成
    "工具执行失败"，模型会如实转述抓不到。
    """
    url = _parse_url(arguments)
    limit = min(_parse_limit(arguments, default=MAX_TOOL_IMPORT_ROWS), MAX_TOOL_IMPORT_ROWS)
    pages = _parse_pages(arguments)
    filters = _filters_of(arguments)
    extracted, batch, warnings = preview_rules_from_url(
        db, url, engine="auto", pages=pages, limit=limit
    )
    rows = _filter_rows([row.to_dict() for row in extracted], filters)
    changes: list[FieldChange] = []
    for index, row in enumerate(rows[:PROPOSAL_DETAIL_ROWS], start=1):
        data = row.get("data") or {}
        summary = str(row.get("summary") or "")[:80]
        changes.append(
            FieldChange(
                field=f"岗位 {index}",
                before=None,
                after=f"{data.get('title') or '未命名'}｜{data.get('company') or '公司未知'}｜{summary}",
            )
        )
    if len(rows) > PROPOSAL_DETAIL_ROWS:
        changes.append(
            FieldChange(
                field="其余",
                before=None,
                after=f"还有 {len(rows) - PROPOSAL_DETAIL_ROWS} 条未在卡片中列出",
            )
        )
    pagination = _pagination_note(
        {
            "pages_fetched": batch.pages_fetched,
            "pages_requested": pages,
            "stop_reason": batch.stop_reason,
        }
    )
    if warnings or batch.truncated:
        # 提案卡也要如实说明「只抓了前几页 / 中途失败」：确认前就该看到。
        changes.append(
            FieldChange(
                field="抓取说明", before=None, after=_clip_text("；".join(warnings) or pagination)
            )
        )
    first = batch.first
    page_url = first.url if first is not None else url
    host = page_url.split("/", 3)[2] if "://" in page_url else page_url
    target = f"将导入 {len(rows)} 条岗位（{host}；{pagination}）"
    if not rows:
        target = f"没有从 {host} 识别出可导入的岗位（{pagination}）"
    return WritePreview(target=target[:120], scope="岗位广场", changes=changes)


__all__ = [
    "MAX_TOOL_IMPORT_ROWS",
    "_tool_import_jobs_from_url",
    "_tool_web_extract",
    "preview_import_jobs_from_url",
]

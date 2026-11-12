# SPDX-License-Identifier: Apache-2.0
"""从链接导入岗位的服务层（#16B/C/D/E + #17A-F）。

三个动作对应两阶段导入：

- preview_from_url：抓列表页 → 抽取 → 标「已在库」（不落库）；
- fetch_details：对勾选的行（每批 ≤5 条，单任务 ≤10 页预算）逐条补详情，
  逐条容错：单条失败标 fetch_failed，不拖垮整批；
- commit_rows：把（补过详情的）行落库，去重交给 find_job_by_identity；
  已存在的行支持「仅补空字段」——只写库内为空的字段，**不覆盖** note/note_images/
  favorite 与用户已填内容。

这里是 API 路由与助手工具共用的唯一写库入口，两边不各写一份导入逻辑。
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ...models.job import Job
from ...schemas.job import RECOGNITION_SOURCE_OFFICIAL, JobCreate
from ..job.job_csv import row_to_payload
from ..job.job_service import create_job_record, find_job_by_identity, refresh_job_keywords
from .errors import WebFetchError
from .extractor import MAX_ROWS, extract_detail, extract_rows, extract_rules_result
from .fetcher import FetchConfig, FetchedPages, JobFetcher
from .row import ExtractedRow

logger = logging.getLogger(__name__)

#: 补详情每批最多几条：同域 ≥2s 的限制下，5 条约 8–10 秒，前端可以带进度等。
DETAIL_BATCH_LIMIT = 5
#: 列表阶段一次最多翻几页（与 fetcher 的 10 页硬上限一致）。
MAX_LIST_PAGES = 10
#: 硬上限：一次预览最多 200 条（16E）。
MAX_PREVIEW_ROWS = MAX_ROWS
#: 「仅补空字段」允许补的字段。note/note_images/favorite 与用户私有内容**永不**在列。
FILLABLE_FIELDS = (
    "company",
    "location",
    "salary",
    "job_type",
    "status",
    "source_url",
    "posted_at",
    "description",
    "requirements",
    "additional_info",
    "origin_source",
)


def provider_for(db: Session) -> Any:
    """当前配置可用时返回 LLM provider，否则 None（模型层只是兜底，不是前提）。"""
    if db is None:  # 离线测试（不碰 DB 的抓取/抽取）不读配置。
        return None
    from ..llm import create_provider
    from ..settings_service import get_llm_config
    from ..text_extraction import llm_is_configured

    try:
        config = get_llm_config(db)
    except Exception:  # noqa: BLE001 - 配置读取失败按"没有模型"处理，不影响规则层
        logger.warning("读取模型配置失败，链接抽取将只用规则层", exc_info=True)
        return None
    return create_provider(config) if llm_is_configured(config) else None


def _engine_config(engine: str) -> FetchConfig:
    return FetchConfig(engine=engine or "auto")


def _annotate_existing(db: Session, rows: list[ExtractedRow]) -> None:
    for row in rows:
        existing = find_job_by_identity(
            db,
            title=row.title,
            company=row.data.get("company", ""),
            source_url=row.data.get("source_url") or row.detail_url,
        )
        row.existing_job_id = int(existing.id) if existing is not None else None


def _dedupe_rows(rows: list[ExtractedRow]) -> list[ExtractedRow]:
    """跨页去重：同一详情链接，或同公司同标题，只留第一次出现的那条。

    去重放在抽取之后、预览之前：跨页重复的岗位不会在表里出现两次，total 与限制
    条数也都基于去重后的集合；落库阶段仍由 find_job_by_identity 再兜一层。
    """
    seen: set[str] = set()
    unique: list[ExtractedRow] = []
    for row in rows:
        key = (
            row.detail_url or row.data.get("source_url") or ""
        ).strip() or f"{row.title}|{row.data.get('company', '')}".strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def preview_out(
    rows: list[ExtractedRow],
    *,
    url: str,
    engine: str,
    method: str,
    fetched_on: str,
    warnings: list[str],
    pages_requested: int = 1,
    pages_fetched: int = 1,
    truncated: bool = False,
    stop_reason: str = "no_next",
) -> dict[str, Any]:
    """预览响应（含分页诊断）：前端据此如实显示抓了几页 / 为什么停 / 是否还有。"""
    return {
        "url": url,
        "engine": engine,
        "method": method,
        "fetched_on": fetched_on,
        "total": len(rows),
        "rows": [row.to_dict() for row in rows],
        "warnings": warnings,
        # #16 分页（收尾任务 2）：每页都走同一套 SSRF/限速/预算；停止原因四值见 fetcher。
        "pages_requested": pages_requested,
        "pages_fetched": pages_fetched,
        "truncated": truncated,
        "stop_reason": stop_reason,
    }


def _row_cap(limit: int) -> int:
    return MAX_PREVIEW_ROWS if not limit else max(1, min(int(limit), MAX_PREVIEW_ROWS))


def _page_requested(pages: int) -> int:
    return max(1, min(int(pages or 1), MAX_LIST_PAGES))


async def preview_from_url(
    db: Session,
    url: str,
    *,
    engine: str = "auto",
    limit: int = 0,
    intent: str = "job_list",
    provider: Any = None,
    pages: int = 1,
) -> dict[str, Any]:
    """抓 1–10 页（只跟随页面声明的下一页）并把抽取结果转成预览行（不落库）。

    第 2 页起抓取失败不会回滚：已抓到的页照常抽取并返回，失败信息进 warnings，
    由 pages_fetched / truncated / stop_reason 如实说明停在哪一步。
    """
    fetcher = JobFetcher(db, config=_engine_config(engine))
    # 详情意图天然是单页：用户给的就是一条岗位详情，不跟它的「下一页」。
    requested = 1 if intent == "job_detail" else _page_requested(pages)
    batch = fetcher.fetch_pages(url, pages=requested)
    resolved = provider if provider is not None else provider_for(db)
    cap = _row_cap(limit)
    rows: list[ExtractedRow] = []
    method = "none"
    warnings = list(batch.errors)
    for page in batch.pages:
        result = await extract_rows(page, provider=resolved, intent=intent, limit=cap)
        rows.extend(result.rows)
        warnings.extend(result.warnings)
        if result.method == "model":
            method = "model"
        elif result.method == "rules" and method == "none":
            method = "rules"
    rows = _dedupe_rows(rows)
    capped = len(rows) > cap
    if capped:
        warnings.append(f"多页共 {len(rows)} 条，本次最多取 {cap} 条")
        rows = rows[:cap]
    _annotate_existing(db, rows)
    first = batch.first
    return preview_out(
        rows,
        url=first.url if first is not None else url,
        engine=first.engine if first is not None else engine,
        method=method,
        fetched_on=first.fetched_on if first is not None else "",
        warnings=warnings,
        pages_requested=requested,
        pages_fetched=batch.pages_fetched,
        truncated=batch.truncated or capped,
        stop_reason=batch.stop_reason,
    )


def preview_rules_from_url(
    db: Session,
    url: str,
    *,
    engine: str = "auto",
    pages: int = 1,
    limit: int = 0,
) -> tuple[list[ExtractedRow], FetchedPages, list[str]]:
    """同步的规则层多页预览（助手写工具提案卡用：预览回调不能 await）。

    与 preview_from_url 共用同一套翻页/去重逻辑，只是不调用模型——提案卡要快速返回。
    """
    fetcher = JobFetcher(db, config=_engine_config(engine))
    requested = _page_requested(pages)
    batch = fetcher.fetch_pages(url, pages=requested)
    cap = _row_cap(limit)
    rows: list[ExtractedRow] = []
    warnings = list(batch.errors)
    for page in batch.pages:
        result = extract_rules_result(page, limit=cap)
        rows.extend(result.rows)
        warnings.extend(result.warnings)
    rows = _dedupe_rows(rows)
    if len(rows) > cap:
        warnings.append(f"多页共 {len(rows)} 条，本次最多取 {cap} 条")
        rows = rows[:cap]
    return rows, batch, warnings


def _row_for_detail(raw: dict[str, Any], *, page_url: str) -> ExtractedRow:
    """把前端回传的行还原成 ExtractedRow（只保留已抓到的值，四态重新推导）。"""
    data = {
        key: str(value or "")
        for key, value in (raw.get("data") or {}).items()
        if isinstance(value, str)
    }
    detail_url = str(raw.get("detail_url") or "").strip()
    raw_states = raw.get("field_states")
    states: dict[str, Any] = raw_states if isinstance(raw_states, dict) else {}
    row = ExtractedRow(
        data=data,
        detail_url=detail_url,
        evidence={str(k): str(v)[:160] for k, v in (raw.get("evidence") or {}).items()},
        summary=str(raw.get("summary") or ""),
        field_states={str(k): str(v) for k, v in states.items()},
        detail_error=str(raw.get("detail_error") or ""),
        posted_at_raw=str(raw.get("posted_at_raw") or ""),
        posted_at_inferred=bool(raw.get("posted_at_inferred")),
        job_type_inferred=bool(raw.get("job_type_inferred")),
        jd_split=bool(raw.get("jd_split")),
        existing_job_id=raw.get("existing_job_id"),
    )
    if not row.field_states:
        row._refresh_states(pending_detail=bool(detail_url))
    return row


async def fetch_details(
    db: Session,
    rows: list[dict[str, Any]],
    *,
    engine: str = "auto",
    provider: Any = None,
    page_url: str = "",
) -> dict[str, Any]:
    """对勾选的行逐条补详情；单条失败标 fetch_failed，已完成的保留。"""
    if len(rows) > DETAIL_BATCH_LIMIT:
        raise ValueError(f"一次最多补 {DETAIL_BATCH_LIMIT} 条详情，请分批补齐")
    fetcher = JobFetcher(db, config=_engine_config(engine))
    resolved = provider if provider is not None else provider_for(db)
    updated: list[dict[str, Any]] = []
    warnings: list[str] = []
    for raw in rows:
        row = _row_for_detail(raw, page_url=page_url)
        # 只跟「列表页明确给出的详情链接」走：source_url 可能就是列表页自身，
        # 把它当详情页抓一遍既浪费请求，也会把列表页正文当成 JD 写进去。
        target = row.detail_url
        if not target:
            row.mark_fetch_failed("列表页没有给出详情链接，无法补详情")
            updated.append(row.to_dict())
            continue
        try:
            page = fetcher.fetch(target)
            detail = await extract_detail(page, provider=resolved)
            row.apply_detail(
                detail.fields,
                page_url=page.url,
                page_text=page.text,
                fetched_on=page.fetched_on,
                evidence=detail.evidence,
                jd_split=detail.jd_split,
            )
            warnings.extend(detail.warnings)
        except WebFetchError as exc:
            row.mark_fetch_failed(str(exc))
        except Exception:  # noqa: BLE001 - 单条失败不拖垮整批
            logger.warning("链接导入补详情失败：%s", target, exc_info=True)
            row.mark_fetch_failed("这条详情抓取失败")
        updated.append(row.to_dict())
    return {"rows": updated, "warnings": warnings}


def _origin_for(source_url: str) -> str:
    try:
        host = urlsplit(source_url).hostname or ""
    except ValueError:
        host = ""
    return host[:64]


def _clean_for_import(row: dict[str, Any]) -> dict[str, Any]:
    """把一行预览数据清洗成 JobCreate 可接受的值；非法行抛 ValueError（逐行容错）。"""
    data = {
        key: str(value or "")
        for key, value in (row.get("data") or {}).items()
        if isinstance(value, str)
    }
    payload = row_to_payload({key: data.get(key, "") for key in data})
    payload.setdefault("recognition_source", RECOGNITION_SOURCE_OFFICIAL)
    if not payload.get("origin_source"):
        payload["origin_source"] = _origin_for(str(payload.get("source_url") or ""))
    return payload


def fill_empty_fields(job: Job, payload: dict[str, Any]) -> list[str]:
    """仅把库里为空的字段补上；返回实际写入的字段名（备注/收藏永不在此列）。"""
    changed: list[str] = []
    for field in FILLABLE_FIELDS:
        if field not in payload:
            continue
        current = getattr(job, field, "")
        if str(current or "").strip():
            continue
        value = payload[field]
        if not str(value or "").strip():
            continue
        setattr(job, field, value)
        changed.append(field)
    if {"description", "requirements", "additional_info"}.intersection(changed):
        refresh_job_keywords(job)
    return changed


def commit_rows(
    db: Session, rows: list[dict[str, Any]], *, fill_empty_only: bool = False
) -> dict[str, Any]:
    """落库：逐行新建 / 仅补空字段 / 跳过（已在库）/ 失败。"""
    imported = 0
    updated = 0
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        title = str((row.get("data") or {}).get("title") or "").strip()
        try:
            payload = _clean_for_import(row)
            title = str(payload.get("title") or title)
            existing = find_job_by_identity(
                db,
                title=title,
                company=str(payload.get("company") or ""),
                source_url=str(payload.get("source_url") or ""),
            )
            if existing is not None:
                if fill_empty_only:
                    changed = fill_empty_fields(existing, payload)
                    if changed:
                        db.commit()
                        updated += 1
                    else:
                        skipped.append(
                            {
                                "index": index,
                                "title": title,
                                "message": "岗位广场已有这个岗位，且没有可补的空字段",
                            }
                        )
                else:
                    skipped.append(
                        {"index": index, "title": title, "message": "岗位广场已有这个岗位，已跳过"}
                    )
                continue
            create_job_record(db, JobCreate(**payload))
            imported += 1
        except Exception:  # noqa: BLE001 - 单行失败不拖垮整批
            db.rollback()
            # 不回传异常原文：ValueError / IntegrityError 的消息里常见表名、列名与 SQL 片段，
            # 这些会直接出现在导入结果里（CodeQL `py/stack-trace-exposure` 追的就是这条
            # "异常文本 → 响应"的链）。行号 + 标题足够定位是哪一条，原文进日志。
            logger.warning("从链接导入：第 %s 条（%s）失败", index, title, exc_info=True)
            failed.append({"index": index, "title": title, "message": "这一条导入失败"})
    return {"imported": imported, "updated": updated, "skipped": skipped, "failed": failed}


__all__ = [
    "DETAIL_BATCH_LIMIT",
    "FILLABLE_FIELDS",
    "MAX_LIST_PAGES",
    "MAX_PREVIEW_ROWS",
    "commit_rows",
    "fetch_details",
    "fill_empty_fields",
    "preview_from_url",
    "preview_out",
    "preview_rules_from_url",
    "provider_for",
]

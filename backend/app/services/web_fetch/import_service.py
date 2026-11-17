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
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...runtime.blocking import run_sync
from ...schemas.job import JobCreate
from ..job.job_service import create_job_record, find_job_by_identity, refresh_job_keywords
from .errors import WebFetchError
from .extractor import MAX_ROWS, extract_detail, extract_rows, extract_rules_result
from .fetcher import FetchedPage, FetchedPages, JobFetcher
from .import_rows import (
    _annotate_existing,
    _clean_for_import,
    _dedupe_rows,
    _engine_config,
    _page_requested,
    _row_cap,
    _row_for_detail,
    preview_out,
)
from .page_intent import classify_page_intent
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


@dataclass(frozen=True)
class PreviewPlan:
    """预览的准备段产物：已抓到的页面 + 解析好的模型 provider（都不引用会话）。

    抓取（网络 + 同域限速等待）与"读模型配置"都是同步阻塞，一起在 worker 里做完；
    随后的抽取是模型调用，回到事件循环。
    """

    batch: FetchedPages
    provider: Any
    requested: int
    url: str


@dataclass(frozen=True)
class DetailsPlan:
    """补详情的准备段产物：每行对应的已抓到的详情页（``None`` = 抓取失败/无链接）。"""

    prepared: tuple[tuple[ExtractedRow, FetchedPage | None], ...]
    provider: Any


def _close_fetcher(fetcher: Any) -> None:
    """归还抓取客户端；替身没有 ``close`` 或关闭失败都不影响已经拿到的结果。

    T04 让 ``JobFetcher`` 跨页复用一个客户端，因此每条预览/补详情路径都要在收尾归还。
    但测试与调用方可能传只实现 ``fetch_pages`` 的替身——以前直接 ``fetcher.close()``
    会把这变成一个 500，用户看到的是"预览失败"而不是真实结果。
    """
    close = getattr(fetcher, "close", None)
    if not callable(close):
        return
    try:
        close()
    except Exception:  # noqa: BLE001 - 归还连接失败不能覆盖预览结果
        logger.warning("收尾时关闭抓取客户端失败", exc_info=True)


def prepare_preview(
    db: Session | None,
    url: str,
    *,
    engine: str = "auto",
    limit: int = 0,
    intent: str = "auto",
    provider: Any = None,
    pages: int = 1,
) -> PreviewPlan:
    """同步准备段：抓 1–10 页并取好 provider，然后归还请求连接。"""
    fetcher: JobFetcher | None = None
    try:
        fetcher = JobFetcher(db, config=_engine_config(engine))
        # 详情意图天然是单页：用户给的就是一条岗位详情，不跟它的「下一页」。
        requested = 1 if intent == "job_detail" else _page_requested(pages)
        batch = fetcher.fetch_pages(
            url,
            pages=requested,
            stop_after_first=(
                (lambda page: classify_page_intent(page) == "job_detail")
                if intent == "auto"
                else None
            ),
        )
        if intent == "auto" and batch.first and classify_page_intent(batch.first) == "job_detail":
            requested = 1
        # db 可为 None（不落库的预览路径）：没有会话就不取「已存在岗位」，与改动前「没有 db 就没有标注」的行为一致。
        resolved = (
            provider if provider is not None else (provider_for(db) if db is not None else None)
        )
        return PreviewPlan(batch=batch, provider=resolved, requested=requested, url=url)
    finally:
        # T04：抓取客户端跟着这次预览会话一起归还（连接池不跨请求泄漏）。
        # 只关"自己有 close 的东西"：测试与调用方可能传一个只实现了 fetch_pages 的替身，
        # 收尾不该因此把已经拿到的预览结果变成一个 500。
        _close_fetcher(fetcher)
        if db is not None:
            db.close()


async def collect_preview_rows(
    plan: PreviewPlan, *, intent: str = "auto", limit: int = 0
) -> tuple[list[ExtractedRow], str, list[str]]:
    """中间段：逐页走抽取层（可能调模型），**不碰数据库**。

    Returns:
        ``(rows, method, warnings)``——``method`` 是 model / rules / none 的聚合口径。
    """
    cap = _row_cap(limit)
    rows: list[ExtractedRow] = []
    method = "none"
    warnings = list(plan.batch.errors)
    for page in plan.batch.pages:
        result = await extract_rows(page, provider=plan.provider, intent=intent, limit=cap)
        rows.extend(result.rows)
        warnings.extend(result.warnings)
        if result.method == "model":
            method = "model"
        elif result.method == "rules" and method == "none":
            method = "rules"
    return rows, method, warnings


def finalize_preview(
    db: Session | None,
    plan: PreviewPlan,
    rows: list[ExtractedRow],
    *,
    method: str,
    warnings: list[str],
    engine: str = "auto",
    limit: int = 0,
) -> dict[str, Any]:
    """同步收尾段：去重/截断/标「已在库」（要读库），拼出预览响应。"""
    try:
        cap = _row_cap(limit)
        rows = _dedupe_rows(rows)
        capped = len(rows) > cap
        if capped:
            warnings.append(f"多页共 {len(rows)} 条，本次最多取 {cap} 条")
            rows = rows[:cap]
        if db is not None:
            _annotate_existing(db, rows)
        first = plan.batch.first
        return preview_out(
            rows,
            url=first.url if first is not None else plan.url,
            engine=first.engine if first is not None else engine,
            method=method,
            fetched_on=first.fetched_on if first is not None else "",
            warnings=warnings,
            pages_requested=plan.requested,
            pages_fetched=plan.batch.pages_fetched,
            truncated=plan.batch.truncated or capped,
            stop_reason=plan.batch.stop_reason,
        )
    finally:
        if db is not None:
            db.close()


async def preview_from_url(
    db: Session,
    url: str,
    *,
    engine: str = "auto",
    limit: int = 0,
    intent: str = "auto",
    provider: Any = None,
    pages: int = 1,
) -> dict[str, Any]:
    """抓 1–10 页（只跟随页面声明的下一页）并把抽取结果转成预览行（不落库）。

    第 2 页起抓取失败不会回滚：已抓到的页照常抽取并返回，失败信息进 warnings，
    由 pages_fetched / truncated / stop_reason 如实说明停在哪一步。

    三段式（准备 → 模型抽取 → 收尾），与 HTTP 路由同一套切法：本函数只是把三段
    串起来的兼容入口（工具层与离线测试按它调用）。
    """
    plan = await run_sync(
        prepare_preview,
        db,
        url,
        engine=engine,
        limit=limit,
        intent=intent,
        pages=pages,
        provider=provider,
    )
    rows, method, warnings = await collect_preview_rows(plan, intent=intent, limit=limit)
    return await run_sync(
        finalize_preview,
        db,
        plan,
        rows,
        method=method,
        warnings=warnings,
        engine=engine,
        limit=limit,
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
    try:
        return rows, batch, warnings
    finally:
        _close_fetcher(fetcher)


def prepare_details(
    db: Session | None,
    rows: list[dict[str, Any]],
    *,
    engine: str = "auto",
    provider: Any = None,
    page_url: str = "",
) -> DetailsPlan:
    """同步准备段：还原行、逐条抓详情页（网络 + 限速）、取好 provider，然后归还连接。"""
    fetcher: JobFetcher | None = None
    try:
        if len(rows) > DETAIL_BATCH_LIMIT:
            raise ValueError(f"一次最多补 {DETAIL_BATCH_LIMIT} 条详情，请分批补齐")
        fetcher = JobFetcher(db, config=_engine_config(engine))
        # db 可为 None（不落库的预览路径）：没有会话就不取「已存在岗位」，与改动前「没有 db 就没有标注」的行为一致。
        resolved = (
            provider if provider is not None else (provider_for(db) if db is not None else None)
        )
        prepared: list[tuple[ExtractedRow, FetchedPage | None]] = []
        for raw in rows:
            row = _row_for_detail(raw, page_url=page_url)
            # 只跟「列表页明确给出的详情链接」走：source_url 可能就是列表页自身，
            # 把它当详情页抓一遍既浪费请求，也会把列表页正文当成 JD 写进去。
            target = row.detail_url
            if not target:
                row.mark_fetch_failed("列表页没有给出详情链接，无法补详情")
                prepared.append((row, None))
                continue
            page: FetchedPage | None = None
            try:
                page = fetcher.fetch(target)
            except WebFetchError as exc:
                row.mark_fetch_failed(str(exc))
            except Exception:  # noqa: BLE001 - 单条失败不拖垮整批
                logger.warning("链接导入补详情失败：%s", target, exc_info=True)
                row.mark_fetch_failed("这条详情抓取失败")
            prepared.append((row, page))
        return DetailsPlan(prepared=tuple(prepared), provider=resolved)
    finally:
        if fetcher is not None:
            _close_fetcher(fetcher)
        if db is not None:
            db.close()


async def collect_detail_rows(plan: DetailsPlan) -> dict[str, Any]:
    """中间段：对已抓到的详情页逐条抽取（可能调模型），**不碰数据库**。"""
    updated: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row, page in plan.prepared:
        if page is None:
            updated.append(row.to_dict())
            continue
        try:
            detail = await extract_detail(page, provider=plan.provider)
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
            logger.warning("链接导入补详情失败：%s", row.detail_url, exc_info=True)
            row.mark_fetch_failed("这条详情抓取失败")
        updated.append(row.to_dict())
    return {"rows": updated, "warnings": warnings}


async def fetch_details(
    db: Session,
    rows: list[dict[str, Any]],
    *,
    engine: str = "auto",
    provider: Any = None,
    page_url: str = "",
) -> dict[str, Any]:
    """对勾选的行逐条补详情；单条失败标 fetch_failed，已完成的保留。

    三段式（抓取在 worker → 抽取在事件循环 → 结果合并），与 HTTP 路由同一套切法；
    本函数只是把三段串起来的兼容入口。
    """
    plan = await run_sync(
        prepare_details,
        db,
        rows,
        engine=engine,
        provider=provider,
        page_url=page_url,
    )
    return await collect_detail_rows(plan)


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
    "DetailsPlan",
    "PreviewPlan",
    "collect_detail_rows",
    "collect_preview_rows",
    "commit_rows",
    "fetch_details",
    "fill_empty_fields",
    "finalize_preview",
    "prepare_details",
    "prepare_preview",
    "preview_from_url",
    "preview_out",
    "preview_rules_from_url",
    "provider_for",
]

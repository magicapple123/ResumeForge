# SPDX-License-Identifier: Apache-2.0
"""网页抓取导入的**行整形**（从 ``import_service`` 拆出，只为守住 500 行预算）。

这里只放"把抓到的原始行打扮成对外结构"的纯函数：去重、标注已存在、截断到上限、
把一行 detail 变成导入行。它们不发起抓取、不碰会话，所以拆出去不改变任何 IO 边界。

``import_service`` 仍从本模块 re-export 这些名字：既有调用方与测试的 patch 目标
（``import_service.preview_out`` 之类）继续有效。
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ...schemas.job import RECOGNITION_SOURCE_OFFICIAL
from ..job.job_csv import row_to_payload
from ..job.job_service import find_job_by_identity
from .extractor import MAX_ROWS
from .fetcher import FetchConfig
from .row import ExtractedRow

# 与 ``import_service`` 同源的上限：两个模块都要用，但常量本身没有 IO 依赖。
MAX_LIST_PAGES = 10
MAX_PREVIEW_ROWS = MAX_ROWS


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

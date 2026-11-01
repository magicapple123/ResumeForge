# SPDX-License-Identifier: Apache-2.0
"""简历文档只读工具（#38 P0/P1）：版面状态读数、命名版本、岗位变体、按 path 取单条。

三个问题分别是三档需求：
- P0「我现在这版几页、有没有溢出、断页在哪」——必须**真排一遍 PDF**（``build_pagination_report``
  与导出同源），再叠一层内容+排版预检；返回值里带上界面落点（「页面概览」面板），
  模型才能指到具体面板而不是泛泛说"在版面里"；
- P1「有哪些命名版本 / 岗位变体」——版本与变体是制作台的工作流对象，这里只读不恢复；
- P1「按 path 取单条」——模型先 get_resume 看到对象 id，再用这里读一条的精确值/布局。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy.orm import Session

from ...models.versions import ResumeVariant
from ...schemas.preflight import PreflightRequest, PreflightSnapshot
from ..resume.document_pagination import build_pagination_report
from ..resume.document_variants import list_variants, variant_brief
from ..resume.document_versions import list_versions, version_brief
from ..resume.preflight import run_preflight
from ..resume.resume_delivery import canonical_content_sha256
from ._shared import MAX_LIST_LIMIT
from ._types import ToolResult
from .document_support import (
    MAX_RESULT_CHARS,
    PAGINATION_PANEL_NAME,
    PAGINATION_PANEL_WHERE,
    document_for,
    entry_index,
    entry_label,
    entry_layout,
    field_labels_for_tool,
    record_or_error,
    render_settings,
    require_path,
    section_label,
    section_titles,
)


def _render_config_digest(settings: dict) -> str:
    raw = json.dumps(
        {
            key: settings[key]
            for key in ("template", "format_config", "page_limit", "font_scale", "language")
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _preflight_brief(document: dict, settings: dict, record) -> dict:
    """内容 + 排版两层预检（本机确定性规则，不调模型、不渲染产物）。"""
    snapshot = PreflightSnapshot(
        content_sha256=canonical_content_sha256(document),
        render_config_sha256=_render_config_digest(settings),
        template=settings["template"],
        page_limit=settings["page_limit"],
        font_scale=settings["font_scale"],
        language=settings["language"],
        document_mode="long_cv" if getattr(record, "document_mode", "") == "long_cv" else "resume",
    )
    result = run_preflight(
        document,
        request=PreflightRequest(layers=["content", "layout"]),
        snapshot=snapshot,
        template=settings["template"],
        page_limit=settings["page_limit"],
        font_scale=settings["font_scale"],
        language=settings["language"],
        format_config=settings["format_config"],
    )
    return {
        "summary": result.summary,
        "layers_run": list(result.layers_run),
        "issues": [
            {
                "severity": issue.severity,
                "code": issue.code,
                "detail": issue.detail,
                "locator": issue.locator.model_dump(exclude_none=True),
            }
            for issue in result.issues[:6]
        ],
    }


def _tool_get_resume_status(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    settings = render_settings(db, record)
    report = build_pagination_report(
        document,
        template=settings["template"],
        format_config=settings["format_config"],
        page_limit=settings["page_limit"],
        font_scale=settings["font_scale"],
        include_photo=True,
        language=settings["language"],
    )
    titles = section_titles(document)
    truncated = report.get("truncated_at")
    if isinstance(truncated, dict) and truncated.get("section"):
        truncated = {**truncated, "section_label": section_label(titles, truncated["section"])}
    manual_breaks = [
        {**item, "section_label": section_label(titles, item.get("section") or "")}
        for item in report.get("manual_breaks") or []
        if isinstance(item, dict)
    ]
    pages = int(report.get("pages") or 0)
    page_limit = int(report.get("page_limit") or settings["page_limit"])
    overflow = bool(report.get("overflow"))
    reading = (
        f"按当前排版需要 {pages} 页（上限 {page_limit} 页），溢出={'是' if overflow else '否'}"
    )
    if truncated:
        reading += f"；超出上限的内容从「{truncated['section_label']}」开始被截断"
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "revision": int(record.revision or 0),
        "document_mode": getattr(record, "document_mode", "") or "resume",
        "pages": pages,
        "pages_needed": int(report.get("pages_needed") or pages),
        "overflow": overflow,
        "page_limit": page_limit,
        "last_page_fill": report.get("last_page_fill"),
        "truncated_at": truncated,
        "manual_breaks": manual_breaks,
        "pagination_warnings": report.get("warnings") or [],
        "pagination_panel": {
            "name": PAGINATION_PANEL_NAME,
            "where": PAGINATION_PANEL_WHERE,
            "note": "断页/溢出位置以该面板里每页缩略图的标记为准；点「获取分页报告」才按真实 PDF 测量",
        },
        "preflight": _preflight_brief(document, settings, record),
        "reading": reading,
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False)[:MAX_RESULT_CHARS],
        summary=f"查看了简历「{record.title}」的版面：{reading}",
        link="/resumes",
    )


def _tool_list_versions(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    limit = min(int(arguments.get("limit") or MAX_LIST_LIMIT), MAX_LIST_LIMIT)
    versions = list_versions(db, record.id)[:limit]
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "current_revision": int(record.revision or 0),
        "versions": [
            {
                key: value
                for key, value in version_brief(version).items()
                if key
                in {
                    "id",
                    "name",
                    "change_summary",
                    "frozen",
                    "source",
                    "source_revision",
                    "created_at",
                }
            }
            for version in versions
        ],
        "note": "恢复某个版本要在简历制作台「版本」里由用户点「恢复」，助手不代为覆盖当前正文。",
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"查看了简历「{record.title}」的 {len(payload['versions'])} 个命名版本",
        link="/resumes",
    )


def _tool_list_variants(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    limit = min(int(arguments.get("limit") or MAX_LIST_LIMIT), MAX_LIST_LIMIT)
    variants: list[ResumeVariant] = list_variants(db, record.id)[:limit]
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "variants": [
            {
                key: value
                for key, value in variant_brief(variant).items()
                if key
                in {
                    "id",
                    "name",
                    "job_title",
                    "company",
                    "language",
                    "base_version_id",
                    "last_synced_version_id",
                    "updated_at",
                }
            }
            for variant in variants
        ],
        "note": "岗位变体是独立内容稿；派生与同步要在简历制作台「版本」里操作，助手不代改变体内容。",
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"查看了简历「{record.title}」的 {len(payload['variants'])} 个岗位变体",
        link="/resumes",
    )


def _tool_get_entry(db: Session, arguments: dict) -> ToolResult:
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    _path, target = require_path(document, arguments)
    titles = section_titles(document)
    labels = field_labels_for_tool()
    payload: dict[str, Any] = {
        "resume_id": record.id,
        "title": record.title,
        "revision": int(record.revision or 0),
        "path": target.path,
        "section": target.section,
        "section_label": section_label(titles, target.section),
    }
    if target.entry is not None:
        entry = target.entry
        payload["entry"] = {
            "object_id": entry.get("id"),
            "hidden": bool(entry.get("hidden")),
            "index": entry_index(document, target.section, str(entry.get("id"))),
            "layout": entry_layout(entry),
            "label": entry_label(entry),
        }
    if target.item is not None:
        item = target.item
        payload["item"] = {
            "object_id": item.get("id"),
            "kind": item.get("kind"),
            "key": item.get("key"),
            "label": item.get("label") or labels.get(str(item.get("key") or ""), ""),
            "placement": item.get("placement"),
            "format": item.get("format"),
        }
    payload["value"] = target.read()
    section_name = section_label(titles, target.section)
    entry_name = entry_label(target.entry or {})
    item_name = str(
        payload.get("item", {}).get("label") or payload.get("item", {}).get("key") or ""
    )
    summary = f"查看了简历「{record.title}」的「{section_name} · {entry_name}」" + (
        f"的「{item_name}」" if item_name else ""
    )
    return ToolResult(
        # 摘要只写人话；内部 path 只进回给模型的 text（不把 ob_ 对象 id 露到界面）。
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=summary,
        link="/resumes",
    )

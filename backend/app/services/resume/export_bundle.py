# SPDX-License-Identifier: Apache-2.0
"""W19 成套导出（D18）：一次请求产出多格式 zip + manifest，可选归档原件。

- 逐格式调用既有导出管线（build_export_delivery，唯一实现），**某个格式失败不牵连其它**；
  全部失败才报 422 并带回失败清单。
- zip 内：<stem>.<ext> 各格式 + manifest.json + 说明.txt；manifest 与文件逐项哈希一致。
- archive_original=true：把每个成功产物字节归档到 export_archive/（可选、默认关闭）并
  各冻结一条 delivery（一产物一证据）；archive_original=false 时不落盘、不建 artifact 行。
- strict_revision：与库内 revision 不等 → 409 业务码 resume_revision_changed（不产生 zip）。
- 内容覆盖：请求可带 content（当前草稿），快照与产物同源；不落库、不冻结正文。
--- 2026-10-25（be-export task-9）---
- W16：请求可带 ``variant_id`` —— 用岗位变体的内容 + 版式快照导出（解析委托 be-prov 的
  ``document_variants.resolve_variant_export``，非法/不属于本简历 → 404）。
- 资源清单真实化：每个产物的 manifest 带 ``font`` / ``renderer`` / ``template``，全部从
  本次导出的真实上下文与**当前安装的库版本**采集（不写死、不编造）。
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime
from functools import lru_cache
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...config import get_settings
from ...models.resume import ResumeRecord
from ...schemas.resume import ResumeContent
from ...schemas.resume_generation import mode_page_limit
from ...services.export_pipeline import (
    RenderContext,
    build_export_delivery,
)
from ..docx_fonts import resolve_docx_font_name
from ..export_pipeline import ExportRequest
from ..pdf_exporter import resolve_font_paths
from .document_identity import sanitize_document_ids
from .export_archive import save_artifact
from .export_naming import render_filename
from .resume_delivery import canonical_content_sha256, default_render_context, freeze_delivery
from .resume_template_format import FONT_KEY, SYSTEM_FONT
from .resume_template_store import resolve_style_config, resolve_style_template

BUNDLE_MANIFEST_MEMBER = "manifest.json"
BUNDLE_README_MEMBER = "说明.txt"
REVISION_CHANGED_CODE = "resume_revision_changed"
BUNDLE_README = (
    "这是 ResumeForge 的成套导出交付包。\n"
    "manifest.json 记录每个文件的格式、大小、sha256、页数与快照指纹，可逐项核对。\n"
    "「原件归档」开启时，同一份字节同时存入本机 export_archive/（随数据集备份）。\n"
)


class BundleError(Exception):
    """成套导出失败（全部格式失败 / 归档超限等）。"""

    def __init__(self, message: str, *, failures: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.failures = failures or []


class RevisionChangedError(Exception):
    """strict_revision 与库内版本不一致。"""

    def __init__(self, current_revision: int) -> None:
        super().__init__(REVISION_CHANGED_CODE)
        self.current_revision = current_revision


def _context(db: Session, record: ResumeRecord) -> RenderContext:
    base = default_render_context(db, record)
    return RenderContext(
        template=base["template"],
        template_html=base["template_html"],
        style_config=base["style_config"] or {},
        page_limit=base["page_limit"],
        font_scale=base["font_scale"],
        format_config=base["format_config"] or {},
        language=base["language"],
    )


# 渲染器标识：manifest 要能回答"这是哪个引擎、哪个版本排出来的"。
# version 的来源是**当前进程实际安装的包**（importlib.metadata），不是写死字符串；
# 纯内置渲染（json/md/txt）没有第三方库，就用 app_version 作为产线版本。
_RENDERER_BY_FORMAT: dict[str, tuple[str, str | None]] = {
    "pdf": ("fpdf2", "fpdf2"),
    "docx": ("python-docx", "python-docx"),
    "html": ("jinja2-html", "Jinja2"),
    "json": ("builtin-json", None),
    "md": ("builtin-markdown", None),
    "txt": ("builtin-text", None),
}


@lru_cache(maxsize=8)
def _package_version(name: str) -> str:
    """已安装包版本；探测不到记 unknown（不编造版本号，也不让导出失败）。"""
    try:
        return package_version(name)
    except PackageNotFoundError:
        return "unknown"


def _font_resource(context: RenderContext, doc_format: str) -> dict[str, Any]:
    """从**这次导出的真实渲染上下文**采集字体信息（W19 资源清单）。

    - family 与渲染走同一套字体解析（resolve_font_paths → 字体文件 name 表），
      不是把模板里的字体名抄过来；
    - available 表示本机能解析到字体文件；embedded 表示该格式的产物里字体是否内嵌
      （HTML 内嵌自定义/全局字体、PDF 子集内嵌、Word 只写族名不嵌字体——见 docx_fonts）；
    - 纯文本格式（json/md/txt）没有字体概念：applicable=False 且 family 为 None，
      不用一个假的族名凑数。
    """
    applicable = doc_format in ("html", "pdf", "docx")
    font_key = (context.format_config or {}).get(FONT_KEY)
    paths = resolve_font_paths(font_key) if applicable else None
    if not applicable:
        embedded = False
    elif doc_format == "pdf":
        # fpdf2 把解析到的字体文件子集嵌进 PDF；没有字体文件时这一格式根本排不出来。
        embedded = paths is not None
    elif doc_format == "html":
        # HTML 只内嵌自定义/全局选中字体；显式系统字体走模板自带字体栈。
        embedded = paths is not None and font_key != SYSTEM_FONT
    else:  # docx：python-docx 只写字体族名，不嵌字体文件。
        embedded = False
    return {
        "family": resolve_docx_font_name(font_key) if applicable else None,
        "selected": font_key or "",
        "available": paths is not None,
        "embedded": embedded,
        "font_scale": context.font_scale,
        "applicable": applicable,
    }


def _artifact_resources(doc_format: str, context: RenderContext) -> dict[str, Any]:
    """单个产物的资源清单：font + renderer + template（全部来自本次导出上下文）。"""
    app_version = get_settings().app_version
    engine_name, package = _RENDERER_BY_FORMAT.get(doc_format, (f"builtin-{doc_format}", None))
    return {
        "font": _font_resource(context, doc_format),
        "renderer": {
            "name": engine_name,
            "version": _package_version(package) if package else app_version,
            "app_version": app_version,
            "template": context.template,
        },
        "template": context.template,
    }


def _resource_manifest(context: RenderContext, config_sha: str) -> dict[str, Any]:
    """包级资源摘要：应用版本、模板、真实字体解析结果与渲染配置指纹。"""
    font_key = (context.format_config or {}).get(FONT_KEY)
    paths = resolve_font_paths(font_key)
    return {
        "app_version": get_settings().app_version,
        "template": context.template,
        "font": {
            "family": resolve_docx_font_name(font_key),
            "selected": font_key or "",
            "available": paths is not None,
            "font_scale": context.font_scale,
        },
        "render_config_sha256": config_sha,
    }


def _variant_layout_context(
    db: Session, record: ResumeRecord, layout: dict[str, Any]
) -> RenderContext:
    """把变体快照的 render_context 还原成 RenderContext（模板/样式按名字重新解析）。"""
    base = _context(db, record)
    style_template = layout.get("template") or record.template
    export_template, export_html = resolve_style_template(db, style_template)
    return RenderContext(
        template=export_template,
        template_html=export_html,
        style_config=resolve_style_config(db, style_template) or {},
        page_limit=int(layout.get("page_limit") or base.page_limit),
        font_scale=layout.get("font_scale") or base.font_scale,
        format_config=layout.get("format_config") or base.format_config,
        language=layout.get("language") or base.language,
    )


def resolve_variant_export_options(
    db: Session, record: ResumeRecord, payload: Any
) -> dict[str, Any]:
    """W16：把 payload.variant_id 解析成导出覆盖参数；无 variant_id 时返回 {}。

    委托 be-prov 的 ``document_variants.resolve_variant_export``（按名调用：该函数落地前
    回退同模块的 ``get_variant``，两者读的是同一份不可变快照）。非法/不属于本简历 → 404；
    显式请求字段优先于变体快照（单次导出可在变体基础上再改参数）。
    """
    variant_id = getattr(payload, "variant_id", None)
    if variant_id is None:
        return {}

    from . import document_variants as variants_service

    resolver = getattr(variants_service, "resolve_variant_export", None)
    try:
        if resolver is not None:
            resolved = resolver(db, record.id, variant_id)
        else:
            resolved = variants_service.get_variant(db, record.id, variant_id)
    except variants_service.VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc) or "岗位变体不存在") from exc

    if isinstance(resolved, dict):
        content = resolved.get("content") or {}
        layout = resolved.get("render_context") or resolved.get("layout") or {}
    else:
        content = getattr(resolved, "content", None) or {}
        layout = (
            getattr(resolved, "render_context", None) or getattr(resolved, "layout", None) or {}
        )
    options: dict[str, Any] = {
        "content": content,
        "layout": layout,
        "template": layout.get("template") or None,
        "format_name": layout.get("format_name") or None,
        "format_config": layout.get("format_config"),
        "page_limit": layout.get("page_limit"),
        "font_scale": layout.get("font_scale"),
        "language": layout.get("language"),
    }
    # 显式请求字段优先：变体提供快照，单次请求仍可覆盖（字段名与 ExportRequest 一致）。
    for key in ("format_config", "page_limit", "font_scale", "language"):
        explicit = getattr(payload, key, None)
        if explicit is not None:
            options[key] = explicit
    for key in ("template", "format_name"):
        explicit = getattr(payload, key, None)
        if explicit is not None:
            options[key] = explicit
    explicit_content = getattr(payload, "content", None)
    if explicit_content is not None:
        options["content"] = explicit_content.model_dump()
    return options


def build_bundle(db: Session, record: ResumeRecord, payload) -> dict[str, Any]:  # noqa: ANN001 - pydantic payload
    if (
        payload.strict_revision
        and payload.resume_revision is not None
        and int(payload.resume_revision) != int(record.revision or 0)
    ):
        raise RevisionChangedError(int(record.revision or 0))
    # W16：variant_id 存在时以变体快照为内容/版式基线（显式 content/format_config 仍可覆盖）。
    variant_options = resolve_variant_export_options(db, record, payload)
    if variant_options:
        content = sanitize_document_ids(variant_options["content"])
    elif payload.content is not None:
        content = sanitize_document_ids(payload.content.model_dump())
    else:
        content = record.content
    resume = ResumeContent.model_validate(content)
    context = (
        _variant_layout_context(db, record, variant_options["layout"])
        if variant_options
        else _context(db, record)
    )
    preset = None
    if payload.preset_id is not None:
        from .export_presets import get_preset

        preset = get_preset(db, payload.preset_id)
        if preset is None:
            raise BundleError("导出配置不存在")
    preset_config = (preset.config if preset is not None else {}) or {}
    formats = payload.formats or list(
        preset_config.get("formats") or ["pdf", "docx", "html", "md", "txt"]
    )
    naming = str(preset_config.get("naming") or "")
    archive_original = (
        payload.archive_original
        if payload.archive_original is not None
        else bool(preset_config.get("archive_original"))
    )
    watermark = payload.watermark or str(preset_config.get("watermark") or "")
    redact = payload.redact if payload.redact is not None else bool(preset_config.get("redact"))
    include_photo = payload.include_photo if payload.include_photo is not None else True
    files: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    zip_buffer = io.BytesIO()
    first_config_sha = ""
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for doc_format in formats:
            # A4 长 CV：成套导出的页数按记录的文档模式夹紧（普通 1–3 / 长 CV 1–10），
            # 与单格式导出共用 mode_page_limit，长 CV 的 10 页不再被旧 3 页规则误拦。
            requested_page_limit = variant_options.get("page_limit", payload.page_limit)
            if requested_page_limit is not None:
                requested_page_limit = mode_page_limit(
                    requested_page_limit, getattr(record, "document_mode", None) or "resume"
                )
            request = ExportRequest(
                format=doc_format,
                watermark=watermark,
                redact=redact,
                margin_mm=payload.margin_mm,
                font_scale=variant_options.get("font_scale", payload.font_scale),
                page_limit=requested_page_limit,
                format_config=variant_options.get("format_config", payload.format_config),
                language=variant_options.get("language", payload.language),
                include_photo=include_photo,
            )
            try:
                delivery = build_export_delivery(
                    request, resume, context, source_resume_id=record.id
                )
            except Exception as exc:  # noqa: BLE001 - 单格式失败不牵连其它格式
                failures.append({"format": doc_format, "error": str(exc)[:300]})
                continue
            artifact = delivery.artifact
            name = render_filename(naming, resume=resume, record=record, doc_format=doc_format)
            if name in seen_names:
                stem, dot, extension = name.rpartition(".")
                name = f"{stem}-{len(seen_names) + 1}{dot}{extension}"
            seen_names.add(name)
            archive.writestr(name, artifact.content)
            digest = hashlib.sha256(artifact.content).hexdigest()
            first_config_sha = first_config_sha or delivery.rendered_config_sha256
            files.append(
                {
                    "name": name,
                    "format": doc_format,
                    "sha256": digest,
                    "size": len(artifact.content),
                    "pages": artifact.pages,
                    "pages_needed": artifact.pages_needed,
                    "overflow": artifact.overflow,
                    "render_config_sha256": delivery.rendered_config_sha256,
                    # W19：每个产物的字体/渲染器/模板都来自这次真实导出，不是写死值。
                    **_artifact_resources(doc_format, context),
                }
            )
            if archive_original:
                try:
                    artifact_row = save_artifact(
                        db,
                        record=record,
                        content=artifact.content,
                        filename=name,
                        export_format=doc_format,
                        media_type=artifact.media_type,
                        kind="bundle_member",
                        resource_manifest=_resource_manifest(
                            context, delivery.rendered_config_sha256
                        ),
                        max_artifacts=int(preset_config.get("max_artifacts_per_resume") or 20),
                    )
                except ValueError as exc:
                    failures.append({"format": doc_format, "error": str(exc)[:300]})
                    continue
                effective_content = resume.model_dump()
                freeze_delivery(
                    db,
                    record=record,
                    source="export",
                    export_format=doc_format,
                    filename=name,
                    pages=artifact.pages,
                    content_sha256=delivery.content_sha256,
                    rendered_config_sha256=delivery.rendered_config_sha256,
                    content=effective_content,
                    render_context={
                        "template": context.template,
                        "format_config": context.format_config,
                        "page_limit": context.page_limit,
                        "font_scale": context.font_scale,
                        "language": context.language,
                    },
                    request_params={"format": doc_format, "watermark": watermark, "redact": redact},
                    source_content_sha256=canonical_content_sha256(effective_content),
                    artifact_sha256=digest,
                    idempotency_key=f"export-bundle:{record.id}:{digest}:{doc_format}",
                )
                _ = artifact_row
        if not files:
            raise BundleError("所有格式都导出失败", failures=failures)
        manifest = {
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "resume_revision": int(record.revision or 0),
            "snapshot": {
                "content_sha256": canonical_content_sha256(resume.model_dump()),
                "render_config_sha256": first_config_sha,
            },
            "files": files,
            "failures": failures,
            "target": {
                "resume_title": record.title or "",
                "target_job_title": record.job_title or "",
                "target_company": record.company or "",
                "document_mode": getattr(record, "document_mode", "resume") or "resume",
                "contact_present": bool(resume.phone or resume.email),
            },
            "resource_manifest": _resource_manifest(context, first_config_sha),
            # W16：这次导出是不是按岗位变体快照出的（None = 用记录本身）。
            "variant_id": payload.variant_id,
            "redacted": bool(redact),
            "watermark": bool(watermark),
            "format_count": len(files),
        }
        archive.writestr(
            BUNDLE_MANIFEST_MEMBER,
            json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
        )
        archive.writestr(BUNDLE_README_MEMBER, BUNDLE_README.encode("utf-8"))
    if archive_original:
        db.commit()
    stem = (record.title or "resume")[:60].strip() or "resume"
    return {
        "content": zip_buffer.getvalue(),
        "filename": f"{stem}-交付包.zip",
        "manifest": manifest,
    }


__all__ = [
    "BUNDLE_MANIFEST_MEMBER",
    "BUNDLE_README_MEMBER",
    "BundleError",
    "REVISION_CHANGED_CODE",
    "RevisionChangedError",
    "build_bundle",
]

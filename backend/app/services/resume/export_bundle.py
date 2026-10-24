# SPDX-License-Identifier: Apache-2.0
"""W19 成套导出（D18）：一次请求产出多格式 zip + manifest，可选归档原件。

- 逐格式调用既有导出管线（build_export_delivery，唯一实现），**某个格式失败不牵连其它**；
  全部失败才报 422 并带回失败清单。
- zip 内：<stem>.<ext> 各格式 + manifest.json + 说明.txt；manifest 与文件逐项哈希一致。
- archive_original=true：把每个成功产物字节归档到 export_archive/（可选、默认关闭）并
  各冻结一条 delivery（一产物一证据）；archive_original=false 时不落盘、不建 artifact 行。
- strict_revision：与库内 revision 不等 → 409 业务码 resume_revision_changed（不产生 zip）。
- 内容覆盖：请求可带 content（当前草稿），快照与产物同源；不落库、不冻结正文。
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from ...config import get_settings
from ...models.resume import ResumeRecord
from ...schemas.resume import ResumeContent
from ...services.export_pipeline import (
    RenderContext,
    build_export_delivery,
)
from ..export_pipeline import ExportRequest
from .document_identity import sanitize_document_ids
from .export_archive import save_artifact
from .export_naming import render_filename
from .resume_delivery import canonical_content_sha256, default_render_context, freeze_delivery

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


def _resource_manifest(
    record: ResumeRecord, context: RenderContext, config_sha: str
) -> dict[str, Any]:
    return {
        "app_version": get_settings().app_version,
        "template": context.template,
        "font": {},
        "render_config_sha256": config_sha,
    }


def build_bundle(db: Session, record: ResumeRecord, payload) -> dict[str, Any]:  # noqa: ANN001 - pydantic payload
    if (
        payload.strict_revision
        and payload.resume_revision is not None
        and int(payload.resume_revision) != int(record.revision or 0)
    ):
        raise RevisionChangedError(int(record.revision or 0))
    content = (
        sanitize_document_ids(payload.content.model_dump())
        if payload.content is not None
        else record.content
    )
    resume = ResumeContent.model_validate(content)
    context = _context(db, record)
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
            request = ExportRequest(
                format=doc_format,
                watermark=watermark,
                redact=redact,
                margin_mm=payload.margin_mm,
                font_scale=payload.font_scale,
                page_limit=payload.page_limit,
                format_config=payload.format_config,
                language=payload.language,
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
                            record, context, delivery.rendered_config_sha256
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
            "resource_manifest": _resource_manifest(record, context, first_config_sha),
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

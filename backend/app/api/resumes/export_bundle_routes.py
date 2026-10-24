# SPDX-License-Identifier: Apache-2.0
"""W19 导出配置 CRUD + 成套导出 + 原件归档管理（独立路由文件，避开 export_routes 的并行改动）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi import Request as HTTPRequest
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.export_config import (
    ExportArtifactListOut,
    ExportArtifactOut,
    ExportBundleRequest,
    ExportPresetIn,
    ExportPresetListOut,
    ExportPresetOut,
)
from ...services.resume import export_archive as archive_service
from ...services.resume import export_bundle as bundle_service
from ...services.resume import export_presets as preset_service
from ...services.resume.export_presets import PresetError
from ._shared import _get_live_resume
from .export_routes import _require_local_export_request

router = APIRouter()


def _preset_or_404(db: Session, preset_id: int):
    preset = preset_service.get_preset(db, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="导出配置不存在")
    return preset


@router.get("/export-presets", response_model=ExportPresetListOut)
def list_export_presets(db: Session = Depends(get_db)) -> ExportPresetListOut:
    return ExportPresetListOut(
        items=[
            ExportPresetOut.model_validate(preset_service.preset_brief(preset))
            for preset in preset_service.list_presets(db)
        ]
    )


@router.post("/export-presets", response_model=ExportPresetOut, status_code=201)
def create_export_preset(payload: ExportPresetIn, db: Session = Depends(get_db)) -> ExportPresetOut:
    try:
        preset = preset_service.create_preset(
            db,
            name=payload.name,
            description=payload.description,
            config=payload.config,
            is_default=payload.is_default,
        )
    except PresetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ExportPresetOut.model_validate(preset_service.preset_brief(preset))


@router.patch("/export-presets/{preset_id}", response_model=ExportPresetOut)
def update_export_preset(
    preset_id: int, payload: ExportPresetIn, db: Session = Depends(get_db)
) -> ExportPresetOut:
    preset = _preset_or_404(db, preset_id)
    try:
        preset = preset_service.update_preset(
            db,
            preset,
            name=payload.name,
            description=payload.description,
            config=payload.config,
            is_default=payload.is_default,
        )
    except PresetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ExportPresetOut.model_validate(preset_service.preset_brief(preset))


@router.delete("/export-presets/{preset_id}", status_code=204)
def delete_export_preset(preset_id: int, db: Session = Depends(get_db)) -> Response:
    preset = _preset_or_404(db, preset_id)
    preset_service.delete_preset(db, preset)
    return Response(status_code=204)


@router.post("/{resume_id}/export-bundle")
def export_bundle(
    request: HTTPRequest,
    resume_id: int,
    payload: ExportBundleRequest,
    db: Session = Depends(get_db),
) -> Response:
    """成套导出：zip + manifest；单格式失败进 failures 不牵连其它；strict_revision 过期 409。"""
    _require_local_export_request(request)
    record = _get_live_resume(db, resume_id)
    try:
        result = bundle_service.build_bundle(db, record, payload)
    except bundle_service.RevisionChangedError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "detail": "简历版本已变化，请刷新后再导出",
                "code": bundle_service.REVISION_CHANGED_CODE,
                "revision": exc.current_revision,
            },
        ) from exc
    except bundle_service.BundleError as exc:
        raise HTTPException(
            status_code=422, detail={"detail": str(exc), "failures": exc.failures}
        ) from exc
    manifest = result["manifest"]
    headers = {
        "Content-Disposition": (
            "attachment; filename*=UTF-8''"
            + __import__("urllib.parse", fromlist=["quote"]).quote(result["filename"], safe="")
        ),
        "X-Content-Sha256": manifest["snapshot"]["content_sha256"],
        "X-Render-Config-Sha256": manifest["snapshot"]["render_config_sha256"],
        "X-Export-File-Count": str(len(manifest["files"])),
    }
    return Response(result["content"], media_type="application/zip", headers=headers)


@router.get("/{resume_id}/export-artifacts", response_model=ExportArtifactListOut)
def list_export_artifacts(resume_id: int, db: Session = Depends(get_db)) -> ExportArtifactListOut:
    record = _get_live_resume(db, resume_id)
    return ExportArtifactListOut(
        items=[
            ExportArtifactOut.model_validate(archive_service.artifact_brief(artifact))
            for artifact in archive_service.list_artifacts(db, record.id)
        ]
    )


@router.delete("/{resume_id}/export-artifacts/{artifact_id}", status_code=204)
def delete_export_artifact(
    resume_id: int, artifact_id: int, db: Session = Depends(get_db)
) -> Response:
    record = _get_live_resume(db, resume_id)
    try:
        deleted = archive_service.delete_artifact(db, record.id, artifact_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="原件不存在")
    return Response(status_code=204)

# SPDX-License-Identifier: Apache-2.0
"""W18 离线对象批注接口：评审包生成 / 批注导入 / 列表 / 状态机。

契约见 wave3 §4.5。批注文本按不可信输入处理，不写日志正文、不调用模型。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.review_annotations import (
    AnnotationListOut,
    AnnotationOut,
    ImportAnnotationsOut,
    ImportAnnotationsRequest,
    ReattachRequest,
)
from ..services.resume import review_annotations as annotations
from ..services.share_package import share_package_or_none

router = APIRouter(tags=["review-annotations"])


def _package_or_404(db: Session, share_id: int):
    package = share_package_or_none(db, share_id)
    if package is None:
        raise HTTPException(status_code=404, detail="分享包不存在")
    return package


def _error(exc: annotations.ReviewAnnotationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/api/share-packages/{share_id}/review-package")
def download_review_package(share_id: int, db: Session = Depends(get_db)) -> Response:
    """生成评审包 zip（既有 HTML/PDF + annotations.json 模板 + 说明.txt）。"""
    package = _package_or_404(db, share_id)
    try:
        content, filename = annotations.build_review_package_zip(db, package)
    except annotations.ReviewAnnotationError as exc:
        raise _error(exc) from exc
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/api/share-packages/{share_id}/annotations/import",
    response_model=ImportAnnotationsOut,
)
def import_annotations(
    share_id: int, payload: ImportAnnotationsRequest, db: Session = Depends(get_db)
) -> ImportAnnotationsOut:
    """导入外部回传的 annotations.json；格式/上限/版本有问题整批拒收，锚点失联单条标 stale。"""
    package = _package_or_404(db, share_id)
    try:
        result = annotations.import_annotations(db, package, payload.content)
    except annotations.ReviewAnnotationError as exc:
        raise _error(exc) from exc
    return ImportAnnotationsOut.model_validate(result)


@router.get("/api/share-packages/{share_id}/annotations", response_model=AnnotationListOut)
def list_annotations(share_id: int, db: Session = Depends(get_db)) -> AnnotationListOut:
    package = _package_or_404(db, share_id)
    rows = annotations.list_annotations(db, package.id)
    return AnnotationListOut(
        items=[AnnotationOut.model_validate(annotations.annotation_brief(row)) for row in rows]
    )


@router.post("/api/resume-annotations/{annotation_id}/resolve", response_model=AnnotationOut)
def resolve_annotation(annotation_id: int, db: Session = Depends(get_db)) -> AnnotationOut:
    try:
        row = annotations.resolve_annotation(db, annotation_id)
    except annotations.ReviewAnnotationError as exc:
        raise _error(exc) from exc
    return AnnotationOut.model_validate(annotations.annotation_brief(row))


@router.post("/api/resume-annotations/{annotation_id}/reopen", response_model=AnnotationOut)
def reopen_annotation(annotation_id: int, db: Session = Depends(get_db)) -> AnnotationOut:
    try:
        row = annotations.reopen_annotation(db, annotation_id)
    except annotations.ReviewAnnotationError as exc:
        raise _error(exc) from exc
    return AnnotationOut.model_validate(annotations.annotation_brief(row))


@router.post("/api/resume-annotations/{annotation_id}/dismiss", response_model=AnnotationOut)
def dismiss_annotation(annotation_id: int, db: Session = Depends(get_db)) -> AnnotationOut:
    try:
        row = annotations.dismiss_annotation(db, annotation_id)
    except annotations.ReviewAnnotationError as exc:
        raise _error(exc) from exc
    return AnnotationOut.model_validate(annotations.annotation_brief(row))


@router.post("/api/resume-annotations/{annotation_id}/reattach", response_model=AnnotationOut)
def reattach_annotation(
    annotation_id: int, payload: ReattachRequest, db: Session = Depends(get_db)
) -> AnnotationOut:
    """把失联批注显式重挂到当前对象（锚点必须存在；绝不对下标做隐式回退）。"""
    try:
        row = annotations.reattach_annotation(
            db, annotation_id, object_id=payload.object_id, point_id=payload.point_id
        )
    except annotations.ReviewAnnotationError as exc:
        raise _error(exc) from exc
    return AnnotationOut.model_validate(annotations.annotation_brief(row))

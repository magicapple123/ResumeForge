"""内推管理接口（prefix ``/api/referrals``）。

内推的增删改查 + 转化率统计。删除走软删除（``trash.live_only`` 列表里不再出现），
彻底删除在回收站里另做。``/stats`` 注册在 ``/{referral_id}`` 之前，语义更清晰。
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.referral import REFERRAL_STATUSES, Referral
from ..schemas.referral import (
    ReferralBatchDeleteResult,
    ReferralBatchRequest,
    ReferralCreate,
    ReferralImageUploadOut,
    ReferralOut,
    ReferralStatsOut,
    ReferralUpdate,
)
from ..services import trash
from ..services.referral_service import (
    create_referral,
    delete_referral,
    list_referrals,
    referral_images_dir,
    referral_or_none,
    referral_out,
    referral_stats,
    referrals_out,
    save_referral_image,
    update_referral,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/referrals", tags=["referrals"])

_IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


@router.get("", response_model=list[ReferralOut])
def read_referrals(
    status: str = Query(default=""),
    keyword: str = Query(default=""),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
):
    if status and status not in REFERRAL_STATUSES:
        raise HTTPException(status_code=422, detail="未知的内推状态")
    rows = list_referrals(db, status=status, keyword=keyword, limit=limit)
    # P2-1：批量预取 track 派生 converted，替代逐行点查（200 条 = 201 查询 → 2 查询）。
    return referrals_out(db, rows)


@router.get("/stats", response_model=ReferralStatsOut)
def read_referral_stats(db: Session = Depends(get_db)):
    """内推转化率：converted（由关联漏斗后置位派生）/ 有效内推总数。"""
    return referral_stats(db)


@router.post("/upload-image", response_model=ReferralImageUploadOut)
async def upload_referral_image(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """上传一张内推备注图片：校验类型/大小，存本地目录，返回相对路径。"""
    data = await file.read()
    try:
        path = save_referral_image(db, file.filename or "", file.content_type or "", data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ReferralImageUploadOut(path=path)


@router.get("/images/{filename}")
def read_referral_image(filename: str, db: Session = Depends(get_db)):
    """读取内推备注图片（只允许目录内的文件，防路径穿越）。"""
    safe_name = Path(filename).name
    if safe_name in {"", ".", ".."}:
        raise HTTPException(status_code=404, detail="图片不存在")
    directory = referral_images_dir(db.get_bind()).resolve()
    path = (directory / safe_name).resolve()
    if path.parent != directory or not path.is_file():
        raise HTTPException(status_code=404, detail="图片不存在")
    media_type = _IMAGE_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type)


@router.post("", response_model=ReferralOut, status_code=201)
def create_referral_entry(payload: ReferralCreate, db: Session = Depends(get_db)):
    return referral_out(db, create_referral(db, payload))


@router.post("/batch-delete", response_model=ReferralBatchDeleteResult)
def batch_delete_referrals(payload: ReferralBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 ``DELETE /{referral_id}``：任何一条 id 不存在或已在回收站里即
    整体 404 并附缺失 id 清单，不做"删一半"。单条删除只软删行、不连带清理备注
    图片文件，这里沿用同一行为。**声明在 ``/{referral_id}`` 之前**（同 ``/stats``）。
    """
    referrals: list[Referral] = []
    missing: list[int] = []
    for referral_id in payload.referral_ids:
        referral = trash.get_live(db, Referral, referral_id)
        if referral is None:
            missing.append(referral_id)
        else:
            referrals.append(referral)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下内推不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for referral in referrals:
        trash.soft_delete(db, "referral", referral)
    db.commit()
    return ReferralBatchDeleteResult(deleted=len(referrals))


@router.patch("/{referral_id}", response_model=ReferralOut)
def patch_referral(referral_id: int, payload: ReferralUpdate, db: Session = Depends(get_db)):
    referral = referral_or_none(db, referral_id)
    if referral is None:
        raise HTTPException(status_code=404, detail="内推不存在或已被删除")
    return referral_out(db, update_referral(db, referral, payload))


@router.delete("/{referral_id}", status_code=204)
def remove_referral(referral_id: int, db: Session = Depends(get_db)):
    if not delete_referral(db, referral_id):
        raise HTTPException(status_code=404, detail="内推不存在或已被删除")

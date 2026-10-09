"""资料箱接口：零散资料的增删改查。"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.material import MATERIAL_CATEGORIES
from ..schemas.material import MaterialCreate, MaterialOut, MaterialUpdate
from ..services.materials import (
    create_material,
    delete_material,
    list_materials,
    material_categories,
    material_or_none,
    update_material,
)
from ..services.user_files import save_from_data_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/materials", tags=["materials"])


def _save_file_copies(db: Session, material) -> None:
    """best-effort：把资料附件里的 data URL 落一份磁盘副本（失败只记日志）。"""
    try:
        for item in material.files or []:
            if not isinstance(item, dict):
                continue
            data_url = str(item.get("data_url") or "")
            if not data_url:
                continue
            save_from_data_url(
                db,
                data_url,
                source_type="material",
                source_ref=f"material:{material.id}",
                fallback_name=str(item.get("name") or ""),
                fallback_mime=str(item.get("mime_type") or ""),
            )
    except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住资料保存
        logger.warning("资料附件磁盘副本保存失败 material:%s", material.id, exc_info=True)


@router.get("", response_model=list[MaterialOut])
def read_materials(
    keyword: str = Query(default=""),
    category: str = Query(default=""),
    db: Session = Depends(get_db),
):
    return list_materials(db, keyword=keyword, category=category)


@router.get("/categories", response_model=list[str])
def read_categories(db: Session = Depends(get_db)):
    """候选分类：内置分类在前，用户已用过的自定义分类在后。"""
    used = material_categories(db)
    return list(dict.fromkeys([*MATERIAL_CATEGORIES, *used]))


@router.post("", response_model=MaterialOut, status_code=201)
def create_material_entry(payload: MaterialCreate, db: Session = Depends(get_db)):
    material = create_material(db, payload)
    _save_file_copies(db, material)
    return material


@router.get("/{material_id}", response_model=MaterialOut)
def read_material(material_id: int, db: Session = Depends(get_db)):
    material = material_or_none(db, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="资料不存在或已被删除")
    return material


@router.put("/{material_id}", response_model=MaterialOut)
def save_material(material_id: int, payload: MaterialUpdate, db: Session = Depends(get_db)):
    material = material_or_none(db, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="资料不存在或已被删除")
    updated = update_material(db, material, payload)
    _save_file_copies(db, updated)
    return updated


@router.delete("/{material_id}", status_code=204)
def remove_material(material_id: int, db: Session = Depends(get_db)):
    if not delete_material(db, material_id):
        raise HTTPException(status_code=404, detail="资料不存在或已被删除")

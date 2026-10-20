# SPDX-License-Identifier: Apache-2.0
"""资料箱接口：零散资料的增删改查。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.material import MATERIAL_CATEGORIES, Material
from ..schemas.common import Page
from ..schemas.material import (
    MaterialBatchDeleteResult,
    MaterialBatchRequest,
    MaterialCreate,
    MaterialOut,
    MaterialSummary,
    MaterialUpdate,
)
from ..services import trash
from ..services.materials import (
    create_material,
    delete_material,
    list_materials,
    list_materials_page,
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


@router.get("", response_model=list[MaterialSummary])
def read_materials(
    keyword: str = Query(default=""),
    category: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """列表只带附件元信息（RF-25）：不带 data_url 与附件文字，详情走 `/{id}`。"""
    return list_materials(db, keyword=keyword, category=category)


@router.get("/categories", response_model=list[str])
def read_categories(db: Session = Depends(get_db)):
    """候选分类：内置分类在前，用户已用过的自定义分类在后。"""
    used = material_categories(db)
    return list(dict.fromkeys([*MATERIAL_CATEGORIES, *used]))


@router.get("/page", response_model=Page[MaterialSummary])
def read_materials_page(
    keyword: str = Query(default=""),
    category: str = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=18, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """分页列出资料（RF-08 续）：过滤与排序与旧端点同源。

    资料箱此前是无上限的全量下发（数百条时每行还带附件元信息数组），前端全量
    渲染卡片网格。本端点按页取（网格一页 18 张），`MaterialSummary` 仍不带
    data_url 与附件文字（RF-25 口径不变），详情走 ``/{id}``。**声明在
    ``/{material_id}`` 之前**（字面量段排在参数段前面，同 ``/categories``）。
    """
    rows, total = list_materials_page(
        db, keyword=keyword, category=category, page=page, page_size=page_size
    )
    return Page(items=rows, total=total)


@router.post("", response_model=MaterialOut, status_code=201)
def create_material_entry(payload: MaterialCreate, db: Session = Depends(get_db)):
    material = create_material(db, payload)
    _save_file_copies(db, material)
    return material


@router.post("/batch-delete", response_model=MaterialBatchDeleteResult)
def batch_delete_materials(payload: MaterialBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 ``DELETE /{material_id}``：任何一条 id 不存在或已在回收站里即
    整体 404 并附缺失 id 清单，不做"删一半"。单条删除只软删行、不动磁盘副本，
    这里沿用同一行为。**声明在 ``/{material_id}`` 之前**（同 ``/categories``）。
    """
    materials: list[Material] = []
    missing: list[int] = []
    for material_id in payload.material_ids:
        material = trash.get_live(db, Material, material_id)
        if material is None:
            missing.append(material_id)
        else:
            materials.append(material)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"以下资料不存在或已被删除：{'、'.join(map(str, missing))}",
        )
    for material in materials:
        trash.soft_delete(db, "material", material)
    db.commit()
    return MaterialBatchDeleteResult(deleted=len(materials))


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

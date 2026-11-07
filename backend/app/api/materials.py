# SPDX-License-Identifier: Apache-2.0
"""资料箱接口：零散资料的增删改查。

T28 Batch B 起，列表/单条读取/新建/修改四条由 action 契约层生成（一份 ActionSpec 同时是
工具与路由的唯一真源）；分类、分页、批量删除与删除仍留在本文件。生成的路由都注册在原
装饰器所在位置，注册顺序（/categories、/page、/batch-delete 先于 /{material_id}）不变。
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.material import MATERIAL_CATEGORIES, Material
from ..schemas.common import Page
from ..schemas.material import (
    MaterialBatchDeleteResult,
    MaterialBatchRequest,
    MaterialSummary,
)
from ..services import trash
from ..services.actions import add_action_route
from ..services.actions.domains.materials import material_actions
from ..services.materials import (
    delete_material,
    list_materials_page,
    material_categories,
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


# T28 Batch B：GET /api/materials 由契约层生成（原 read_materials 装饰器位置）。
add_action_route(router, material_actions()["list_materials"])


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
    data_url 与附件文字（RF-25 口径不变），详情走 `/{id}`。**声明在
    `/{material_id}` 之前**（字面量段排在参数段前面，同 `/categories`）。
    """
    rows, total = list_materials_page(
        db, keyword=keyword, category=category, page=page, page_size=page_size
    )
    return Page(items=rows, total=total)


# T28 Batch B：POST /api/materials 由契约层生成（原 create_material_entry 位置）。
add_action_route(router, material_actions()["create_material"])


@router.post("/batch-delete", response_model=MaterialBatchDeleteResult)
def batch_delete_materials(payload: MaterialBatchRequest, db: Session = Depends(get_db)):
    """批量移入回收站（软删除）：单次上限 500，与简历批量删除同一口径。

    语义对齐单条 `DELETE /{material_id}`：任何一条 id 不存在或已在回收站里即
    整体 404 并附缺失 id 清单，不做"删一半"。单条删除只软删行、不动磁盘副本，
    这里沿用同一行为。**声明在 `/{material_id}` 之前**（同 `/categories`）。
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


# T28 Batch B：GET /api/materials/{material_id} 由契约层生成（原 read_material 位置）。
add_action_route(router, material_actions()["get_material"])


# T28 Batch B：PUT /api/materials/{material_id} 由契约层生成（原 save_material 位置）。
add_action_route(router, material_actions()["update_material"])


@router.delete("/{material_id}", status_code=204)
def remove_material(material_id: int, db: Session = Depends(get_db)):
    if not delete_material(db, material_id):
        raise HTTPException(status_code=404, detail="资料不存在或已被删除")

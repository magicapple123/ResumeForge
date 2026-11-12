# SPDX-License-Identifier: Apache-2.0
"""资料附件的落盘与详情补链。

两个函数原先长在 ``api/materials.py``：``services/actions`` 的资料动作要在"直接写库"
之后落同一份磁盘副本、返回同一份详情视图，只能反向 import 路由模块。落盘与视图都
属于服务层职责，放在这里路由与工具共用一份。
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models.material import Material
from ..schemas.material import MaterialOut
from .user_files import find_material_file, save_from_data_url

logger = logging.getLogger(__name__)


def save_file_copies(db: Session, material: Material) -> None:
    """best-effort：把资料附件里的 data URL 落一份磁盘副本（失败只记日志）。"""
    try:
        for item in material.files or []:
            if not isinstance(item, dict):
                continue
            # 新链路（POST /attachments）上传时已存过原件并带了 file_id：
            # 这里再按 data_url 存一次只是白跑 IO，跳过。
            if item.get("file_id"):
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


def enrich_material_file_ids(db: Session, material: Material) -> MaterialOut:
    """详情响应里给历史附件补 file_id（**只读，不写库**）。

    旧版只给图片存了磁盘副本、material.files 里没有 file_id。按来源 + 原名反查到
    user_file 行就补在响应里，老图片因此也能用「另存为」；查不到（或历史文本附件
    从来没有原件）保持 None，前端只显示「复制」——不做一个点了会 404 的按钮。
    """
    base = MaterialOut.model_validate(material)
    files: list[dict] = []
    changed = False
    for item in material.files or []:
        if not isinstance(item, dict):
            continue
        payload = dict(item)
        if payload.get("file_id") is None and payload.get("data_url"):
            found = find_material_file(db, material.id, str(payload.get("name") or ""))
            if found is not None:
                payload["file_id"] = found.id
                changed = True
        files.append(payload)
    if not changed:
        return base
    return MaterialOut.model_validate({**base.model_dump(), "files": files})


__all__ = ["enrich_material_file_ids", "save_file_copies"]

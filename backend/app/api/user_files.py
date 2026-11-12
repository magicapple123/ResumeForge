# SPDX-License-Identifier: Apache-2.0
"""用户文件副本接口：分页列表、按来源反查、原样下载与用系统程序打开。

安全口径：**客户端永远不参与路径**。下载与打开都只按 id 查库拿服务端生成的
``disk_name``，拼上副本目录后在返回/打开前做 resolve 校验——最终路径必须仍落在
副本目录内，否则按 404 处理（防穿越守卫，对被篡改的行也成立）。
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user_file import UserFile
from ..services.actions import add_action_route
from ..services.actions.catalog import all_actions
from ..services.document_text import preview_text_of_file
from ..services.system_reveal import reveal_path
from ..services.user_files import (
    list_file_copies,
    lookup_file_copies,
    user_files_dir,
)

router = APIRouter(prefix="/api/user-files", tags=["user-files"])
logger = logging.getLogger(__name__)

# 列表单页上限：副本页是本机界面，100 条足够一次看完。
_MAX_PAGE_SIZE = 100
# 文本预览的体积上限：再大就不是"预览"而是"打开大文件"，读进内存也不划算。
_MAX_TEXT_PREVIEW_BYTES = 50 * 1024 * 1024


add_action_route(router, all_actions()["list_user_files"], route_path="")
def list_user_files(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=_MAX_PAGE_SIZE),
    source_type: str = Query(default=""),
    keyword: str = Query(default=""),
    db: Session = Depends(get_db),
) -> dict:
    """分页列出副本；``keyword`` 模糊匹配原名，``source_type`` 精确过滤来源。"""
    return list_file_copies(
        db,
        page=page,
        page_size=page_size,
        source_type=source_type,
        keyword=keyword,
    )


@router.get("/lookup")
def lookup_user_files(
    source_type: str = Query(...),
    source_ref: str = Query(default=""),
    name: str = Query(default=""),
    db: Session = Depends(get_db),
) -> dict:
    """按来源精确反查副本 id（供岗位备注图等原入口直接取 raw 链接）。

    ``source_ref`` 同时匹配首次来源列与 ``sources_json``：同一份内容后来被别的
    入口再次保存时，反查仍能命中。结果按 id 升序——与各入口按数组顺序保存的
    顺序一致，调用方可按下标对应到原图。
    """
    return lookup_file_copies(
        db,
        source_type=source_type,
        source_ref=source_ref,
        name=name,
    )


def _resolved_copy_path(row: UserFile, db: Session) -> Path:
    """按行取副本文件的最终路径；不在目录内或文件缺失一律 404。"""
    directory = user_files_dir(db.get_bind()).resolve()
    candidate = (directory / row.disk_name).resolve()
    if candidate.parent != directory or not candidate.is_file():
        raise HTTPException(status_code=404, detail="文件副本不存在")
    return candidate


@router.get("/{file_id}/raw")
def read_raw(file_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """原样返回副本内容（inline）：图片可直接给 antd Image，pdf 可嵌 iframe。"""
    row = db.get(UserFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="文件副本不存在")
    path = _resolved_copy_path(row, db)
    return FileResponse(
        path,
        media_type=row.mime or "application/octet-stream",
        filename=row.original_name or path.name,
        content_disposition_type="inline",
    )


@router.get("/{file_id}/text")
def read_text(file_id: int, db: Session = Depends(get_db)) -> dict:
    """把副本渲染成可读文本（docx / pdf / 纯文本），供「我的文件」的预览抽屉使用。

    与 ``/raw`` 的分工：``/raw`` 交给浏览器自己渲染（图片、pdf 够用），这个接口给
    **浏览器渲染不了的格式**（docx）与需要按文本呈现的纯文本文件。提取仍在本机做，
    不把文件发给任何第三方。
    """
    row = db.get(UserFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="文件副本不存在")
    path = _resolved_copy_path(row, db)
    size = path.stat().st_size
    if size > _MAX_TEXT_PREVIEW_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"文件超过 {_MAX_TEXT_PREVIEW_BYTES // (1024 * 1024)} MB，暂不支持在线预览",
        )
    try:
        text, warnings = preview_text_of_file(row.original_name or path.name, row.mime, path.read_bytes())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - 解析失败只给一句中文原因
        logger.warning(
            "提取副本文字失败 id=%s error_type=%s", int(file_id), type(exc).__name__
        )
        raise HTTPException(status_code=400, detail="读取这个文件失败（可能已损坏）") from exc
    return {"text": text, "warnings": warnings}


@router.post("/{file_id}/open-in-system")
def open_in_system(file_id: int, db: Session = Depends(get_db)) -> dict:
    """用系统默认程序打开该副本（Windows startfile / macOS open / Linux xdg-open）。"""
    row = db.get(UserFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="文件副本不存在")
    path = _resolved_copy_path(row, db)
    try:
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606 - 本机文件管理器语义，路径来自服务端自身
        elif sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=True, timeout=15)
        else:
            subprocess.run(["xdg-open", str(path)], check=True, timeout=15)
    except Exception as exc:  # noqa: BLE001 - 对外只给一句中文原因
        logger.warning(
            "用系统程序打开副本失败 id=%s error_type=%s", int(file_id), type(exc).__name__
        )
        raise HTTPException(
            status_code=400, detail="调用系统程序打开失败（文件关联缺失或没有权限）"
        ) from exc
    return {"ok": True}


@router.post("/{file_id}/reveal")
def reveal_in_folder(file_id: int, db: Session = Depends(get_db)) -> dict:
    """在系统文件管理器里打开副本所在的文件夹并选中该文件。

    与 ``open-in-system`` 的区别：这是"去看文件在哪"，不是"打开文件本身"。
    平台分支收在 ``services/system_reveal.py``（清理清单里的「在文件夹中显示」用的是
    同一份实现），这里只负责按 id 反查并守卫路径。
    """
    row = db.get(UserFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="文件副本不存在")
    path = _resolved_copy_path(row, db)
    try:
        reveal_path(path)
    except Exception as exc:  # noqa: BLE001 - 对外只给一句中文原因
        logger.warning(
            "打开副本所在文件夹失败 id=%s error_type=%s", int(file_id), type(exc).__name__
        )
        raise HTTPException(
            status_code=400, detail="打开所在文件夹失败（文件可能已移动或没有权限）"
        ) from exc
    return {"ok": True}
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
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user_file import UserFile
from ..services.user_files import user_files_dir

router = APIRouter(prefix="/api/user-files", tags=["user-files"])
logger = logging.getLogger(__name__)

# 列表单页上限：副本页是本机界面，100 条足够一次看完。
_MAX_PAGE_SIZE = 100


def _file_out(row: UserFile) -> dict:
    """回显结构：刻意不含 sha256 与 disk_name——它们是实现细节，不是给界面的。"""
    return {
        "id": row.id,
        "original_name": row.original_name,
        "mime": row.mime,
        "size": row.size,
        "source_type": row.source_type,
        "source_ref": row.source_ref,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("")
def list_user_files(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=_MAX_PAGE_SIZE),
    source_type: str = Query(default=""),
    keyword: str = Query(default=""),
    db: Session = Depends(get_db),
) -> dict:
    """分页列出副本；``keyword`` 模糊匹配原名，``source_type`` 精确过滤来源。"""
    query = db.query(UserFile)
    if source_type.strip():
        query = query.filter(UserFile.source_type == source_type.strip())
    if keyword.strip():
        query = query.filter(UserFile.original_name.like(f"%{keyword.strip()}%"))
    total = query.count()
    rows = (
        query.order_by(UserFile.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": [_file_out(row) for row in rows], "total": total}


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
    query = db.query(UserFile).filter(UserFile.source_type == source_type.strip())
    if source_ref.strip():
        ref = source_ref.strip()
        query = query.filter(
            or_(UserFile.source_ref == ref, UserFile.sources_json.contains(f'"{ref}"'))
        )
    if name.strip():
        query = query.filter(UserFile.original_name == name.strip())
    rows = query.order_by(UserFile.id.asc()).all()
    return {"items": [{"id": row.id, "original_name": row.original_name} for row in rows]}


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
        logger.warning("用系统程序打开副本失败 id=%s: %s", file_id, exc)
        raise HTTPException(status_code=400, detail=f"调用系统程序打开失败：{exc}") from exc
    return {"ok": True}


@router.post("/{file_id}/reveal")
def reveal_in_folder(file_id: int, db: Session = Depends(get_db)) -> dict:
    """在系统文件管理器里打开副本所在的文件夹并选中该文件。

    与 ``open-in-system`` 的区别：这是"去看文件在哪"，不是"打开文件本身"——
    Windows 用 ``explorer /select``，macOS 用 ``open -R``，Linux 打开所在目录。
    explorer 定位成功也常返回非零退出码（文档化行为），所以这里用 Popen
    发起即成功、不以退出码判失败。
    """
    row = db.get(UserFile, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="文件副本不存在")
    path = _resolved_copy_path(row, db)
    try:
        if sys.platform == "win32":
            # explorer /select, 后面必须紧跟目标路径（逗号是语法的一部分）。
            subprocess.Popen(["explorer", f"/select,{path}"])  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])  # noqa: S606
    except Exception as exc:  # noqa: BLE001 - 对外只给一句中文原因
        logger.warning("打开副本所在文件夹失败 id=%s: %s", file_id, exc)
        raise HTTPException(status_code=400, detail=f"打开所在文件夹失败：{exc}") from exc
    return {"ok": True}

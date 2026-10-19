"""自定义简历字体的上传/选用/删除（R10）。

从 `api/settings.py` 拆出来：设置接口已经很拥挤，而字体这一组是唯一涉及文件上传、
并且要主动让 PDF 字体探测缓存失效的端点，单独放一处边界更清楚。
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from ..services.pdf_exporter import reset_font_cache
from ..services.user_fonts import (
    MAX_BYTES,
    FontError,
    active_font_name,
    delete_font,
    list_fonts,
    save_font,
    set_active,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _require_loopback(request: Request) -> None:
    """字体只在本机上操作：与模型配置同一道防线（loopback 之外一律拒绝）。"""
    from .settings import _is_loopback_request

    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="字体只能在运行后端的本机修改")


@router.get("/fonts")
def read_resume_fonts() -> dict:
    """自定义简历字体列表（R10）：只回文件名/体积/是否在用，不回文件内容。"""

    return {
        "items": list_fonts(),
        "active": active_font_name(),
        "max_bytes": MAX_BYTES,
    }


@router.post("/fonts")
async def upload_resume_font(request: Request, file: UploadFile = File(...)) -> dict:
    """上传一个字体文件（ttf/otf/ttc，≤20MB）。不会自动设为当前字体。"""

    _require_loopback(request)
    data = await file.read(20 * 1024 * 1024 + 1)
    try:
        item = save_font(file.filename or "font.ttf", data)
    except FontError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 字体文件变了，PDF 导出的探测缓存必须失效，否则新字体会"上传成功但不生效"。
    reset_font_cache()
    return item


@router.put("/fonts/active")
def activate_resume_font(payload: dict, request: Request) -> dict:
    """设为当前字体；`name: null` 表示回到系统字体。"""

    _require_loopback(request)
    name = payload.get("name")
    try:
        set_active(str(name) if name else None)
    except FontError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    reset_font_cache()
    return {"active": active_font_name()}


@router.delete("/fonts/{name}", status_code=204)
def remove_resume_font(name: str, request: Request) -> None:

    _require_loopback(request)
    try:
        delete_font(name)
    except FontError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    reset_font_cache()

"""自定义简历字体的上传/选用/删除（R10）。

从 `api/settings.py` 拆出来：设置接口已经很拥挤，而字体这一组是唯一涉及文件上传、
并且要主动让 PDF 字体探测缓存失效的端点，单独放一处边界更清楚。
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile

from ..services.pdf_exporter import reset_font_cache
from ..services.resume_font_embed import active_web_font
from ..services.user_fonts import (
    MAX_BYTES,
    FontError,
    active_font_name,
    delete_font,
    font_path,
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


@router.get("/fonts/active/file")
def read_active_font_file() -> Response:
    """当前字体的原始字节（给前端/调试兜底）。

    正常预览不需要这个接口：``/render`` 返回的 HTML 里已经内嵌了子集化的 ``@font-face``。
    这里回的是**整份**字体，所以强制 ``no-store``——字体文件说换就换，缓存住旧字节只会
    让"我明明换了字体"变成玄学。
    """

    font = active_web_font()
    if font is None:
        raise HTTPException(status_code=404, detail="没有正在使用的自定义字体")
    return Response(
        content=font[1],
        media_type="font/ttf",
        headers={"Cache-Control": "no-store"},
    )


# 媒体类型只按扩展名给：浏览器用不到精确值，但给错会让 @font-face 直接不加载。
_FONT_MEDIA_TYPES = {
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".ttc": "font/collection",
}


@router.get("/fonts/{name}/file")
def read_font_file(name: str) -> Response:
    """任意一个已上传字体的原始字节（设置页"点击预览字体"用）。

    与 ``/fonts/active/file`` 的区别是它不要求字体正在使用：用户要在"设为当前"之前
    先看看效果，只给当前字体的字节等于让人盲选。仍然强制 no-store。
    """

    try:
        path = font_path(name)
    except FontError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=path.read_bytes(),
        media_type=_FONT_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "no-store"},
    )


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

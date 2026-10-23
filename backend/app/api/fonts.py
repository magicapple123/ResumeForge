# SPDX-License-Identifier: Apache-2.0
"""简历字体：列表/选用/重命名/删除/读文件（R10）。

从 `api/settings.py` 拆出来：设置接口已经很拥挤，而字体这一组是唯一涉及字体文件、
并且要主动让 PDF 字体探测缓存失效的端点，单独放一处边界更清楚。

**上传已下线**（2026-11）：`POST /fonts` 不再存在。字体来源收敛为"内置思源黑体按需
下载"（见 `api/font_builtin.py`）+ 历史上传的文件（继续可用、可切换、可删除）。存量
用户的字体文件与 `active.json` 都不动，所以他们的导出结果一个字节都没变。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from ..services import resume_font_builtin
from ..services.pdf_exporter import reset_font_cache
from ..services.pdf_exporter.font_subset import reset as reset_font_subset_cache
from ..services.pdf_preview_cache import clear as clear_preview_cache
from ..services.resume_font_embed import active_web_font
from ..services.user_fonts import (
    MAX_BYTES,
    FontError,
    active_font_name,
    delete_font,
    font_path,
    list_fonts,
    rename_font,
    set_active,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _invalidate_render_caches() -> None:
    """字体身份变了：三份缓存**都要**失效。

    - `reset_font_cache()`：决定"下次导出用哪个字体"；
    - `clear_preview_cache()`：把上一次排好的 PDF 字节丢掉（缓存键里没有字体文件本身）；
    - `font_subset.reset()`：丢掉"按旧字体裁出来的子集"——它的指纹里有字体 mtime，
      正常换字体不会串，但留着旧文件只是垃圾。
    """
    reset_font_cache()
    clear_preview_cache()
    reset_font_subset_cache()


def _require_loopback(request: Request) -> None:
    """字体只在本机上操作：与模型配置同一道防线（loopback 之外一律拒绝）。"""
    from .settings import _is_loopback_request

    if not _is_loopback_request(request):
        raise HTTPException(status_code=403, detail="字体只能在运行后端的本机修改")


def _builtin_font_item(active: str | None) -> dict:
    """内置思源黑体在列表里的那一条。

    两个文件（Regular / Bold）在界面上是**一款字体**：Bold 只是 Regular 的粗体字面，
    单独列出来会让人以为可以"只选粗体"。所以这里合成一条，``size`` 是两个文件之和。
    ``name`` 用 Regular 的文件名——它是 `format_config.font` 与 `active.json` 里真正
    存的那个键，前端"设为当前"直接回传这条的 ``name`` 即可。
    """
    names = {str(item["name"]) for item in resume_font_builtin.BUILTIN_FILES}
    regular = str(resume_font_builtin.BUILTIN_FILES[0]["name"])
    return {
        "name": regular,
        "display_name": resume_font_builtin.FONT_LABEL,
        "size": resume_font_builtin.total_bytes(),
        "uploaded_at": "",
        "active": active in names,
        "builtin": True,
        "downloaded": bool(resume_font_builtin.status()["downloaded"]),
    }


@router.get("/fonts")
def read_resume_fonts() -> dict:
    """简历字体列表（R10）：只回文件名/体积/是否在用，不回文件内容。

    内置思源黑体固定排在首位（``builtin: true``，``downloaded`` 表示本机是否已下载）；
    其余是历史上传的字体文件。
    """
    active = active_font_name()
    return {
        "items": [_builtin_font_item(active), *list_fonts()],
        "active": active,
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


@router.put("/fonts/active")
def activate_resume_font(payload: dict, request: Request) -> dict:
    """设为当前字体；`name: null` 表示回到系统字体。"""

    _require_loopback(request)
    name = payload.get("name")
    try:
        set_active(str(name) if name else None)
    except FontError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _invalidate_render_caches()
    return {"active": active_font_name()}


@router.patch("/fonts/{name}")
def rename_resume_font(name: str, payload: dict, request: Request) -> dict:
    """改字体的**展示名**：文件名与已引用它的简历都不受影响。"""

    _require_loopback(request)
    label = str(payload.get("display_name") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="字体名称不能为空")
    try:
        return rename_font(name, label)
    except FontError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/fonts/{name}", status_code=204)
def remove_resume_font(name: str, request: Request) -> None:

    _require_loopback(request)
    try:
        delete_font(name)
    except FontError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _invalidate_render_caches()

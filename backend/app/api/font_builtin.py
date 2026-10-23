# SPDX-License-Identifier: Apache-2.0
"""内置字体（思源黑体）的下载接口：查看状态、开始下载、轮询进度、删除。

接口分成"开始"与"轮询"两条：下载 32MB 可能要几十秒，同步等会让前端卡在一个不发包的
请求上（用户看到的最像"界面死了"）。所以 POST 立刻回 202 + 当前状态，前端按 GET 轮询
``downloaded_bytes``。

四条路由都挂在 ``/api/settings`` 下、与 ``fonts.py`` 同一个前缀。**注册顺序有意义**：
``fonts.py`` 有 ``DELETE /fonts/{name}``，如果它先注册，``DELETE /fonts/builtin`` 会被
当成"删一个叫 builtin 的字体"；所以本 router 必须在 ``fonts_api.router`` **之前**
include（见 ``application.py``）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from ..services import resume_font_builtin, user_fonts
from .fonts import _invalidate_render_caches, _require_loopback

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _builtin_names() -> set[str]:
    """内置字体全部文件名。**每次现算**而不是模块常量：常量会让"清单"在导入时被冻结，
    测试替换清单后仍指向真实文件名（`set_active` 于是指向一个不存在的文件）。"""
    return {str(item["name"]) for item in resume_font_builtin.BUILTIN_FILES}


def _regular_name() -> str:
    return str(resume_font_builtin.BUILTIN_FILES[0]["name"])


def _ensure_active(result: dict) -> dict:
    """下载完成后把 Regular 设为当前字体（用户点一次"下载"就该能直接导出）。

    已经有**自己上传的**字体在用时不动它：那是用户明确选过的偏好，被一次下载悄悄换掉
    属于"我明明选了字体"。当前选择为空或本身指向内置字体时才接管。

    返回值**就是** ``status()`` 的形状，不额外塞字段：这个响应与 ``BuiltinFontStatus``
    一一对应，多一个未声明的键会让"同一组接口返回同一个结构"变成一句空话（前端要读
    当前字体，去读 ``GET /api/settings/fonts`` 的 ``active``——那是唯一事实来源）。
    """
    if not result.get("downloaded"):
        return result
    current = user_fonts.active_font_name()
    if current is not None and current not in _builtin_names():
        return result
    if current == _regular_name():
        return result
    try:
        user_fonts.set_active(_regular_name())
    except user_fonts.FontError as exc:  # pragma: no cover - 刚落盘的文件不该找不到
        logger.warning("内置字体下载后设为当前失败：%s", exc)
        return result
    _invalidate_render_caches()
    return result


@router.get("/fonts/builtin")
def read_builtin_font() -> dict:
    """内置字体的下载状态（含 ``downloaded_bytes`` / ``total_bytes`` 供进度条）。"""
    return _ensure_active(resume_font_builtin.status())


@router.post("/fonts/builtin/download", status_code=202)
def download_builtin_font(request: Request) -> dict:
    """开始下载内置字体（后台线程），立刻返回 202 + 当前状态。"""
    _require_loopback(request)
    try:
        result = resume_font_builtin.start_download()
    except resume_font_builtin.FontBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except resume_font_builtin.FontDiskFull as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc
    return _ensure_active(result)


@router.get("/fonts/builtin/download")
def read_builtin_download() -> dict:
    """轮询下载进度（与 ``GET /fonts/builtin`` 同构，单独一条是为了前端语义清晰）。"""
    return _ensure_active(resume_font_builtin.status())


@router.delete("/fonts/builtin", status_code=204)
def remove_builtin_font(request: Request) -> None:
    """删除已下载的内置字体；当前选择指向它们时一并回到系统字体。"""
    _require_loopback(request)
    try:
        removed = resume_font_builtin.delete()
    except resume_font_builtin.FontNotDownloaded as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except resume_font_builtin.FontDownloadError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if user_fonts.active_font_name() in set(removed):
        user_fonts.set_active(None)
    _invalidate_render_caches()


__all__ = ["router"]

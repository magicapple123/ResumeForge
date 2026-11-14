# SPDX-License-Identifier: Apache-2.0
"""投递专用浏览器端点（从 ``api/apply.py`` 纯搬迁）。

为什么独立成模块：``api/apply.py`` 贴着 500 行预算。这 6 个端点是"投递专用浏览器"的
一个内聚单元（状态/启动/打开入口/刷新/重启/关闭），整体搬过来后由 ``api/apply.py`
以 ``include_router`` 挂回 ``/api/apply`` 路由树（**这里不写 prefix**，与
``apply_queue.py`` 等既有拆片一致）；注册位置保持原相对顺序（在 /sites 之后、
招呼语预览之前），路径与响应模型逐字不变。

``_raise`` 按既有拆片惯例在本模块保留一份同实现（与宿主 ``api/apply.py`` 的同名
helper 逐字一致）：拆片之间不互相 import 首页 helper，避免循环依赖。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.apply import BrowserStatusOut
from ..services.apply import apply_service

router = APIRouter(tags=["apply"])


def _raise(exc: apply_service.ApplyServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/browser/status", response_model=BrowserStatusOut)
def browser_status(db: Session = Depends(get_db)):
    return apply_service.browser_status(db)


@router.post("/browser/start", response_model=BrowserStatusOut)
def browser_start(open_entry: bool = True, db: Session = Depends(get_db)):
    """启动专用浏览器。

    ``open_entry=false`` 时**不打开任何站点页面**（停在空白页）。投递台保持默认——它要那个
    页面来让用户登录；把浏览器当渲染引擎借用的调用方则传 ``false``，否则用户会莫名其妙
    跳出一个他这次没打算访问的招聘网站。
    """
    try:
        return apply_service.start_browser(db, open_entry=open_entry)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)


@router.post("/browser/open", response_model=BrowserStatusOut)
def browser_open(db: Session = Depends(get_db)):
    """在已启动的专用浏览器里重新打开招聘网站入口（标签页被关掉或跳走后使用）。"""
    try:
        return apply_service.open_browser_url(db)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)


@router.post("/browser/refresh", response_model=BrowserStatusOut)
def browser_refresh(db: Session = Depends(get_db)):
    try:
        return apply_service.refresh_browser(db)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)


@router.post("/browser/restart", response_model=BrowserStatusOut)
def browser_restart(db: Session = Depends(get_db)):
    try:
        return apply_service.restart_browser(db)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)


@router.post("/browser/stop", status_code=204)
def browser_stop(db: Session = Depends(get_db)):
    """关闭专用浏览器。

    关不掉时（窗口是上一次运行留下的）必须给出可展示的中文提示，不能静默成功——
    与 /browser/start、/browser/open 用同一套错误映射。
    """
    try:
        apply_service.stop_browser(db)
    except apply_service.ApplyServiceError as exc:
        _raise(exc)
    return None


__all__ = ["router"]

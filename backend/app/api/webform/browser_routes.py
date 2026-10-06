"""浏览器生命周期与网址历史路由（职责②）。

从 ``api/webform.py`` 拆出。服务层符号一律经 ``webform_service`` 属性访问，
保证包属性 patch（``app.api.webform.webform_service.*``）继续生效。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.webform import (
    BrowserStatusOut,
    WebFormOpenUrlIn,
    WebFormUrlHistoryListOut,
    WebFormUrlHistoryOut,
)
from ...services import webform as webform_service
from ._shared import logger

router = APIRouter(prefix="/api/webform", tags=["webform"])


# ===== 浏览器 =====
#
# 网申使用独立的浏览器生命周期、CDP 端口和用户目录。这样投递台打开入口页时不会覆盖
# 用户正在填写的网申页面，两个功能可以同时使用。


@router.get("/browser/status", response_model=BrowserStatusOut)
def browser_status(db: Session = Depends(get_db)):
    status = webform_service.browser.browser_status(db)
    # 浏览器可能由用户直接关掉，不能只让前端看到 stopped；后台实时会话也要
    # 同步收摊，否则浏览器重新打开后页面会误以为旧监听仍然有效。
    if status.state == "stopped" and webform_service.is_live_running():
        webform_service.stop_live()
    return status


@router.post("/browser/start", response_model=BrowserStatusOut)
def browser_start(db: Session = Depends(get_db)):
    from .live_routes import (
        _start_live_session,  # 延迟导入：保持拆分前 browser 域先于 live 域的路由注册顺序
    )
    try:
        status = webform_service.browser.start_browser(db)
    except Exception as exc:  # noqa: BLE001 - 与投递台同一套错误映射
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 浏览器起来就**立即自动开启**智能逐项填表：历历球随首个页面注入，不用等
    # 用户发现"怎么还没出现"再手动开。失败不阻断——轮询自愈与前端兜底都在。
    try:
        _start_live_session(db)
    except Exception as exc:  # noqa: BLE001 - 页面未就绪时靠轮询自愈重装
        logger.warning("浏览器启动后自动开启实时填表失败（稍后自愈）：%s", exc)
    return status


@router.post("/browser/open-url")
def browser_open_url(payload: WebFormOpenUrlIn, db: Session = Depends(get_db)):
    from .live_routes import (
        _start_live_session,  # 延迟导入：保持拆分前 browser 域先于 live 域的路由注册顺序
    )
    try:
        url = webform_service.url_history.normalize_url(payload.url)
        result = webform_service.browser.open_url(db, url)
        webform_service.url_history.remember_url(db, url)
    except (ValueError, webform_service.browser.BrowserError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 同 browser/start：打开目标页面即自动开启实时填表，历历球随页面就绪出现。
    try:
        _start_live_session(db)
    except Exception as exc:  # noqa: BLE001 - 页面未就绪时靠轮询自愈重装
        logger.warning("打开页面后自动开启实时填表失败（稍后自愈）：%s", exc)
    return result


@router.get("/url-history", response_model=WebFormUrlHistoryListOut)
def list_url_history(db: Session = Depends(get_db)):
    return {"items": [WebFormUrlHistoryOut.model_validate(item) for item in webform_service.url_history.list_urls(db)]}


@router.delete("/url-history/{item_id}", status_code=204)
def delete_url_history(item_id: int, db: Session = Depends(get_db)):
    if not webform_service.url_history.delete_url(db, item_id):
        raise HTTPException(status_code=404, detail="网址历史不存在")


@router.post("/browser/stop", status_code=204)
def browser_stop(db: Session = Depends(get_db)):
    webform_service.browser.stop_browser(db)
    webform_service.stop_live()


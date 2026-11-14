# SPDX-License-Identifier: Apache-2.0
"""「登录状态」面板的接口层（Q12）。

四个端点，语义严格分开：
- ``GET  /api/login-status``                 只读缓存，**绝不触发检测**
- ``POST /api/login-status/{id}/check``      用户点了才跑一次（60 秒限流）
- ``POST /api/login-status/{id}/relogin``    浏览器类去开登录页；Cookie 类返回"要粘贴"
- ``PUT  /api/login-status/track_cookie``    写入 Cookie 后自动复检

路由注册在 ``application_routers.py``（由集成者统一加，本文件只提供 router）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import login_status, login_status_sites
from ..services.webform import browser as webform_browser

router = APIRouter(prefix="/api/login-status", tags=["login-status"])


class WebFormSiteOut(BaseModel):
    """网申站点的一行（F07）：host 是唯一标识，其余都可展示/可检测。"""

    host: str
    label: str
    probe_url: str
    status: str
    checked_at: str
    detail: str


class WebFormSiteListOut(BaseModel):
    items: list[WebFormSiteOut]
    #: 去重后的站点总数与因上限被截掉的条数（界面要能提示"还有 N 个没列出来"）。
    total: int
    truncated: int


class LoginStatusOut(BaseModel):
    id: str
    label: str
    browser: bool
    probe_url: str
    status: str
    checked_at: str
    detail: str
    #: 仅 `webform_browser` 会带：逐站点的登录状态（空列表 = 没有历史，走旧单行口径）。
    sites: list[WebFormSiteOut] = Field(default_factory=list)


class SiteIn(BaseModel):
    """只接受 host：服务端派生清单之外的地址一律 404（不接受前端传任意 URL）。"""

    model_config = ConfigDict(extra="forbid")

    host: str = Field(min_length=1, max_length=255)


class ReloginOut(BaseModel):
    id: str
    #: Chrome 式"开一个登录页"的浏览器类返回 ``opened``；Cookie 类返回 ``needs_paste``。
    action: str
    url: str


class TrackCookieIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 空串 = 清除（与设置页那条同源，不建第二份写入路径）。
    cookie: str = Field(default="", max_length=20_000)


@router.get("", response_model=list[LoginStatusOut])
def read_login_statuses(db: Session = Depends(get_db)) -> list[LoginStatusOut]:
    """三个来源的当前状态。**只读缓存**：浏览器类检测会弹窗，绝不能自动跑。"""
    return [LoginStatusOut(**item) for item in login_status.list_statuses(db)]


# 站点路由必须排在 `/{source}/...` 之前：`webform-sites` 也会匹配 `{source}`，
# 顺序反了就会被"未知的登录来源"吃掉（与 `/baseline` 那类先例同一个坑）。
@router.get("/webform-sites", response_model=WebFormSiteListOut)
def read_webform_sites(db: Session = Depends(get_db)) -> WebFormSiteListOut:
    """网申站点清单（只读缓存，绝不触发检测）。"""
    return WebFormSiteListOut(**login_status_sites.webform_sites_payload(db))


@router.post("/webform-sites/check", response_model=WebFormSiteOut)
def check_webform_site(payload: SiteIn, db: Session = Depends(get_db)) -> WebFormSiteOut:
    try:
        row = login_status_sites.check_webform_site(db, payload.host)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="该站点不在网申站点清单里") from error
    except login_status.LoginStatusBusy as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    return WebFormSiteOut(**row)


@router.post("/webform-sites/relogin", response_model=ReloginOut)
def relogin_webform_site(payload: SiteIn, db: Session = Depends(get_db)) -> ReloginOut:
    site = login_status_sites.find_webform_site(db, payload.host)
    if site is None:
        raise HTTPException(status_code=404, detail="该站点不在网申站点清单里")
    url = site["probe_url"]
    if not url:
        raise HTTPException(status_code=409, detail="没有可用的探测地址")
    try:
        webform_browser.open_url(db, url)
    except Exception as error:  # noqa: BLE001 - 起不来要说清原因，不能 500
        raise HTTPException(
            status_code=503, detail=f"浏览器没能打开登录页（{type(error).__name__}）"
        ) from error
    return ReloginOut(id=f"webform_site:{site['host']}", action="opened", url=url)


@router.post("/{source}/check", response_model=LoginStatusOut)
def check_login_status(source: str, db: Session = Depends(get_db)) -> LoginStatusOut:
    if source not in login_status.source_ids():
        raise HTTPException(status_code=404, detail="未知的登录来源")
    try:
        login_status.check(db, source)
    except login_status.LoginStatusBusy as error:
        # 429 + 剩余秒数：界面要能显示"还剩 N 秒"，不能只说"太快了"。
        raise HTTPException(status_code=429, detail=str(error)) from error
    # 回读统一走 `list_statuses`：字段只在那里列一次，避免两个出口漏字段/给出不一致的值。
    item = next(row for row in login_status.list_statuses(db) if row["id"] == source)
    return LoginStatusOut(**item)


@router.post("/{source}/relogin", response_model=ReloginOut)
def relogin(source: str, db: Session = Depends(get_db)) -> ReloginOut:
    if source not in login_status.source_ids():
        raise HTTPException(status_code=404, detail="未知的登录来源")
    if source == "track_cookie":
        # Cookie 类没有"浏览器窗口"可开：让前端给粘贴框。
        return ReloginOut(id=source, action="needs_paste", url=login_status.relogin_url(db, source))
    url = login_status.relogin_url(db, source)
    if not url:
        raise HTTPException(status_code=409, detail="没有可用的探测地址")
    try:
        if source == "webform_browser":
            webform_browser.open_url(db, url)
        else:
            from ..services.apply import get_browser_manager

            manager = get_browser_manager(db)
            manager.start(url)
    except Exception as error:  # noqa: BLE001 - 起不来要说清原因，不能 500
        raise HTTPException(
            status_code=503, detail=f"浏览器没能打开登录页（{type(error).__name__}）"
        ) from error
    return ReloginOut(id=source, action="opened", url=url)


@router.put("/track_cookie", response_model=LoginStatusOut)
def save_track_cookie(payload: TrackCookieIn, db: Session = Depends(get_db)) -> LoginStatusOut:
    login_status.save_track_cookie(db, payload.cookie)
    item = next(row for row in login_status.list_statuses(db) if row["id"] == "track_cookie")
    return LoginStatusOut(**item)

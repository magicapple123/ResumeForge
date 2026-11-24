# SPDX-License-Identifier: Apache-2.0
"""「登录状态」面板的接口层（Q12）。

四个端点，语义严格分开：
- ``GET  /api/login-status``                 只读缓存，**绝不触发检测**
- ``POST /api/login-status/{id}/check``      用户点了才跑一次（60 秒限流）
- ``POST /api/login-status/{id}/relogin``    浏览器类去开登录页
- ``GET/PUT /api/login-status/accounts/{host}``  账号备注的读取 / 写入（原条目 8 A1）

外加 T1「保持登录」的一次性说明（两个静态段路由，不建表、只读写 `AppSetting` KV）：
- ``GET  /api/login-status/notice``          只读：天数 + 首次生效时刻 + 是否已展示
- ``POST /api/login-status/notice/ack``      标记已展示（幂等）

账号备注**按 host** 存 `AppSetting` KV（``login_account.<host>``），不建表、不迁移：
它是用户自己填的一行文字，没有任何关联查询，"为它开一张表"只会多一份要维护的结构。

（原先的 ``PUT /api/login-status/track_cookie`` 随「申请状态回读」整条移除：那一行既没有
配置入口，也就不该有写入路径。已存的 Cookie 由迁移 ``remove_tracker_probe_settings`` 清除。）

路由注册在 ``application_routers.py``（由集成者统一加，本文件只提供 router）。
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import login_status, login_status_sites
from ..services.browser import session_cookie_keepalive
from ..services.webform import browser as webform_browser

router = APIRouter(prefix="/api/login-status", tags=["login-status"])

#: host 只接受 DNS 形态（字母数字 + `-` + `.`）：它会拼进 KV 的键名，
#: 放任换行 / 斜杠 / 百分号就是一条能写到任意键上的注入口子。
_HOST_PATTERN = re.compile(
    r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"
)


class WebFormSiteOut(BaseModel):
    """网申站点的一行（F07）：host 是唯一标识，其余都可展示/可检测。"""

    host: str
    label: str
    probe_url: str
    status: str
    checked_at: str
    detail: str
    #: 用户手写的账号备注（原条目 8 A1）：空串 = 未填写，**不是**实时账号。
    account: str = ""


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
    #: 该行的 host（投递浏览器用来显示同一条账号备注；汇总行为空串）。
    host: str = ""
    #: 该 host 的账号备注（空串 = 未填写）。
    account: str = ""
    #: 仅 `webform_browser` 会带：逐站点的登录状态（空列表 = 没有历史，走旧单行口径）。
    sites: list[WebFormSiteOut] = Field(default_factory=list)


class SiteIn(BaseModel):
    """只接受 host：服务端派生清单之外的地址一律 404（不接受前端传任意 URL）。"""

    model_config = ConfigDict(extra="forbid")

    host: str = Field(min_length=1, max_length=255)


class AccountNoteIn(BaseModel):
    """账号备注的写入体。超长不报错：服务层按 64 字符截断（见 `MAX_ACCOUNT_NOTE`）。"""

    model_config = ConfigDict(extra="forbid")

    note: str = ""


class AccountNoteOut(BaseModel):
    host: str
    #: 落库后的值（已去首尾空白、已截断）；空串 = 已清除。
    note: str


class ReloginOut(BaseModel):
    id: str
    #: 浏览器类返回 ``opened``：Chrome 式"开一个登录页"。
    action: str
    url: str


class KeepSessionNoticeOut(BaseModel):
    """「保持登录」的一次性说明（T1）。

    **只给天数，不给正文**：正文只有前端 i18n 一份（`applyUi.loginStatus.keepSessionNotice`）；
    把中文模板从这里下发，英文界面就会漏中文。

    ``days == 0`` 是"无可展示"的约定，两种原因都落到它：功能还没真正生效过、
    或者用户已经把「保持登录」关掉了（后者再说"已开始帮你保持"就是假话）。
    前端拿 ``days > 0 && !delivered`` 判渲染，不需要区分这两种原因——两种都该不显示。
    """

    days: int
    #: 功能首次真正生效的时刻（ISO 串，原样下发，不做时区换算；开关关闭时仍如实下发）。
    first_effective_at: str
    #: 是否已经展示过（True 时前端不再渲染这条说明）。
    delivered: bool


class KeepSessionNoticeAckOut(BaseModel):
    #: 固定 True：幂等接口，重复 ack 也返回成功（客户端只关心"这次之后算已展示"）。
    delivered: bool


def _clean_host(raw: str) -> str:
    """校验并规范化 host；不合法直接 400，不做"尽力而为"的清洗。"""
    host = str(raw or "").strip().lower()
    if not _HOST_PATTERN.match(host):
        raise HTTPException(status_code=400, detail="host 不合法")
    return host


@router.get("", response_model=list[LoginStatusOut])
def read_login_statuses(db: Session = Depends(get_db)) -> list[LoginStatusOut]:
    """两个来源的当前状态。**只读缓存**：浏览器类检测会弹窗，绝不能自动跑。"""
    return [LoginStatusOut(**item) for item in login_status.list_statuses(db)]


@router.get("/notice", response_model=KeepSessionNoticeOut)
def read_keep_session_notice(db: Session = Depends(get_db)) -> KeepSessionNoticeOut:
    """「保持登录」的一次性说明（T1）：只读，**绝不触发检测、也不写任何键**。

    ``days`` 取**当前策略**（`read_policy().normalized_days()`，与后台续期线程同一个
    读取口，避免两处各算一份天数），但只在"确实在保"时给出，下列两种情况一律 ``0``
    （前端据此整条不渲染）：

    1. ``read_notice`` 为空——功能还没真正生效过；
    2. 策略 ``enabled=false``——用户已经关掉开关，这时候说"我们已开始帮你保持登录"
       是假话（历史生效记录仍然如实下发，不擦）。
    """
    first_effective_at = session_cookie_keepalive.read_notice(db)
    delivered = session_cookie_keepalive.notice_delivered(db)
    policy = session_cookie_keepalive.read_policy(db)
    days = policy.normalized_days() if (first_effective_at and policy.enabled) else 0
    return KeepSessionNoticeOut(
        days=days, first_effective_at=first_effective_at, delivered=delivered
    )


@router.post("/notice/ack", response_model=KeepSessionNoticeAckOut)
def ack_keep_session_notice(db: Session = Depends(get_db)) -> KeepSessionNoticeAckOut:
    """标记一次性说明已展示（幂等）：重复调用不报错，一律回 200 + ``delivered=True``。

    ``mark_notice_delivered`` 的返回值只表示"这次是否真的写了"，客户端不需要它，
    所以这里不往下透传——透传会让前端误以为第二次 ack 失败了。
    """
    session_cookie_keepalive.mark_notice_delivered(db)
    return KeepSessionNoticeAckOut(delivered=True)


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


@router.get("/accounts/{host}", response_model=AccountNoteOut)
def read_account_note(host: str, db: Session = Depends(get_db)) -> AccountNoteOut:
    """读一个 host 的账号备注（只读 KV，不触发任何检测）。"""
    cleaned = _clean_host(host)
    return AccountNoteOut(host=cleaned, note=login_status.read_account_note(db, cleaned))


@router.put("/accounts/{host}", response_model=AccountNoteOut)
def write_account_note(
    host: str, payload: AccountNoteIn, db: Session = Depends(get_db)
) -> AccountNoteOut:
    """写 / 清除一个 host 的账号备注（空串 = 清除，超长按 64 字符截断）。

    返回值是**落库后**的值，前端直接用它刷新显示，不要自己再截一次。
    """
    cleaned = _clean_host(host)
    saved = login_status.write_account_note(db, cleaned, payload.note)
    return AccountNoteOut(host=cleaned, note=saved)


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

# SPDX-License-Identifier: Apache-2.0
"""「登录状态」面板的服务层：三处彼此隔离的登录态，统一检测 + 缓存 + 限流。

## 为什么要它

三处登录态（投递浏览器 profile / 网申浏览器 profile / 门户 Cookie）各有独立的存储，
彼此完全隔离——"投递能登、网申没登"完全可能，而界面上此前**一处都查不了**。
用户只会在真正撞上登录墙（回读 0 条、投递失败）时才知道哪一处掉了。

## 三条硬约束（少一条就会变成"更糟的体验"）

1. **`unknown` 不许写成 `expired`**：站点改版 / 网络抖动 / 风控拦截都会让探测页拿不到
   登录特征。误报"已失效"会逼用户反复重登，比不报更糟。
2. **不许自动检测**：浏览器类检测会真的弹窗、耗时数秒并抢焦点，只能由用户点。
3. **同来源 60 秒内不重复检测**：频繁探测本身有风控风险；限流状态只在内存里。

## 状态存哪

`AppSetting` 的 KV（`login_status.<source>` 一行 JSON），**零迁移**：
`{"status": "ok|logged-out|expired|unknown|unchecked", "checked_at": "...", "detail": "..."}`
探测 URL 也存 KV（`login_status.probe_url.<source>`），因为站点改版就得换，不能写死成唯一真相。

## I-29：为什么不是"没看到登录墙 = 已登录"

公开岗位页永远不会有登录墙，所以"没看到登录墙"对岗位页是**恒真**的——旧判据结构上就不可能
发现"未登录"。现在的判据只有三态来源：登录页特征 / 独立「登录」CTA → `logged-out`；
账号标记（退出登录 / 个人中心…）→ `ok`；其余 → `unknown`。**公开页的内容本身永远不给 `ok`。**
`expired` 只保留读取（老数据仍显示「已失效」），探测器不再新写。
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from . import track_probe
from .track_portal import looks_like_login_page
from .track_probe_settings import read_cookie, write_settings

logger = logging.getLogger(__name__)

LoginStatusValue = Literal["ok", "logged-out", "expired", "unknown", "unchecked"]

#: 状态 JSON 的白名单。**加新状态必须同时加到这里**，否则存进去会被静默读成 `unchecked`。
_STATUS_VALUES = ("ok", "logged-out", "expired", "unknown", "unchecked")

# 判定登录页的 URL path 特征（只认路径段，避免 `?redirect=/login` 这类参数误伤）。
_LOGIN_PATH = re.compile(r"/(login|signin|sign-in|passport|sso|auth)(/|$)", re.IGNORECASE)
# 英文 ATS 的登录页措辞：命中 >=2 个 **且** 短页 **且** 有密码框才判 logged-out。
_LOGIN_WORDS = (
    "sign in",
    "log in",
    "login",
    "password",
    "forgot password",
    "create account",
    "username",
    "email address",
)
#: 账号标记：页面上出现这些词说明**已经登录**（比"没看到登录墙"硬得多）。
_ACCOUNT_MARKERS = (
    "退出登录",
    "个人中心",
    "我的投递",
    "我的简历",
    "账号设置",
    "sign out",
    "log out",
    "my applications",
    "my profile",
    "account settings",
)
#: 「退出登录」里含「登录」：匹配登录 CTA 前必须先剔除这些短语，否则登录后的页会被判成未登录。
_LOGOUT_PHRASES = re.compile(r"退出\s*登录|安全退出|登出")
#: 独立的登录 CTA：整行只写这几个字（按钮在 `innerText` 里通常独占一行）。
_LOGIN_CTA_TOKENS = frozenset(
    {
        "登录",
        "立即登录",
        "去登录",
        "请登录",
        "马上登录",
        "登录/注册",
        "登录 | 注册",
        "sign in",
        "log in",
        "login",
        "sign in / register",
        "sign in or register",
    }
)

#: 三个来源。`id` 同时也是 KV 后缀与前端行标识；`browser=True` 的会真的拉起浏览器。
SOURCES: tuple[dict[str, Any], ...] = (
    {"id": "apply_browser", "browser": True, "label": "投递浏览器"},
    {"id": "webform_browser", "browser": True, "label": "网申浏览器"},
    {"id": "track_cookie", "browser": False, "label": "门户 Cookie"},
)

SOURCE_IDS = tuple(item["id"] for item in SOURCES)

_STATUS_KEY = "login_status.{source}"
_PROBE_URL_KEY = "login_status.probe_url.{source}"
#: 同一来源两次检测的最小间隔（秒）。存内存：这是"别把站点惹毛"的护栏，不是业务数据。
COOLDOWN_SECONDS = 60
_cooldowns: dict[str, float] = {}
_cooldown_lock = threading.Lock()


class LoginStatusBusy(RuntimeError):
    """还在冷却期：带上剩余秒数，界面要能显示"还剩 N 秒"。"""

    def __init__(self, remaining: int) -> None:
        super().__init__(f"刚检测过，{remaining} 秒后可以再检测")
        self.remaining = remaining


def _read_setting(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    return row.value if row is not None else ""


def _write_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _status_key(source: str) -> str:
    return _STATUS_KEY.format(source=source)


def _probe_url_key(source: str) -> str:
    return _PROBE_URL_KEY.format(source=source)


def source_ids() -> tuple[str, ...]:
    return SOURCE_IDS


def _default_probe_url(db: Session, source: str) -> str:
    """按来源给默认探测地址（F12：它是"某个来源"的默认值，不是全局唯一入口）。

    - `apply_browser` → 当前投递站点的入口页（不变）；
    - `webform_browser` → 最近一次网申地址（填充记录与网址历史里更晚的那条）；
    - `track_cookie` → 投递记录页（`track_probe_settings.page_url`）。

    取不到一律留空：空 URL 时检测直接落 `unknown` + 原因，而不是去猜一个站点。
    """
    if source == "webform_browser":
        return _latest_webform_url(db)
    if source == "track_cookie":
        try:
            from .track_probe_settings import read_settings

            return str(read_settings(db).page_url or "").strip()
        except Exception:  # noqa: BLE001 - 配置读不出来不该让整个面板 500
            logger.warning("login_status: cannot resolve track page url", exc_info=True)
            return ""
    try:
        # 定义在 `apply/_site_browser.py`，**没有**从 `app.services.apply` 再导出——
        # 早先那句 `from .apply import default_entry_url` 会 ImportError，被下面的
        # except 吞掉之后探测地址永远是空串（"没有可用的探测地址"），是个真实的静默失败。
        from .apply._site_browser import default_entry_url

        return default_entry_url(db)
    except Exception:  # noqa: BLE001 - 站点注册表坏了不该让整个面板 500
        logger.warning("login_status: cannot resolve default probe url", exc_info=True)
        return ""


def _latest_webform_url(db: Session) -> str:
    """网申的默认探测地址：填充记录与网址历史里**更晚**的那条（F12）。

    填充记录带 `page_title`、是"真的填过"的证据；网址历史是"打开过"。两者都没有就留空。
    """
    try:
        from .webform import history as webform_history
        from .webform import url_history
    except Exception:  # noqa: BLE001
        return ""
    pairs: list[tuple[datetime, str]] = []
    records = webform_history.list_records(db, limit=1)
    if records and records[0].url:
        pairs.append((records[0].created_at, records[0].url))
    history = url_history.list_urls(db, limit=1)
    if history and history[0].url:
        pairs.append((history[0].last_used_at, history[0].url))
    if not pairs:
        return ""
    return max(pairs, key=lambda item: item[0] or datetime.min)[1].strip()


def probe_url(db: Session, source: str) -> str:
    configured = _read_setting(db, _probe_url_key(source)).strip()
    return configured or _default_probe_url(db, source)


def set_probe_url(db: Session, source: str, url: str) -> None:
    _write_setting(db, _probe_url_key(source), url.strip())
    db.commit()


def _parse_status_record(
    raw: str, *, current_probe_url: str | None, reset_legacy: bool
) -> dict[str, Any]:
    """一份状态 JSON → 对外结构（含"探测地址变了就作废"的失效判定）。

    F12 的旧缓存失效：记下当次探测地址，读取时不一致 → `unchecked`（detail 写原因）。
    老数据（改动前写的 JSON）没有这个键：只重置 `webform_browser` / `track_cookie`，
    `apply_browser` 不动——它的默认地址一直是同一套（投递站点入口），没必要清掉。
    """
    empty = {"status": "unchecked", "checked_at": "", "detail": ""}
    if not raw:
        return empty
    try:
        parsed = json.loads(raw)
    except ValueError:
        return empty
    if not isinstance(parsed, dict):
        return empty
    status = parsed.get("status")
    if status not in _STATUS_VALUES:
        status = "unchecked"
    recorded = str(parsed.get("probe_url") or "")
    if "probe_url" not in parsed:
        if reset_legacy:
            return {**empty, "detail": "探测地址已变化"}
    elif current_probe_url and recorded and recorded != current_probe_url:
        return {**empty, "detail": "探测地址已变化"}
    return {
        "status": status,
        "checked_at": str(parsed.get("checked_at") or ""),
        "detail": str(parsed.get("detail") or ""),
    }


def read_status(db: Session, source: str, *, probe: str | None = None) -> dict[str, Any]:
    """读缓存（**不触发任何检测**）。没检测过就是 `unchecked`，不要用 `ok` 冒充。"""
    current = probe_url(db, source) if probe is None else probe
    return _parse_status_record(
        _read_setting(db, _status_key(source)),
        current_probe_url=current,
        reset_legacy=source in ("webform_browser", "track_cookie"),
    )


def _save_status(
    db: Session,
    source: str,
    status: LoginStatusValue,
    detail: str,
    *,
    probe: str = "",
) -> dict[str, Any]:
    payload = {"status": status, "checked_at": _now(), "detail": detail, "probe_url": probe}
    _write_setting(db, _status_key(source), json.dumps(payload, ensure_ascii=False))
    db.commit()
    return payload


def _aggregate_sites(sites: list[dict[str, Any]]) -> dict[str, Any]:
    """父行状态由站点聚合：`logged-out` > `expired` > 全 `ok` > `unknown`。

    未登录必须压过"已失效"：前者是可操作状态（去登录就行），后者是故障。
    """
    statuses = [site["status"] for site in sites]
    if "logged-out" in statuses:
        status: LoginStatusValue = "logged-out"
    elif "expired" in statuses:
        status = "expired"
    elif statuses and all(value == "ok" for value in statuses):
        status = "ok"
    else:
        status = "unknown"
    ok_count = sum(1 for value in statuses if value == "ok")
    out_count = sum(1 for value in statuses if value == "logged-out")
    detail = f"{len(sites)} 个站点 · {ok_count} 正常"
    if out_count:
        # 不写这一截，父行会永远是「无法判断」，而子行明明已经确定。
        detail += f" · {out_count} 未登录"
    checked = [str(site["checked_at"]) for site in sites if site["checked_at"]]
    return {
        "status": status,
        "checked_at": max(checked) if checked else "",
        "detail": detail,
    }


def list_statuses(db: Session) -> list[dict[str, Any]]:
    from .login_status_sites import site_probe_url, webform_sites

    items: list[dict[str, Any]] = []
    sites = webform_sites(db)
    for source in SOURCES:
        probe = probe_url(db, source["id"])
        row = {
            "id": source["id"],
            "label": source["label"],
            "browser": bool(source["browser"]),
            "probe_url": probe,
            "sites": [],
            **read_status(db, source["id"], probe=probe),
        }
        if source["id"] == "webform_browser" and sites:
            # 有站点清单时父行只做汇总，**不再单独探测**（F07）：一个笼统的"正常"对
            # "Moka 还登着、北森掉了"这种局面没有意义。
            row.update(_aggregate_sites(sites))
            row["sites"] = sites
            row["probe_url"] = site_probe_url(db)
        items.append(row)
    return items


def _take_cooldown(source: str) -> None:
    """占一个冷却名额；还在冷却期就抛 :class:`LoginStatusBusy`（带剩余秒数）。"""
    now = time.monotonic()
    with _cooldown_lock:
        last = _cooldowns.get(source)
        if last is not None:
            remaining = COOLDOWN_SECONDS - int(now - last)
            if remaining > 0:
                raise LoginStatusBusy(remaining)
        _cooldowns[source] = now


def reset_cooldowns() -> None:
    """清空限流（测试用；也用于"用户刚刚重新登录成功"这种该立刻复检的场景）。"""
    with _cooldown_lock:
        _cooldowns.clear()


def _has_login_cta(text: str) -> bool:
    """页面上是否有一个**独立的**「登录」入口（按钮 / 链接，整行只有它）。

    先剔除「退出登录」类短语：登录后的页面导航里也有「登录」两个字，不剔除就会把
    已登录的页面判成未登录。
    """
    for line in _LOGOUT_PHRASES.sub("", text).splitlines():
        token = line.strip().strip("·|/>»").strip().lower()
        if token in _LOGIN_CTA_TOKENS:
            return True
    return False


def _judge(
    text: str, *, href: str = "", has_password: bool = False
) -> tuple[LoginStatusValue, str]:
    """登录态判定：**一处实现**，Cookie / 投递浏览器 / 网申站点共用。

    顺序固定，`ok` 只能来自账号标记（受限页可访问由 `login_status_sites` 另行给出）：
    公开页即使正文完整、看起来一切正常，也只能是 `unknown`——"没看到登录墙"对公开页恒真。
    """
    body = str(text or "")
    path = urlsplit(href).path if href else ""
    if path and _LOGIN_PATH.search(path):
        return "logged-out", "停在登录页"
    if looks_like_login_page(body):
        return "logged-out", "停在登录页"
    lowered = body.lower()
    hits = sum(1 for word in _LOGIN_WORDS if word in lowered)
    if hits >= 2 and len(body) < 600 and has_password:
        return "logged-out", "页面像登录页（英文）"
    if any(marker in lowered for marker in _ACCOUNT_MARKERS):
        return "ok", "页面有账号标记"
    if _has_login_cta(body):
        return "logged-out", "页面显示登录入口"
    if len(body.strip()) < 20:
        return "unknown", "页面内容过少，无法判断"
    return "unknown", ""


def _probe_cookie(db: Session, url: str | None = None) -> tuple[LoginStatusValue, str]:
    cookie = read_cookie(db)
    if not cookie:
        # **不是 expired**：从没配过和配了但失效是两件事。
        return "unchecked", "未配置 Cookie"
    target = probe_url(db, "track_cookie") if url is None else url
    if not target:
        return "unknown", "没有可用的探测地址"
    result = track_probe._read_page(db, target, cookie, None)  # noqa: SLF001 - 复用 SSRF 逐跳校验
    if isinstance(result, str):
        return "unknown", result
    text, final_url = result
    return _judge(text, href=str(final_url or ""))


def _probe_browser(db: Session, source: str, url: str) -> tuple[LoginStatusValue, str]:
    if not url:
        return "unknown", "没有可用的探测地址"
    try:
        if source == "webform_browser":
            from .webform import browser as webform_browser

            manager = webform_browser.get_browser_manager(db)
        else:
            from .apply import get_browser_manager

            manager = get_browser_manager(db)
        manager.start(url)
        client = manager.client()
        client.navigate(url)
        text = client.evaluate("(document.body && document.body.innerText) || ''")
    except Exception as error:  # noqa: BLE001 - 起不来就是"无法判断"，不是"已失效"
        return "unknown", f"浏览器没能打开探测页（{type(error).__name__}）"
    return _judge(str(text or ""))


def check(db: Session, source: str) -> dict[str, Any]:
    """跑一次检测并写回。**用户点了才跑**（浏览器类会弹窗、耗时数秒）。"""
    if source not in SOURCE_IDS:
        raise KeyError(source)
    from .login_status_sites import webform_sites

    if source == "webform_browser" and webform_sites(db):
        # F07：有站点清单时父行是汇总行——「检测」交给逐个站点，这里既不探测也不占限流。
        return next(row for row in list_statuses(db) if row["id"] == source)
    _take_cooldown(source)
    target = probe_url(db, source)
    if source == "track_cookie":
        status, detail = _probe_cookie(db, target)
    else:
        status, detail = _probe_browser(db, source, target)
    saved = _save_status(db, source, status, detail, probe=target)
    return {
        "id": source,
        "status": saved["status"],
        "checked_at": saved["checked_at"],
        "detail": saved["detail"],
    }


def relogin_url(db: Session, source: str) -> str:
    return probe_url(db, source)


def save_track_cookie(db: Session, cookie: str) -> dict[str, Any]:
    """写入/清除门户 Cookie，随后**自动复检一次**（否则用户登完了面板还显示旧状态）。"""
    write_settings(db, cookie=cookie)
    reset_cooldowns()
    target = probe_url(db, "track_cookie")
    if not cookie.strip():
        saved = _save_status(db, "track_cookie", "unchecked", "未配置 Cookie", probe=target)
        return {
            "id": "track_cookie",
            **{key: saved[key] for key in ("status", "checked_at", "detail")},
        }
    status, detail = _probe_cookie(db, target)
    saved = _save_status(db, "track_cookie", status, detail, probe=target)
    return {"id": "track_cookie", **{key: saved[key] for key in ("status", "checked_at", "detail")}}


__all__ = [
    "COOLDOWN_SECONDS",
    "SOURCE_IDS",
    "SOURCES",
    "LoginStatusBusy",
    "check",
    "list_statuses",
    "probe_url",
    "read_status",
    "relogin_url",
    "reset_cooldowns",
    "save_track_cookie",
    "set_probe_url",
    "source_ids",
]
